import { appendActivity, clampStat, createDefaultData, makeId, STATE_LABELS } from "./shared/domain";
import type { XiaomanApi } from "./electron";
import type {
  AppRuleInput,
  AppSnapshot,
  CompanionSettings,
  CodexThreadListResult,
  CursorPayload,
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

  const interact = async (action: InteractionAction) => {
    const now = Date.now();
    const mapping: Record<InteractionAction, { state: AppSnapshot["state"]; message: string; sound: SoundName }> = {
      feed: { state: "eating", message: "鱼干真香", sound: "crunch" },
      pet: { state: "affectionate", message: "再摸一下也可以", sound: "purr" },
      play: { state: "playful", message: "抓到你了", sound: "pop" },
      sleep: { state: "sleeping", message: "晚安", sound: "purr" },
      wake: { state: "happy", message: "我醒啦", sound: "meow" },
      celebrate: { state: "celebrating", message: "值得庆祝", sound: "chime" },
    };
    if (action === "feed") {
      current.stats.fullness = clampStat(current.stats.fullness + 28);
      current.stats.meals += 1;
      current.stats.lastFedAt = now;
    } else if (action === "pet") {
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
      source: "app-server+logs",
      warnings: [],
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
    openCodexThread: async () => ({ ok: true, message: "已打开对应 Codex 任务" }),
    replyCodexThread: async (_threadId: string, message: string) => ({
      ok: true,
      mode: "queued",
      message: message.trim() ? "回复已排队；当前回复结束后会自动继续" : "请输入回复内容",
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
