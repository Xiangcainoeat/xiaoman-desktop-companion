import { PET_STATES, SOUND_NAMES } from "./types";
import { canonicalJobReward, QUEST_DEFINITIONS } from "./care";
import { DEFAULT_HOVER_JUMP_COUNT, normalizeHoverJumpCount } from "./motion";
import type {
  ActivityItem,
  AppRule,
  CompanionSettings,
  PersistedData,
  PetState,
  PetStats,
  Reminder,
  ActiveJob,
  DailyQuest,
  FoodId,
  Inventory,
  JobId,
  QuestKind,
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
  dirty: "该洗澡啦",
  eating: "正在吃饭",
  bathing: "洗澡中",
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
  petProfile: "enhanced",
  gazeEnabled: true,
  gazeRange: "full-360",
  gazeFrameRate: 60,
  animationFrameRate: 30,
  gazeSmoothingMs: 320,
  gazeDeadzonePx: 54,
  gazeIdleResetMs: 1400,
  petSize: 240,
  dragRunEnabled: true,
  hoverJumpEnabled: true,
  hoverJumpCount: DEFAULT_HOVER_JUMP_COUNT,
  idleActionsEnabled: true,
  idleLickEnabled: true,
  idleBlinkEnabled: true,
  idleScratchEnabled: true,
  idleActionIntervalSec: 28,
  idleSpeechEnabled: true,
  idleSpeechIntervalSec: 46,
  codexSessionControls: true,
  codexReplyTransport: "native",
  remindersEnabled: true,
  soundEnabled: true,
  volume: 0.62,
  systemNotifications: true,
  proactiveNotifications: true,
  codexNotifications: true,
  monitorCodex: true,
  monitorApps: true,
  startAtLogin: false,
  autoSleepEnabled: false,
  autoSleepAfterMin: 15,
  gameModeEnabled: true,
};

export const FOOD_IDS: FoodId[] = ["fish-snack", "milk", "tuna-bites", "salmon"];
function dateKey(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function createDailyQuests(now = Date.now()): DailyQuest[] {
  return QUEST_DEFINITIONS.map((definition, index) => ({
    id: `${dateKey(now)}-${definition.kind}-${index}`,
    kind: definition.kind,
    title: definition.title,
    target: 1,
    progress: 0,
    reward: { food: { ...definition.reward.food }, giftBoxes: definition.reward.giftBoxes, experience: definition.reward.experience },
    claimed: false,
  }));
}

export function createDefaultInventory(): Inventory {
  return { food: { "fish-snack": 8, milk: 0, "tuna-bites": 0, salmon: 0 }, giftBoxes: 1 };
}

export const DEFAULT_IDLE_PHRASES = [
  "我在这儿",
  "忙完记得休息",
  "今天也陪着你",
  "要不要摸摸我",
];

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
    version: 3,
    stats: {
      fullness: 76,
      affection: 42,
      energy: 84,
      lastUpdatedAt: now,
      lastFedAt: null,
      lastPettedAt: null,
      meals: 0,
      interactions: 0,
      cleanliness: 78,
      experience: 0,
      level: 1,
    },
    reminders: [],
    appRules: DEFAULT_APP_RULES.map((rule) => ({ ...rule })),
    idlePhrases: [...DEFAULT_IDLE_PHRASES],
    settings: { ...DEFAULT_SETTINGS },
    sleeping: false,
    overlayPosition: null,
    activity: [],
    proactive: {
      lastHungerNoticeAt: null,
      lastEnergyNoticeAt: null,
      lastLongWorkNoticeAt: null,
    },
    inventory: createDefaultInventory(),
    activeJob: null,
    dailyQuestDate: dateKey(now),
    dailyQuests: createDailyQuests(now),
    sleepReason: null,
    codexRewardLedger: [],
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
    cleanliness: clampStat(stats.cleanliness - (sleeping ? 0 : elapsedMinutes / 45)),
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
  if (stats.cleanliness < 18) return "dirty";
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

export function normalizeIdlePhrases(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_IDLE_PHRASES];
  const phrases = [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().slice(0, 80))
      .filter(Boolean),
  )].slice(0, 40);
  return phrases;
}

type UnknownRecord = Record<string, unknown>;

function recordValue(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function textValue(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function integerValue(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Math.round(numberValue(value, fallback, minimum, maximum));
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined
    ? null
    : typeof value === "number" && Number.isFinite(value)
      ? value
      : null;
}

export function normalizeCompanionSettings(value: unknown): CompanionSettings {
  const source = recordValue(value) ?? {};
  return {
    overlayVisible: booleanValue(source.overlayVisible, DEFAULT_SETTINGS.overlayVisible),
    alwaysOnTop: booleanValue(source.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop),
    petProfile: source.petProfile === "enhanced" || source.petProfile === "native"
      ? source.petProfile
      : DEFAULT_SETTINGS.petProfile,
    gazeEnabled: booleanValue(source.gazeEnabled, DEFAULT_SETTINGS.gazeEnabled),
    gazeRange: source.gazeRange === "upper-180" ? "upper-180" : "full-360",
    gazeFrameRate: source.gazeFrameRate === 30 ? 30 : 60,
    animationFrameRate: source.animationFrameRate === 60 ? 60 : 30,
    gazeSmoothingMs: integerValue(source.gazeSmoothingMs, DEFAULT_SETTINGS.gazeSmoothingMs, 120, 900),
    gazeDeadzonePx: integerValue(source.gazeDeadzonePx, DEFAULT_SETTINGS.gazeDeadzonePx, 20, 140),
    gazeIdleResetMs: integerValue(source.gazeIdleResetMs, DEFAULT_SETTINGS.gazeIdleResetMs, 500, 5000),
    petSize: integerValue(source.petSize, DEFAULT_SETTINGS.petSize, 150, 340),
    dragRunEnabled: booleanValue(source.dragRunEnabled, DEFAULT_SETTINGS.dragRunEnabled),
    hoverJumpEnabled: booleanValue(source.hoverJumpEnabled, DEFAULT_SETTINGS.hoverJumpEnabled),
    hoverJumpCount: normalizeHoverJumpCount(source.hoverJumpCount, DEFAULT_SETTINGS.hoverJumpCount),
    idleActionsEnabled: booleanValue(source.idleActionsEnabled, DEFAULT_SETTINGS.idleActionsEnabled),
    idleLickEnabled: booleanValue(source.idleLickEnabled, DEFAULT_SETTINGS.idleLickEnabled),
    idleBlinkEnabled: booleanValue(source.idleBlinkEnabled, DEFAULT_SETTINGS.idleBlinkEnabled),
    idleScratchEnabled: booleanValue(source.idleScratchEnabled, DEFAULT_SETTINGS.idleScratchEnabled),
    idleActionIntervalSec: integerValue(source.idleActionIntervalSec, DEFAULT_SETTINGS.idleActionIntervalSec, 10, 120),
    idleSpeechEnabled: booleanValue(source.idleSpeechEnabled, DEFAULT_SETTINGS.idleSpeechEnabled),
    idleSpeechIntervalSec: integerValue(source.idleSpeechIntervalSec, DEFAULT_SETTINGS.idleSpeechIntervalSec, 15, 180),
    codexSessionControls: booleanValue(source.codexSessionControls, DEFAULT_SETTINGS.codexSessionControls),
    codexReplyTransport: source.codexReplyTransport === "native" || source.codexReplyTransport === "cli"
      ? source.codexReplyTransport
      : DEFAULT_SETTINGS.codexReplyTransport,
    remindersEnabled: booleanValue(source.remindersEnabled, DEFAULT_SETTINGS.remindersEnabled),
    soundEnabled: booleanValue(source.soundEnabled, DEFAULT_SETTINGS.soundEnabled),
    volume: numberValue(source.volume, DEFAULT_SETTINGS.volume, 0, 1),
    systemNotifications: booleanValue(source.systemNotifications, DEFAULT_SETTINGS.systemNotifications),
    proactiveNotifications: booleanValue(source.proactiveNotifications, DEFAULT_SETTINGS.proactiveNotifications),
    codexNotifications: booleanValue(source.codexNotifications, DEFAULT_SETTINGS.codexNotifications),
    monitorCodex: booleanValue(source.monitorCodex, DEFAULT_SETTINGS.monitorCodex),
    monitorApps: booleanValue(source.monitorApps, DEFAULT_SETTINGS.monitorApps),
    startAtLogin: booleanValue(source.startAtLogin, DEFAULT_SETTINGS.startAtLogin),
    autoSleepEnabled: booleanValue(source.autoSleepEnabled, DEFAULT_SETTINGS.autoSleepEnabled),
    autoSleepAfterMin: integerValue(source.autoSleepAfterMin, DEFAULT_SETTINGS.autoSleepAfterMin, 5, 180),
    gameModeEnabled: booleanValue(source.gameModeEnabled, DEFAULT_SETTINGS.gameModeEnabled),
  };
}

function normalizeStats(value: unknown, defaults: PetStats): PetStats {
  const source = recordValue(value) ?? {};
  return {
    fullness: numberValue(source.fullness, defaults.fullness, 0, 100),
    affection: numberValue(source.affection, defaults.affection, 0, 100),
    energy: numberValue(source.energy, defaults.energy, 0, 100),
    lastUpdatedAt: numberValue(source.lastUpdatedAt, defaults.lastUpdatedAt, 0, Number.MAX_SAFE_INTEGER),
    lastFedAt: nullableNumber(source.lastFedAt),
    lastPettedAt: nullableNumber(source.lastPettedAt),
    meals: integerValue(source.meals, defaults.meals, 0, Number.MAX_SAFE_INTEGER),
    interactions: integerValue(source.interactions, defaults.interactions, 0, Number.MAX_SAFE_INTEGER),
    cleanliness: numberValue(source.cleanliness, defaults.cleanliness, 0, 100),
    experience: integerValue(source.experience, defaults.experience, 0, Number.MAX_SAFE_INTEGER),
    level: integerValue(source.level, defaults.level, 1, Number.MAX_SAFE_INTEGER),
  };
}

function normalizeInventory(value: unknown, defaults: Inventory): Inventory {
  const source = recordValue(value) ?? {};
  const foodSource = recordValue(source.food) ?? {};
  return {
    food: Object.fromEntries(FOOD_IDS.map((id) => [id, integerValue(foodSource[id], defaults.food[id], 0, 9999)])) as Record<FoodId, number>,
    giftBoxes: integerValue(source.giftBoxes, defaults.giftBoxes, 0, 9999),
  };
}

function normalizeJob(value: unknown): ActiveJob | null {
  const source = recordValue(value);
  if (!source || !["desk-organizer", "code-helper", "delivery-run"].includes(source.id as string)) return null;
  return {
    id: source.id as JobId,
    startedAt: numberValue(source.startedAt, 0, 0, Number.MAX_SAFE_INTEGER),
    completesAt: numberValue(source.completesAt, 0, 0, Number.MAX_SAFE_INTEGER),
    reward: canonicalJobReward(source.id as JobId),
  };
}

function normalizeQuest(value: unknown): DailyQuest | null {
  const source = recordValue(value);
  const kinds: QuestKind[] = ["feed", "bathe", "play", "work", "codex-complete", "open-gift"];
  if (!source || typeof source.id !== "string" || !kinds.includes(source.kind as QuestKind)) return null;
  const definition = QUEST_DEFINITIONS.find((item) => item.kind === source.kind);
  if (!definition) return null;
  return {
    id: textValue(source.id, "quest", 120),
    kind: source.kind as QuestKind,
    title: definition.title,
    target: definition.target,
    progress: integerValue(source.progress, 0, 0, definition.target),
    reward: { food: { ...definition.reward.food }, giftBoxes: definition.reward.giftBoxes, experience: definition.reward.experience },
    claimed: booleanValue(source.claimed, false),
  };
}

function normalizeReminder(value: unknown): Reminder | null {
  const source = recordValue(value);
  if (!source) return null;
  const id = textValue(source.id, "", 100);
  if (!id) return null;
  const repeat = source.repeat === "once" || source.repeat === "weekdays" || source.repeat === "weekly"
    ? source.repeat
    : "daily";
  const time = typeof source.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(source.time)
    ? source.time
    : "09:00";
  return {
    id,
    title: textValue(source.title, "小满提醒", 40) || "小满提醒",
    message: textValue(source.message, "", 120),
    time,
    repeat,
    date: typeof source.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source.date) ? source.date : null,
    days: Array.isArray(source.days)
      ? [...new Set(source.days.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))]
      : [],
    enabled: booleanValue(source.enabled, true),
    sound: SOUND_NAMES.includes(source.sound as (typeof SOUND_NAMES)[number])
      ? source.sound as Reminder["sound"]
      : "chime",
    lastTriggeredKey: typeof source.lastTriggeredKey === "string" ? source.lastTriggeredKey.slice(0, 40) : null,
  };
}

function normalizeRule(value: unknown): AppRule | null {
  const source = recordValue(value);
  if (!source) return null;
  const id = textValue(source.id, "", 100);
  if (!id) return null;
  return {
    id,
    name: textValue(source.name, "应用事件", 32) || "应用事件",
    appPattern: textValue(source.appPattern, "", 160),
    state: PET_STATES.includes(source.state as PetState) ? source.state as PetState : "focused",
    message: textValue(source.message, "", 100),
    sound: SOUND_NAMES.includes(source.sound as (typeof SOUND_NAMES)[number])
      ? source.sound as AppRule["sound"]
      : "none",
    notify: booleanValue(source.notify, false),
    enabled: booleanValue(source.enabled, true),
  };
}

function normalizeActivity(value: unknown): ActivityItem | null {
  const source = recordValue(value);
  if (!source) return null;
  const id = textValue(source.id, "", 100);
  const activitySources: ActivityItem["source"][] = ["interaction", "reminder", "codex", "application", "system"];
  if (!id || !activitySources.includes(source.source as ActivityItem["source"])) return null;
  return {
    id,
    at: numberValue(source.at, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    source: source.source as ActivityItem["source"],
    title: textValue(source.title, "", 120),
    detail: textValue(source.detail, "", 240),
    state: PET_STATES.includes(source.state as PetState) ? source.state as PetState : "idle",
  };
}

export function normalizePersistedData(value: unknown): PersistedData {
  const defaults = createDefaultData();
  if (value === null || value === undefined) return defaults;
  const source = recordValue(value);
  if (!source) throw new TypeError("Persisted companion data must be an object");
  if (source.version !== 1 && source.version !== 2 && source.version !== 3) {
    throw new RangeError(`Unsupported companion data version: ${String(source.version)}`);
  }
  const position = recordValue(source.overlayPosition);
  const proactive = recordValue(source.proactive) ?? {};
  const dailyQuestDate = typeof source.dailyQuestDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source.dailyQuestDate)
    ? source.dailyQuestDate
    : dateKey(Date.now());
  const quests = Array.isArray(source.dailyQuests)
    ? source.dailyQuests.map(normalizeQuest).filter((item): item is DailyQuest => item !== null)
    : [];
  const ledger = Array.isArray(source.codexRewardLedger)
    ? [...new Set(source.codexRewardLedger.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 240)))].slice(-120)
    : [];
  return {
    version: 3,
    stats: normalizeStats(source.stats, defaults.stats),
    reminders: Array.isArray(source.reminders)
      ? source.reminders.map(normalizeReminder).filter((item): item is Reminder => item !== null)
      : [],
    appRules: Array.isArray(source.appRules)
      ? source.appRules.map(normalizeRule).filter((item): item is AppRule => item !== null)
      : defaults.appRules,
    idlePhrases: normalizeIdlePhrases(source.idlePhrases),
    settings: normalizeCompanionSettings(source.settings),
    sleeping: booleanValue(source.sleeping, false),
    overlayPosition: position
      && typeof position.x === "number" && Number.isFinite(position.x)
      && typeof position.y === "number" && Number.isFinite(position.y)
      ? { x: Math.round(position.x), y: Math.round(position.y) }
      : null,
    activity: Array.isArray(source.activity)
      ? source.activity.map(normalizeActivity).filter((item): item is ActivityItem => item !== null).slice(0, 60)
      : [],
    proactive: {
      lastHungerNoticeAt: nullableNumber(proactive.lastHungerNoticeAt),
      lastEnergyNoticeAt: nullableNumber(proactive.lastEnergyNoticeAt),
      lastLongWorkNoticeAt: nullableNumber(proactive.lastLongWorkNoticeAt),
    },
    inventory: normalizeInventory(source.inventory, defaults.inventory),
    activeJob: normalizeJob(source.activeJob),
    dailyQuestDate,
    dailyQuests: quests.length === 5 ? quests : createDailyQuests(),
    sleepReason: source.sleepReason === "manual" || source.sleepReason === "inactivity" ? source.sleepReason : null,
    codexRewardLedger: ledger,
  };
}
