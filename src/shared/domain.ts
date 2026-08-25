import type {
  ActivityItem,
  AppRule,
  CompanionSettings,
  PersistedData,
  PetState,
  PetStats,
  Reminder,
} from "./types";

// The source Codex atlas has transparent tail cells on several standard rows.
// Keep host animation loops within the populated cells so the pet never blinks out.
export const STANDARD_ATLAS_FRAME_COUNTS = [7, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8] as const;

export const STATE_LABELS: Record<PetState, string> = {
  idle: "陪着你",
  working: "认真工作",
  waiting: "等你回应",
  ready: "完成啦",
  failed: "出了点问题",
  hungry: "有点饿",
  eating: "正在吃饭",
  happy: "心情很好",
  affectionate: "喜欢你",
  sleepy: "有点困",
  sleeping: "睡觉中",
  playful: "玩得开心",
  startled: "吓一跳",
  celebrating: "庆祝一下",
  focused: "陪你专注",
  reminder: "提醒你一下",
};

export const DEFAULT_SETTINGS: CompanionSettings = {
  overlayVisible: true,
  alwaysOnTop: true,
  gazeEnabled: true,
  gazeFrameRate: 60,
  gazeSmoothingMs: 320,
  gazeDeadzonePx: 54,
  soundEnabled: true,
  volume: 0.62,
  systemNotifications: true,
  proactiveNotifications: true,
  codexNotifications: true,
  monitorCodex: true,
  monitorApps: true,
  startAtLogin: false,
};

export const DEFAULT_APP_RULES: AppRule[] = [
  {
    id: "rule-code",
    name: "代码编辑器",
    appPattern: "Visual Studio Code|Code|Cursor|Xcode|Zed",
    state: "focused",
    message: "小满陪你写代码",
    sound: "none",
    notify: false,
    enabled: true,
  },
  {
    id: "rule-terminal",
    name: "终端",
    appPattern: "Terminal|iTerm|Warp|Ghostty",
    state: "focused",
    message: "小满正在旁边盯进度",
    sound: "none",
    notify: false,
    enabled: true,
  },
  {
    id: "rule-chat",
    name: "聊天",
    appPattern: "微信|WeChat|Messages|Slack|Discord",
    state: "happy",
    message: "小满来看看新消息",
    sound: "pop",
    notify: false,
    enabled: true,
  },
];

export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultData(now = Date.now()): PersistedData {
  return {
    version: 1,
    stats: {
      fullness: 76,
      affection: 42,
      energy: 84,
      lastUpdatedAt: now,
      lastFedAt: null,
      lastPettedAt: null,
      meals: 0,
      interactions: 0,
    },
    reminders: [],
    appRules: DEFAULT_APP_RULES,
    settings: DEFAULT_SETTINGS,
    sleeping: false,
    overlayPosition: null,
    activity: [],
    proactive: {
      lastHungerNoticeAt: null,
      lastEnergyNoticeAt: null,
      lastLongWorkNoticeAt: null,
    },
  };
}

export function clampStat(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

export function decayStats(stats: PetStats, sleeping: boolean, now = Date.now()): PetStats {
  const elapsedMinutes = Math.max(0, (now - stats.lastUpdatedAt) / 60_000);
  if (elapsedMinutes < 0.25) return stats;

  return {
    ...stats,
    fullness: clampStat(stats.fullness - elapsedMinutes / 24),
    affection: clampStat(stats.affection - elapsedMinutes / (60 * 18)),
    energy: clampStat(stats.energy + (sleeping ? elapsedMinutes / 7 : -elapsedMinutes / 52)),
    lastUpdatedAt: now,
  };
}

export function deriveAmbientState(
  stats: PetStats,
  sleeping: boolean,
  codexBusy: boolean,
  appRuleState: PetState | null,
): PetState {
  if (codexBusy) return "working";
  if (sleeping) return "sleeping";
  if (stats.fullness <= 22) return "hungry";
  if (stats.energy <= 18) return "sleepy";
  return appRuleState ?? "idle";
}

export function isReminderDue(reminder: Reminder, now: Date): { due: boolean; key: string } {
  const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const timeKey = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const triggerKey = `${dateKey}T${timeKey}`;
  if (!reminder.enabled || reminder.time !== timeKey || reminder.lastTriggeredKey === triggerKey) {
    return { due: false, key: triggerKey };
  }

  if (reminder.repeat === "once") {
    return { due: reminder.date === dateKey, key: triggerKey };
  }
  if (reminder.repeat === "weekdays") {
    return { due: now.getDay() >= 1 && now.getDay() <= 5, key: triggerKey };
  }
  if (reminder.repeat === "weekly") {
    return { due: reminder.days.includes(now.getDay()), key: triggerKey };
  }
  return { due: true, key: triggerKey };
}

export function appendActivity(
  activity: ActivityItem[],
  item: Omit<ActivityItem, "id" | "at"> & Partial<Pick<ActivityItem, "id" | "at">>,
): ActivityItem[] {
  const next: ActivityItem = {
    ...item,
    id: item.id ?? makeId("event"),
    at: item.at ?? Date.now(),
  };
  return [next, ...activity].slice(0, 60);
}

export function normalizePersistedData(value: Partial<PersistedData> | null | undefined): PersistedData {
  const defaults = createDefaultData();
  if (!value || value.version !== 1) return defaults;
  return {
    ...defaults,
    ...value,
    stats: { ...defaults.stats, ...value.stats },
    settings: { ...defaults.settings, ...value.settings },
    proactive: { ...defaults.proactive, ...value.proactive },
    reminders: Array.isArray(value.reminders) ? value.reminders : [],
    appRules: Array.isArray(value.appRules) ? value.appRules : defaults.appRules,
    activity: Array.isArray(value.activity) ? value.activity.slice(0, 60) : [],
  };
}
