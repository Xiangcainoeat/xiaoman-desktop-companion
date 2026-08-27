export const PET_STATES = [
  "idle",
  "working",
  "waiting",
  "ready",
  "failed",
  "hungry",
  "dirty",
  "eating",
  "bathing",
  "happy",
  "affectionate",
  "sleepy",
  "sleeping",
  "playful",
  "startled",
  "celebrating",
  "focused",
  "reminder",
] as const;

export type PetState = (typeof PET_STATES)[number];

export const SOUND_NAMES = ["none", "meow", "purr", "chime", "crunch", "pop", "alert"] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

export type InteractionAction = "feed" | "pet" | "play" | "sleep" | "wake" | "celebrate";
export type FoodId = "fish-snack" | "milk" | "tuna-bites" | "salmon";
export type JobId = "desk-organizer" | "code-helper" | "delivery-run";
export type QuestKind = "feed" | "bathe" | "play" | "work" | "codex-complete" | "open-gift";
export type SleepReason = "manual" | "inactivity" | null;
export type GameId = "rock-paper-scissors" | "fish-catch" | "bubble-pop";
export type ReminderRepeat = "once" | "daily" | "weekdays" | "weekly";
export type GazeRange = "upper-180" | "full-360";
export type PetProfile = "enhanced" | "native";
export type CodexReplyTransport = "native" | "cli";
export type PetMotion =
  | "running-left"
  | "running-right"
  | "jumping"
  | "idle-lick"
  | "idle-blink"
  | "idle-scratch";

export type QuickViewMode = "care" | "interaction";

export interface DesktopInteractionStatus {
  active: boolean;
  sessionId: string | null;
  startedAt: number | null;
  score: number;
}

export interface DesktopBubble {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  bornAt: number;
  expiresAt: number;
  ageMs?: number;
}


export type CodexThreadStatus = "active" | "waiting" | "idle" | "not-loaded" | "error" | "unknown";

export interface CodexThreadSummary {
  id: string;
  title: string;
  projectName: string;
  status: CodexThreadStatus;
  updatedAt: number;
  activeTurnId: string | null;
  sourceKind: string | null;
  canReply: boolean;
  waitReason: "approval" | null;
}

export interface CodexReplyResult {
  ok: boolean;
  mode: "queued" | "started";
  transport: CodexReplyTransport;
  message: string;
}

export interface CodexThreadListResult {
  threads: CodexThreadSummary[];
  source: "state-db" | "app-server+logs" | "app-server" | "logs" | "unavailable" | "off" | "mock";
  warnings: string[];
}

export interface CodexOpenResult {
  ok: boolean;
  message: string;
}

export interface PetStats {
  fullness: number;
  affection: number;
  energy: number;
  lastUpdatedAt: number;
  lastFedAt: number | null;
  lastPettedAt: number | null;
  meals: number;
  interactions: number;
  cleanliness: number;
  experience: number;
  level: number;
}

export interface Inventory {
  food: Record<FoodId, number>;
  giftBoxes: number;
}

export interface RewardBundle {
  food: Partial<Record<FoodId, number>>;
  giftBoxes: number;
  experience: number;
}

export interface ActiveJob {
  id: JobId;
  startedAt: number;
  completesAt: number;
  reward: RewardBundle;
}

export interface DailyQuest {
  id: string;
  kind: QuestKind;
  title: string;
  target: number;
  progress: number;
  reward: RewardBundle;
  claimed: boolean;
}

export interface GameSettlement {
  gameId: GameId;
  score: number;
  affection: number;
  experience: number;
}

export type CareOperationResult =
  | { ok: true; data: PersistedData; message?: string }
  | { ok: false; message: string };

export interface Reminder {
  id: string;
  title: string;
  message: string;
  time: string;
  repeat: ReminderRepeat;
  date: string | null;
  days: number[];
  enabled: boolean;
  sound: SoundName;
  lastTriggeredKey: string | null;
}

export interface AppRule {
  id: string;
  name: string;
  appPattern: string;
  state: PetState;
  message: string;
  sound: SoundName;
  notify: boolean;
  enabled: boolean;
}

export interface CompanionSettings {
  overlayVisible: boolean;
  alwaysOnTop: boolean;
  petProfile: PetProfile;
  gazeEnabled: boolean;
  gazeRange: GazeRange;
  gazeFrameRate: 30 | 60;
  animationFrameRate: 30 | 60;
  gazeSmoothingMs: number;
  gazeDeadzonePx: number;
  gazeIdleResetMs: number;
  petSize: number;
  dragRunEnabled: boolean;
  hoverJumpEnabled: boolean;
  hoverJumpCount: number;
  idleActionsEnabled: boolean;
  idleLickEnabled: boolean;
  idleBlinkEnabled: boolean;
  idleScratchEnabled: boolean;
  idleActionIntervalSec: number;
  idleSpeechEnabled: boolean;
  idleSpeechIntervalSec: number;
  codexSessionControls: boolean;
  codexReplyTransport: CodexReplyTransport;
  remindersEnabled: boolean;
  soundEnabled: boolean;
  volume: number;
  systemNotifications: boolean;
  proactiveNotifications: boolean;
  codexNotifications: boolean;
  monitorCodex: boolean;
  monitorApps: boolean;
  startAtLogin: boolean;
  autoSleepEnabled: boolean;
  autoSleepAfterMin: number;
  gameModeEnabled: boolean;
}

export interface ActivityItem {
  id: string;
  at: number;
  source: "interaction" | "reminder" | "codex" | "application" | "system";
  title: string;
  detail: string;
  state: PetState;
}

export interface MonitoringStatus {
  codex: "watching" | "off" | "unavailable";
  applications: "watching" | "off" | "unavailable";
  notifications: "available" | "unavailable" | "off";
  activeApplication: string | null;
  codexBusy: boolean;
  codexStartedAt: number | null;
}

export interface PersistedData {
  version: 3;
  stats: PetStats;
  reminders: Reminder[];
  appRules: AppRule[];
  idlePhrases: string[];
  settings: CompanionSettings;
  sleeping: boolean;
  overlayPosition: { x: number; y: number } | null;
  activity: ActivityItem[];
  proactive: {
    lastHungerNoticeAt: number | null;
    lastEnergyNoticeAt: number | null;
    lastLongWorkNoticeAt: number | null;
  };
  inventory: Inventory;
  activeJob: ActiveJob | null;
  dailyQuestDate: string;
  dailyQuests: DailyQuest[];
  sleepReason: SleepReason;
  codexRewardLedger: string[];
}

export interface AppSnapshot extends PersistedData {
  state: PetState;
  stateMessage: string;
  stateSource: string;
  monitoring: MonitoringStatus;
}

export interface ReminderInput {
  id?: string;
  title: string;
  message: string;
  time: string;
  repeat: ReminderRepeat;
  date: string | null;
  days: number[];
  enabled: boolean;
  sound: SoundName;
}

export interface AppRuleInput {
  id?: string;
  name: string;
  appPattern: string;
  state: PetState;
  message: string;
  sound: SoundName;
  notify: boolean;
  enabled: boolean;
}

export interface CursorPayload {
  x: number;
  y: number;
  windowWidth: number;
  windowHeight: number;
}
