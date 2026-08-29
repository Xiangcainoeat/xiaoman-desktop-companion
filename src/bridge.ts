import { appendActivity, clampStat, createDefaultData, decayStats, FOOD_IDS, makeId, STATE_LABELS } from "./shared/domain";
import { applyBath, applyFeed, claimDailyQuest, completePetJob, openGiftBox, startPetJob } from "./shared/care";
import { canHitDesktopBubble, DESKTOP_SESSION_DURATION_MS } from "./shared/desktop-interaction";
import { isRewardedGameId, settleGameResult } from "./shared/games";
import { isSleepAllowedInteraction, SLEEPING_NOTICE } from "./shared/sleep";
import type { XiaomanApi } from "./electron";
import { BUNDLED_PET_PACK_ID, createBundledPetPackRuntime } from "./pet-pack/runtime";
import type {
  AppRuleInput,
  AppSnapshot,
  CenterTab,
  CompanionSettings,
  CodexThreadListResult,
  CursorPayload,
  DesktopInteractionStatus,
  FoodId,
  GameId,
  GameStartResult,
  JobId,
  InteractionAction,
  OverlayPanelMode,
  QuickViewMode,
  OverlayInteractionReport,
  PetPackOperationResult,
  PetPackRuntime,
  PetPackSummary,
  ReminderInput,
  SoundName,
} from "./shared/types";
import type { ArticleGameId, ArticleGameOpenResult } from "./article-games/registry";

function createMockApi(): XiaomanApi {
  const listeners = new Set<(snapshot: AppSnapshot) => void>();
  const soundListeners = new Set<(sound: SoundName) => void>();
  const centerTabListeners = new Set<(tab: CenterTab) => void>();
  const overlayPanelListeners = new Set<(mode: OverlayPanelMode | null) => void>();
  const petPackListeners = new Set<(runtime: PetPackRuntime) => void>();
  let overlayPanelMode: OverlayPanelMode | null = null;
  const data = createDefaultData();
  const bundledPetPackRuntime = createBundledPetPackRuntime();
  const bundledPetPackSummary: PetPackSummary = {
    id: BUNDLED_PET_PACK_ID,
    name: "小满",
    version: "bundled",
    spriteVersionNumber: 2,
    active: true,
    bundled: true,
    assetCount: bundledPetPackRuntime.assets.length,
    hasCodex: true,
    hasDesktop: true,
    warnings: [],
  };
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
    desktopInteraction: { active: false, sessionId: null, startedAt: null, score: 0 },
    petPacks: [bundledPetPackSummary],
    petPackRuntime: bundledPetPackRuntime,
  };

  let gameActive = false;
  const desktopHitIds = new Set<string>();
  let lastDesktopSessionId: string | null = null;
  let desktopSessionExpiryTimer: ReturnType<typeof setTimeout> | null = null;

  const publish = () => {
    for (const listener of listeners) listener(structuredClone(current));
    return structuredClone(current);
  };
  const setOverlayPanel = (mode: OverlayPanelMode | null): void => {
    overlayPanelMode = mode;
    for (const listener of overlayPanelListeners) listener(mode);
  };
  const clearDesktopSessionExpiryTimer = () => {
    if (desktopSessionExpiryTimer) clearTimeout(desktopSessionExpiryTimer);
    desktopSessionExpiryTimer = null;
  };
  const clearDesktopSessionWithoutReward = (): boolean => {
    if (!current.desktopInteraction.active) return false;
    lastDesktopSessionId = current.desktopInteraction.sessionId;
    current.desktopInteraction = { active: false, sessionId: null, startedAt: null, score: 0 };
    desktopHitIds.clear();
    clearDesktopSessionExpiryTimer();
    return true;
  };
  const expireDesktopSessionIfNeeded = (): boolean => {
    const startedAt = current.desktopInteraction.startedAt;
    if (!current.desktopInteraction.active || startedAt === null || Date.now() < startedAt + DESKTOP_SESSION_DURATION_MS) return false;
    return clearDesktopSessionWithoutReward();
  };
  const expireDesktopSessionAndPublishIfNeeded = (): void => {
    if (expireDesktopSessionIfNeeded()) publish();
  };
  const scheduleDesktopSessionExpiry = (): void => {
    clearDesktopSessionExpiryTimer();
    const startedAt = current.desktopInteraction.startedAt;
    const sessionId = current.desktopInteraction.sessionId;
    if (!current.desktopInteraction.active || startedAt === null || !sessionId) return;
    desktopSessionExpiryTimer = setTimeout(() => {
      if (current.desktopInteraction.sessionId !== sessionId) return;
      expireDesktopSessionAndPublishIfNeeded();
    }, Math.max(0, startedAt + DESKTOP_SESSION_DURATION_MS - Date.now()));
  };
  const rejectSleepingCare = (): void => {
    if (current.sleeping) throw new Error(SLEEPING_NOTICE);
  };
  const notifySleeping = (): AppSnapshot => {
    current.state = "sleeping";
    current.stateMessage = SLEEPING_NOTICE;
    current.stateSource = "interaction";
    return publish();
  };
  const temporaryState = (state: AppSnapshot["state"], message: string, sound: SoundName, durationMs = 2600) => {
    current.state = state;
    current.stateMessage = message;
    if (sound !== "none") for (const listener of soundListeners) listener(sound);
    window.setTimeout(() => {
      current.state = current.sleeping ? "sleeping" : "idle";
      current.stateMessage = current.sleeping ? SLEEPING_NOTICE : STATE_LABELS.idle;
      publish();
    }, durationMs);
  };

  const runCare = (
    operation:
      | { kind: "feed"; foodId: FoodId }
      | { kind: "bath" }
      | { kind: "open-gift" }
      | { kind: "start-job"; jobId: JobId }
      | { kind: "complete-job" }
      | { kind: "cancel-job" }
      | { kind: "claim-quest"; questId: string }
      | { kind: "complete-game"; gameId: GameId; score: number },
    state: AppSnapshot["state"],
    message: string,
    sound: SoundName,
    title: string,
  ): AppSnapshot => {
    rejectSleepingCare();
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
    else if (operation.kind === "complete-job") result = completePetJob(baseData, now);
    else if (operation.kind === "cancel-job") {
      result = baseData.activeJob
        ? { ok: true as const, data: { ...baseData, activeJob: null }, message: "已取消打工" }
        : { ok: false as const, message: "现在没有打工" };
    } else if (operation.kind === "claim-quest") result = claimDailyQuest(baseData, operation.questId, now);
    else {
      if (!isRewardedGameId(operation.gameId)) {
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
      desktopInteraction: current.desktopInteraction,
      petPacks: current.petPacks,
      petPackRuntime: current.petPackRuntime,
    };
    current.activity = appendActivity(current.activity, {
      source: "interaction",
      title,
      detail: result.message ?? message,
      state,
    });
    const durationMs = operation.kind === "feed" || operation.kind === "bath" ? 6200 : 2600;
    temporaryState(state, result.message ?? message, sound, durationMs);
    return publish();
  };

  const interact = async (action: InteractionAction) => {
    if (current.sleeping && !isSleepAllowedInteraction(action)) return notifySleeping();
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
    current.sleepReason = action === "sleep" ? "manual" : action === "wake" ? null : current.sleepReason;
    current.stats.interactions += 1;
    if (action === "sleep") {
      current.state = "sleeping";
      current.stateMessage = SLEEPING_NOTICE;
      current.stateSource = "interaction";
      for (const listener of soundListeners) listener(mapping[action].sound);
    } else {
      temporaryState(mapping[action].state, mapping[action].message, mapping[action].sound);
    }
    current.activity = appendActivity(current.activity, {
      source: "interaction",
      title: mapping[action].message,
      detail: "界面预览事件",
      state: mapping[action].state,
    });
    return publish();
  };

  return {
    getSnapshot: async () => {
      expireDesktopSessionAndPublishIfNeeded();
      return structuredClone(current);
    },
    interact,
    feedFood: async (foodId: FoodId) => runCare({ kind: "feed", foodId }, "eating", "鱼干真香", "crunch", "喂了小满"),
    bathePet: async () => runCare({ kind: "bath" }, "bathing", "洗得香香的", "chime", "给小满洗澡"),
    openGiftBox: async () => runCare({ kind: "open-gift" }, "celebrating", "礼包打开啦", "chime", "打开了礼包"),
    startPetJob: async (jobId: JobId) => runCare({ kind: "start-job", jobId }, "working", "打工中", "chime", "开始打工"),
    collectPetJob: async () => runCare({ kind: "complete-job" }, "celebrating", "打工奖励到账", "chime", "领取打工奖励"),
    cancelPetJob: async () => runCare({ kind: "cancel-job" }, "idle", "已取消打工", "none", "取消打工"),
    claimDailyQuest: async (questId: string) => runCare({ kind: "claim-quest", questId }, "celebrating", "领取成功", "chime", "领取每日任务奖励"),
    startGameSession: async (): Promise<GameStartResult> => {
      expireDesktopSessionAndPublishIfNeeded();
      if (current.sleeping) return { accepted: false, message: SLEEPING_NOTICE };
      if (!current.settings.gameModeEnabled) return { accepted: false, message: "小游戏模式已关闭" };
      if (current.desktopInteraction.active) return { accepted: false, message: "桌面泡泡互动正在进行" };
      if (gameActive) return { accepted: false, message: "已有游戏正在进行" };
      gameActive = true;
      return { accepted: true };
    },
    setGameActive: (active: boolean) => {
      expireDesktopSessionAndPublishIfNeeded();
      if (current.sleeping) return;
      if (current.desktopInteraction.active) return;
      gameActive = Boolean(active) && current.settings.gameModeEnabled;
    },
    completeGame: async (gameId: GameId, score: number) => {
      rejectSleepingCare();
      if (!current.settings.gameModeEnabled) throw new Error("小游戏模式已关闭");
      if (!isRewardedGameId(gameId)) {
        throw new Error("没有这个小游戏");
      }
      expireDesktopSessionAndPublishIfNeeded();
      if (current.desktopInteraction.active) throw new Error("桌面泡泡互动正在进行");
      if (!gameActive) throw new Error("没有正在进行的游戏");
      try {
        return runCare({ kind: "complete-game", gameId, score }, "playful", "游戏完成", "pop", "完成互动游戏");
      } finally {
        gameActive = false;
      }
    },
    getArticleGameUrl: async (gameId: ArticleGameId) => `./article-games/${gameId}/index.html`,
    fitArticleGameWindow: async (_gameId: ArticleGameId | null): Promise<void> => undefined,
    restoreGameWindow: async (): Promise<void> => undefined,
    openArticleGameOnline: async (_gameId: ArticleGameId): Promise<ArticleGameOpenResult> => ({
      ok: false,
      message: "浏览器预览不会打开在线游戏，请使用 Electron 应用",
    }),
    startDesktopBubbleSession: async () => {
      rejectSleepingCare();
      expireDesktopSessionAndPublishIfNeeded();
      if (!current.settings.gameModeEnabled) throw new Error("小游戏模式已关闭");
      if (current.desktopInteraction.active) return structuredClone(current);
      if (gameActive) throw new Error("已有游戏正在进行");
      const now = Date.now();
      current.desktopInteraction = {
        active: true,
        sessionId: makeId("preview-session"),
        startedAt: now,
        score: 0,
      } satisfies DesktopInteractionStatus;
      desktopHitIds.clear();
      lastDesktopSessionId = null;
      scheduleDesktopSessionExpiry();
      return publish();
    },
    hitDesktopBubble: async (sessionId: string, bubbleId: string) => {
      rejectSleepingCare();
      expireDesktopSessionAndPublishIfNeeded();
      if (!canHitDesktopBubble(current.desktopInteraction, sessionId, bubbleId, Date.now(), desktopHitIds)) {
        throw new Error("泡泡命中无效");
      }
      desktopHitIds.add(bubbleId);
      current.desktopInteraction = {
        ...current.desktopInteraction,
        score: current.desktopInteraction.score + 1,
      };
      return publish();
    },
    stopDesktopBubbleSession: async (sessionId: string, completed: boolean) => {
      rejectSleepingCare();
      expireDesktopSessionAndPublishIfNeeded();
      if (current.desktopInteraction.sessionId !== sessionId) {
        if (!current.desktopInteraction.active && lastDesktopSessionId === sessionId) return structuredClone(current);
        throw new Error("桌面互动 session 无效");
      }
      const score = current.desktopInteraction.score;
      const expired = current.desktopInteraction.startedAt === null
        || Date.now() >= current.desktopInteraction.startedAt + DESKTOP_SESSION_DURATION_MS;
      lastDesktopSessionId = sessionId;
      desktopHitIds.clear();
      current.desktopInteraction = { active: false, sessionId: null, startedAt: null, score: 0 };
      clearDesktopSessionExpiryTimer();
      if (completed && !expired) return runCare({ kind: "complete-game", gameId: "bubble-pop", score }, "playful", "游戏完成", "pop", "完成桌面泡泡互动");
      return publish();
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
      if (!current.settings.gameModeEnabled) {
        clearDesktopSessionWithoutReward();
        gameActive = false;
      }
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
    listPetPacks: async () => structuredClone(current.petPacks),
    importPetPack: async (_filePath?: string): Promise<PetPackOperationResult> => ({
      ok: false,
      message: "浏览器预览不会安装 Pet Pack，请使用 Electron 应用",
    }),
    activatePetPack: async (id: string | null) => {
      if (id !== null && id !== BUNDLED_PET_PACK_ID) throw new Error("浏览器预览只支持内置小满");
      current.activePetPackId = null;
      current.petPacks = [bundledPetPackSummary];
      current.petPackRuntime = bundledPetPackRuntime;
      for (const listener of petPackListeners) listener(structuredClone(current.petPackRuntime));
      return publish();
    },
    removePetPack: async (_id: string) => publish(),
    exportPetPackToCodex: async (_id: string): Promise<PetPackOperationResult> => ({
      ok: false,
      message: "浏览器预览不会写入 Codex 目录，请使用 Electron 应用",
    }),
    getPetPackRuntime: async () => structuredClone(current.petPackRuntime),
    showQuickWindow: (mode: QuickViewMode) => setOverlayPanel(mode),
    quitApp: () => undefined,
    setOverlayTaskPanel: (open: boolean) => setOverlayPanel(open ? "codex" : null),
    setOverlayPanel,
    showCenter: (tab?: CenterTab) => {
      if (!tab) return;
      for (const listener of centerTabListeners) listener(tab);
    },
    toggleOverlay: () => undefined,
    moveOverlayBy: () => undefined,
    setOverlayMouseMode: () => undefined,
    reportOverlayHitRegions: (_report: OverlayInteractionReport) => undefined,
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
    onCenterTab: (listener) => {
      centerTabListeners.add(listener);
      return () => centerTabListeners.delete(listener);
    },
    onOverlayTaskPanel: (listener) => {
      const handler = (mode: OverlayPanelMode | null) => listener(mode === "codex");
      overlayPanelListeners.add(handler);
      queueMicrotask(() => handler(overlayPanelMode));
      return () => overlayPanelListeners.delete(handler);
    },
    onOverlayPanel: (listener) => {
      overlayPanelListeners.add(listener);
      queueMicrotask(() => {
        if (overlayPanelListeners.has(listener)) listener(overlayPanelMode);
      });
      return () => overlayPanelListeners.delete(listener);
    },
    onPetPackChanged: (listener) => {
      petPackListeners.add(listener);
      queueMicrotask(() => {
        if (petPackListeners.has(listener)) listener(structuredClone(current.petPackRuntime));
      });
      return () => petPackListeners.delete(listener);
    },
  };
}

let mockApi: XiaomanApi | null = null;

export function getBridge(): XiaomanApi {
  if (typeof window !== "undefined" && window.xiaoman) return window.xiaoman;
  mockApi ??= createMockApi();
  return mockApi;
}

export function createMockApiForTests(): XiaomanApi {
  return createMockApi();
}
