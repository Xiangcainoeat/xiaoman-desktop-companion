import { appendActivity, clampStat, createDefaultData, decayStats, FOOD_IDS, makeId, STATE_LABELS } from "./shared/domain";
import { applyBath, applyFeed, claimDailyQuest, openGiftBox, startPetJob } from "./shared/care";
import { settleGameResult } from "./shared/games";
import type { XiaomanApi } from "./electron";
import type {
  AppRuleInput,
  AppSnapshot,
  CompanionSettings,
  CodexThreadListResult,
  CursorPayload,
  FoodId,
  GameId,
  JobId,
  InteractionAction,
  ReminderInput,
  SoundName,
} from "./shared/types";

function createMockApi(): XiaomanApi {
  const listeners = new Set<(snapshot: AppSnapshot) => void>();
  const soundListeners = new Set<(sound: SoundName) => void>();
  const data = createDefaultData();
  let current: AppSnapshot = {
    ...data,
    state: "idle",
    stateMessage: "我在这里",
    stateSource: "ambient",
    monitoring: {
      codex: "watching",
      applications: "watching",
      notifications: "available",
      activeApplication: "Visual Studio Code",
      codexBusy: false,
      codexStartedAt: null,
    },
  };

  let gameActive = false;

  const publish = () => {
    for (const listener of listeners) listener(structuredClone(current));
    return structuredClone(current);
  };
  const temporaryState = (state: AppSnapshot["state"], message: string, sound: SoundName) => {
    current.state = state;
    current.stateMessage = message;
    if (sound !== "none") for (const listener of soundListeners) listener(sound);
    window.setTimeout(() => {
      current.state = "idle";
      current.stateMessage = STATE_LABELS.idle;
      publish();
    }, 2600);
  };

  const runCare = (
    operation:
      | { kind: "feed"; foodId: FoodId }
      | { kind: "bath" }
      | { kind: "open-gift" }
      | { kind: "start-job"; jobId: JobId }
      | { kind: "cancel-job" }
      | { kind: "claim-quest"; questId: string }
      | { kind: "complete-game"; gameId: GameId; score: number },
    state: AppSnapshot["state"],
    message: string,
    sound: SoundName,
    title: string,
  ): AppSnapshot => {
    const now = Date.now();
    const baseData = {
      ...current,
      stats: decayStats(current.stats, current.sleeping, now),
    };
    let result;
    if (operation.kind === "feed") {
      if (!FOOD_IDS.includes(operation.foodId)) throw new Error("没有这个食物");
      result = applyFeed(baseData, operation.foodId, now);
    }
    else if (operation.kind === "bath") result = applyBath(baseData, now);
    else if (operation.kind === "open-gift") result = openGiftBox(baseData, Math.random);
    else if (operation.kind === "start-job") {
      if (operation.jobId !== "desk-organizer" && operation.jobId !== "code-helper" && operation.jobId !== "delivery-run") {
        throw new Error("没有这个打工");
      }
      result = startPetJob(baseData, operation.jobId, now);
    }
    else if (operation.kind === "cancel-job") {
      result = baseData.activeJob
        ? { ok: true as const, data: { ...baseData, activeJob: null }, message: "已取消打工" }
        : { ok: false as const, message: "现在没有打工" };
    } else if (operation.kind === "claim-quest") result = claimDailyQuest(baseData, operation.questId, now);
    else {
      if (operation.gameId !== "rock-paper-scissors" && operation.gameId !== "fish-catch" && operation.gameId !== "bubble-pop") {
        throw new Error("没有这个小游戏");
      }
      const settlement = settleGameResult(operation.gameId, operation.score);
      const experience = baseData.stats.experience + settlement.experience;
      result = {
        ok: true as const,
        data: {
          ...baseData,
          stats: {
            ...baseData.stats,
            affection: clampStat(baseData.stats.affection + settlement.affection),
            experience,
            level: Math.max(1, Math.floor(experience / 100) + 1),
            lastUpdatedAt: now,
          },
          dailyQuests: baseData.dailyQuests.map((quest) => quest.kind === "play" && quest.progress < quest.target
            ? { ...quest, progress: quest.progress + 1 }
            : quest),
        },
        message: `游戏完成，得分 ${settlement.score}`,
      };
    }
    if (!result.ok) throw new Error(result.message);
    current = {
      ...result.data,
      sleeping: result.data.sleeping && result.data.sleepReason === "inactivity" ? false : result.data.sleeping,
      sleepReason: result.data.sleeping && result.data.sleepReason === "inactivity" ? null : result.data.sleepReason,
      state,
      stateMessage: result.message ?? message,
      stateSource: "interaction",
      monitoring: current.monitoring,
    };
    current.activity = appendActivity(current.activity, {
      source: "interaction",
      title,
      detail: result.message ?? message,
      state,
    });
    temporaryState(state, result.message ?? message, sound);
    return publish();
  };

  const interact = async (action: InteractionAction) => {
    if (action === "feed") return runCare({ kind: "feed", foodId: "fish-snack" }, "eating", "鱼干真香", "crunch", "喂了小满");
    const now = Date.now();
    const mapping: Record<InteractionAction, { state: AppSnapshot["state"]; message: string; sound: SoundName }> = {
      feed: { state: "eating", message: "鱼干真香", sound: "crunch" },
      pet: { state: "affectionate", message: "再摸一下也可以", sound: "purr" },
      play: { state: "playful", message: "抓到你了", sound: "pop" },
      sleep: { state: "sleeping", message: "晚安", sound: "purr" },
      wake: { state: "happy", message: "我醒啦", sound: "meow" },
      celebrate: { state: "celebrating", message: "值得庆祝", sound: "chime" },
    };
    if (action === "pet") {
      current.stats.affection = clampStat(current.stats.affection + 4);
      current.stats.lastPettedAt = now;
    } else if (action === "play") {
      current.stats.affection = clampStat(current.stats.affection + 3);
      current.stats.energy = clampStat(current.stats.energy - 7);
    }
    current.sleeping = action === "sleep" ? true : action === "wake" ? false : current.sleeping;
    current.stats.interactions += 1;
    temporaryState(mapping[action].state, mapping[action].message, mapping[action].sound);
    current.activity = appendActivity(current.activity, {
      source: "interaction",
      title: mapping[action].message,
      detail: "界面预览事件",
      state: mapping[action].state,
    });
    return publish();
  };

  return {
    getSnapshot: async () => structuredClone(current),
    interact,
    feedFood: async (foodId: FoodId) => runCare({ kind: "feed", foodId }, "eating", "鱼干真香", "crunch", "喂了小满"),
    bathePet: async () => runCare({ kind: "bath" }, "happy", "洗得香香的", "chime", "给小满洗澡"),
    openGiftBox: async () => runCare({ kind: "open-gift" }, "celebrating", "礼包打开啦", "chime", "打开了礼包"),
    startPetJob: async (jobId: JobId) => runCare({ kind: "start-job", jobId }, "working", "打工中", "chime", "开始打工"),
    cancelPetJob: async () => runCare({ kind: "cancel-job" }, "idle", "已取消打工", "none", "取消打工"),
    claimDailyQuest: async (questId: string) => runCare({ kind: "claim-quest", questId }, "celebrating", "领取成功", "chime", "领取每日任务奖励"),
    setGameActive: (active: boolean) => { gameActive = Boolean(active) && current.settings.gameModeEnabled; },
    completeGame: async (gameId: GameId, score: number) => {
      if (!current.settings.gameModeEnabled) throw new Error("小游戏模式已关闭");
      if (gameId !== "rock-paper-scissors" && gameId !== "fish-catch" && gameId !== "bubble-pop") {
        throw new Error("没有这个小游戏");
      }
      return runCare({ kind: "complete-game", gameId, score }, "playful", "游戏完成", "pop", "完成互动游戏");
    },
    saveReminder: async (input: ReminderInput) => {
      const index = input.id ? current.reminders.findIndex((item) => item.id === input.id) : -1;
      const reminder = { ...input, id: input.id ?? makeId("reminder"), lastTriggeredKey: null };
      if (index >= 0) current.reminders[index] = reminder;
      else current.reminders.push(reminder);
      return publish();
    },
    removeReminder: async (id: string) => {
      current.reminders = current.reminders.filter((item) => item.id !== id);
      return publish();
    },
    toggleReminder: async (id: string) => {
      const item = current.reminders.find((reminder) => reminder.id === id);
      if (item) item.enabled = !item.enabled;
      return publish();
    },
    saveRule: async (input: AppRuleInput) => {
      const index = input.id ? current.appRules.findIndex((item) => item.id === input.id) : -1;
      const rule = { ...input, id: input.id ?? makeId("rule") };
      if (index >= 0) current.appRules[index] = rule;
      else current.appRules.push(rule);
      return publish();
    },
    removeRule: async (id: string) => {
      current.appRules = current.appRules.filter((item) => item.id !== id);
      return publish();
    },
    toggleRule: async (id: string) => {
      const item = current.appRules.find((rule) => rule.id === id);
      if (item) item.enabled = !item.enabled;
      return publish();
    },
    updateSettings: async (patch: Partial<CompanionSettings>) => {
      current.settings = { ...current.settings, ...patch };
      if (!current.settings.gameModeEnabled) gameActive = false;
      return publish();
    },
    updateIdlePhrases: async (phrases: string[]) => {
      current.idlePhrases = phrases;
      return publish();
    },
    testNotification: async () => {
      temporaryState("reminder", "系统通知工作正常", "chime");
      publish();
    },
    clearActivity: async () => {
      current.activity = [];
      return publish();
    },
    listCodexThreads: async (): Promise<CodexThreadListResult> => ({
      source: "mock",
      warnings: ["浏览器预览仅模拟任务状态；真实回复请使用 Electron 应用"],
      threads: [
        {
          id: "01a03ab3-1111-7111-8111-111111111111",
          title: "完善小满桌面伴侣",
          projectName: "xiaoman",
          status: "active",
          updatedAt: Date.now(),
          activeTurnId: "turn-preview",
          sourceKind: "appServer",
          canReply: true,
          waitReason: null,
        },
        {
          id: "01a03ab3-2222-7222-8222-222222222222",
          title: "整理宠物发布目录",
          projectName: "release",
          status: "idle",
          updatedAt: Date.now() - 720_000,
          activeTurnId: null,
          sourceKind: "appServer",
          canReply: true,
          waitReason: null,
        },
      ],
    }),
    openCodexThread: async () => ({ ok: false, message: "浏览器预览不会打开 Codex 任务，请使用 Electron 应用" }),
    replyCodexThread: async (_threadId: string, message: string) => ({
      ok: false,
      mode: "queued",
      transport: "native",
      message: message.trim() ? "浏览器预览仅模拟回复，未调用 Codex；请使用 Electron 应用" : "请输入回复内容",
    }),
    setOverlayTaskPanel: () => undefined,
    showCenter: () => undefined,
    toggleOverlay: () => undefined,
    moveOverlayBy: () => undefined,
    showOverlayMenu: () => undefined,
    onSnapshot: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onCursor: (listener) => {
      const handler = (event: PointerEvent) => {
        const payload: CursorPayload = {
          x: event.clientX,
          y: event.clientY,
          windowWidth: window.innerWidth,
          windowHeight: window.innerHeight,
        };
        listener(payload);
      };
      window.addEventListener("pointermove", handler);
      return () => window.removeEventListener("pointermove", handler);
    },
    onSound: (listener) => {
      soundListeners.add(listener);
      return () => soundListeners.delete(listener);
    },
  };
}

let mockApi: XiaomanApi | null = null;

export function getBridge(): XiaomanApi {
  if (window.xiaoman) return window.xiaoman;
  mockApi ??= createMockApi();
  return mockApi;
}
