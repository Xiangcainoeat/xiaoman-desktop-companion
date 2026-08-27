import path from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  screen,
  Tray,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron";
import { CompanionStore } from "./store";
import { CodexSessionMonitor, type CodexMonitorEvent } from "./codex-monitor";
import {
  canReplyToCodexSession,
  CodexSessionCommandError,
  CodexSessionsService,
  summarizeCodexProcessResult,
  type CodexReplyDispatch,
  type CodexSessionActivity,
  type CodexSessionSummary,
} from "./codex-sessions";
import { FrontmostApplicationMonitor } from "./application-monitor";
import {
  applyBath,
  applyFeed,
  claimDailyQuest as claimCareQuest,
  completePetJob,
  grantCodexCompletionReward,
  openGiftBox as openCareGiftBox,
  startPetJob as startCareJob,
} from "../src/shared/care";
import { settleGameResult } from "../src/shared/games";
import { shouldAutoSleep, type AutoSleepInput } from "../src/shared/sleep";
import {
  appendActivity,
  clampStat,
  createDailyQuests,
  decayStats,
  deriveAmbientState,
  FOOD_IDS,
  isReminderDue,
  makeId,
  normalizeCompanionSettings,
  normalizeIdlePhrases,
  STATE_LABELS,
} from "../src/shared/domain";
import {
  overlayDimensions as calculateOverlayDimensions,
  persistedOverlayPosition,
} from "../src/shared/overlay-layout";
import { mapCodexThreadStatus } from "../src/shared/codex-ui";
import {
  PET_STATES,
  SOUND_NAMES,
  type AppRule,
  type AppRuleInput,
  type AppSnapshot,
  type CompanionSettings,
  type CodexOpenResult,
  type CodexReplyResult,
  type CodexThreadListResult,
  type CodexThreadSummary,
  type FoodId,
  type GameId,
  type GameSettlement,
  type JobId,
  type InteractionAction,
  type PersistedData,
  type PetState,
  type Reminder,
  type ReminderInput,
  type SoundName,
} from "../src/shared/types";

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.setName("小满桌面伴侣");

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const DEFAULT_OVERLAY_WIDTH = 320;
const DEFAULT_OVERLAY_HEIGHT = 360;
const CODEX_THREAD_CACHE_MS = 2_000;
const NATIVE_REPLY_ASSUMED_ACTIVE_MS = 45_000;

interface RuntimeState {
  state: PetState;
  message: string;
  source: string;
  priority: number;
  expiresAt: number | null;
}

export type CareMutation =
  | { kind: "feed"; foodId: FoodId }
  | { kind: "bath" }
  | { kind: "open-gift" }
  | { kind: "start-job"; jobId: JobId }
  | { kind: "cancel-job" }
  | { kind: "claim-quest"; questId: string }
  | { kind: "complete-game"; gameId: GameId; score: number };

export type CareMutationResult =
  | { ok: true; data: PersistedData; message?: string; settlement?: GameSettlement }
  | { ok: false; message: string };

export interface CodexCompletionBoundaryEvent {
  kind: "completed";
  threadId?: string;
  turnId: string;
  at: number;
  recovered?: boolean;
}

const GAME_IDS: GameId[] = ["rock-paper-scissors", "fish-catch", "bubble-pop"];

function isFoodId(value: unknown): value is FoodId {
  return typeof value === "string" && FOOD_IDS.includes(value as FoodId);
}

function isJobId(value: unknown): value is JobId {
  return value === "desk-organizer" || value === "code-helper" || value === "delivery-run";
}

function isGameId(value: unknown): value is GameId {
  return typeof value === "string" && GAME_IDS.includes(value as GameId);
}

function isInteractionAction(value: unknown): value is InteractionAction {
  return value === "feed"
    || value === "pet"
    || value === "play"
    || value === "sleep"
    || value === "wake"
    || value === "celebrate";
}

function cancelPetJob(data: PersistedData): CareMutationResult {
  if (!data.activeJob) return { ok: false, message: "现在没有打工" };
  return { ok: true, data: { ...data, activeJob: null }, message: "已取消打工" };
}

function applyGameSettlement(data: PersistedData, settlement: GameSettlement, now: number): PersistedData {
  const experience = data.stats.experience + settlement.experience;
  return {
    ...data,
    stats: {
      ...data.stats,
      affection: clampStat(data.stats.affection + settlement.affection),
      experience,
      level: Math.max(1, Math.floor(experience / 100) + 1),
      lastUpdatedAt: now,
    },
    dailyQuests: data.dailyQuests.map((quest) => quest.kind === "play" && quest.progress < quest.target
      ? { ...quest, progress: quest.progress + 1 }
      : quest),
  };
}

export function applyCareMutation(input: {
  data: PersistedData;
  operation: CareMutation;
  now: number;
  random?: () => number;
}): CareMutationResult {
  const { data, operation, now, random = Math.random } = input;
  if (operation.kind === "feed") {
    if (!isFoodId(operation.foodId)) return { ok: false, message: "没有这个食物" };
    const result = applyFeed(data, operation.foodId, now);
    return result.ok ? { ok: true, data: result.data, message: result.message ?? "喂食成功" } : result;
  }
  if (operation.kind === "bath") {
    const result = applyBath(data, now);
    return result.ok ? { ok: true, data: result.data, message: result.message ?? "洗澡完成" } : result;
  }
  if (operation.kind === "open-gift") {
    const result = openCareGiftBox(data, random);
    return result.ok ? { ok: true, data: result.data, message: result.message ?? "礼包打开啦" } : result;
  }
  if (operation.kind === "start-job") {
    if (!isJobId(operation.jobId)) return { ok: false, message: "没有这个打工" };
    const result = startCareJob(data, operation.jobId, now);
    return result.ok ? { ok: true, data: result.data, message: result.message ?? "开始打工啦" } : result;
  }
  if (operation.kind === "cancel-job") return cancelPetJob(data);
  if (operation.kind === "claim-quest") {
    if (typeof operation.questId !== "string" || !operation.questId.trim()) return { ok: false, message: "任务不存在" };
    const result = claimCareQuest(data, operation.questId, now);
    return result.ok ? { ok: true, data: result.data, message: result.message ?? "领取成功" } : result;
  }
  if (!isGameId(operation.gameId)) return { ok: false, message: "没有这个小游戏" };
  const settlement = settleGameResult(operation.gameId, operation.score);
  return {
    ok: true,
    data: applyGameSettlement(data, settlement, now),
    message: `游戏完成，得分 ${settlement.score}`,
    settlement,
  };
}

export function settleDuePetJob(data: PersistedData, now: number, random = Math.random): CareMutationResult {
  const jobId = data.activeJob?.id;
  const result = completePetJob(data, now);
  if (!result.ok) return result;
  if (jobId !== "code-helper") return { ok: true, data: result.data, message: result.message ?? "打工完成啦" };
  const rawGiftRoll = random();
  const giftRoll = Number.isFinite(rawGiftRoll) ? Math.max(0, Math.min(0.999999, rawGiftRoll)) : 0.999999;
  const withCodeHelperGift = jobId === "code-helper" && giftRoll < 0.12
    ? {
      ...result.data,
      inventory: { ...result.data.inventory, giftBoxes: Math.min(9999, result.data.inventory.giftBoxes + 1) },
    }
    : result.data;
  return { ok: true, data: withCodeHelperGift, message: result.message ?? "打工完成啦" };
}

export function applyCodexCompletionReward(
  data: PersistedData,
  event: CodexCompletionBoundaryEvent,
  random = Math.random,
): CareMutationResult {
  if (event.recovered || !event.threadId || event.threadId === "unknown" || !event.turnId || event.turnId === "unknown") {
    return { ok: true, data, message: "无奖励" };
  }
  const key = `${event.threadId}:${event.turnId}`;
  if (data.codexRewardLedger.includes(key)) return { ok: true, data };
  const result = grantCodexCompletionReward(data, key, random, event.at);
  return result.ok ? { ok: true, data: result.data, message: result.message ?? "Codex 完成奖励" } : result;
}

export function shouldAutoSleepForRuntime(input: AutoSleepInput): boolean {
  return shouldAutoSleep(input);
}

let store: CompanionStore;
let data: PersistedData;
let overlayWindow: BrowserWindow | null = null;
let centerWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let codexMonitor: CodexSessionMonitor | null = null;
let codexSessionsService: CodexSessionsService;
let applicationMonitor: FrontmostApplicationMonitor | null = null;
let schedulerTimer: NodeJS.Timeout | null = null;
let maintenanceTimer: NodeJS.Timeout | null = null;
let autoSleepTimer: NodeJS.Timeout | null = null;
let cursorTimer: NodeJS.Timeout | null = null;
let stateTimer: NodeJS.Timeout | null = null;
let overlayPositionSaveTimer: NodeJS.Timeout | null = null;
let overlayTaskPanelOpen = false;
let codexThreadCache: { at: number; result: CodexThreadListResult } | null = null;
let codexThreadListInFlight: Promise<CodexThreadListResult> | null = null;
const codexReplyStarts = new Set<string>();
let quitting = false;
let currentAppRule: AppRule | null = null;
let stateSequence = 0;
let gameActive = false;
let lastSystemIdleSeconds: number | null = null;
let careRandomSource: () => number = () => Math.random();

export function setCareRandomSourceForTests(random: () => number): void {
  careRandomSource = random;
}

const activeCodexTurns = new Map<string, number>();
const activeCodexReplyHandles = new Set<CodexReplyDispatch>();
const liveCodexThreadStatuses = new Map<string, {
  activity: CodexSessionActivity;
  activeTurnId: string | null;
  updatedAt: number;
  expiresAt: number | null;
}>();
const LIVE_TERMINAL_STATUS_MS = 45_000;
const monitoring: AppSnapshot["monitoring"] = {
  codex: "off",
  applications: "off",
  notifications: "off",
  activeApplication: null,
  codexBusy: false,
  codexStartedAt: null,
};

let runtimeState: RuntimeState = {
  state: "idle",
  message: STATE_LABELS.idle,
  source: "ambient",
  priority: 10,
  expiresAt: null,
};

function snapshot(): AppSnapshot {
  return {
    ...data,
    state: runtimeState.state,
    stateMessage: runtimeState.message,
    stateSource: runtimeState.source,
    monitoring: { ...monitoring },
  };
}

function persist(): void {
  store.save(data);
}

function broadcast(): void {
  const next = snapshot();
  for (const window of [overlayWindow, centerWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send("snapshot:changed", next);
  }
  updateTrayMenu();
}

function persistAndBroadcast(): void {
  persist();
  broadcast();
}

function clearStateTimer(): void {
  if (stateTimer) clearTimeout(stateTimer);
  stateTimer = null;
}

function triggerState(
  state: PetState,
  message: string,
  source: string,
  durationMs: number | null,
  priority: number,
  shouldBroadcast = true,
): void {
  const now = Date.now();
  // Care actions do not hide a live Codex task or an active reminder.
  if (source === "interaction" && (runtimeState.source === "codex" || runtimeState.source === "reminder")) return;
  if (runtimeState.expiresAt && runtimeState.expiresAt > now && priority < runtimeState.priority) return;
  clearStateTimer();
  const sequence = ++stateSequence;
  runtimeState = {
    state,
    message: message || STATE_LABELS[state],
    source,
    priority,
    expiresAt: durationMs ? now + durationMs : null,
  };
  if (shouldBroadcast) broadcast();
  if (durationMs) {
    stateTimer = setTimeout(() => {
      if (sequence === stateSequence) recomputeState(true);
    }, durationMs);
  }
}

function recomputeState(force = false): void {
  const now = Date.now();
  if (!force && runtimeState.expiresAt && runtimeState.expiresAt > now) return;
  clearStateTimer();
  stateSequence += 1;
  const state = deriveAmbientState(data.stats, data.sleeping, monitoring.codexBusy, currentAppRule?.state ?? null);
  let message = STATE_LABELS[state];
  let source = "ambient";
  let priority = 10;

  if (monitoring.codexBusy) {
    message = "Codex 正在处理任务";
    source = "codex";
    priority = 70;
  } else if (data.sleeping) {
    message = "小满睡着了";
    source = "interaction";
    priority = 45;
  } else if (state === "hungry" || state === "sleepy") {
    source = "needs";
    priority = 40;
  } else if (currentAppRule) {
    message = currentAppRule.message || STATE_LABELS[currentAppRule.state];
    source = "application";
    priority = 30;
  }

  runtimeState = { state, message, source, priority, expiresAt: null };
  broadcast();
}

function emitSound(sound: SoundName): void {
  if (sound === "none" || !data.settings.soundEnabled || data.settings.volume <= 0) return;
  const target = overlayWindow?.isVisible() ? overlayWindow : centerWindow;
  if (target && !target.isDestroyed()) target.webContents.send("sound:play", sound);
}

function showSystemNotification(title: string, body: string): void {
  if (!data.settings.systemNotifications || !Notification.isSupported()) return;
  const notification = new Notification({ title, body, silent: true });
  notification.on("click", () => showCenter());
  notification.show();
}

function wakeInactivitySleep(next: PersistedData): PersistedData {
  return next.sleeping && next.sleepReason === "inactivity"
    ? { ...next, sleeping: false, sleepReason: null }
    : next;
}

function commitCareMutation(
  result: CareMutationResult,
  title: string,
  state: PetState,
  defaultMessage: string,
  sound: SoundName,
  wakesInactivity = true,
): AppSnapshot {
  if (!result.ok) throw new Error(result.message);
  data = wakesInactivity ? wakeInactivitySleep(result.data) : result.data;
  data.activity = appendActivity(data.activity, {
    source: "interaction",
    title,
    detail: result.message || defaultMessage,
    state,
  });
  triggerState(state, result.message || defaultMessage, "interaction", 4200, 92, false);
  emitSound(sound);
  persistAndBroadcast();
  return snapshot();
}

function runCareMutation(
  operation: CareMutation,
  title: string,
  state: PetState,
  message: string,
  sound: SoundName,
  wakesInactivity = true,
): AppSnapshot {
  const now = Date.now();
  rolloverDailyQuests(now);
  const inputData = { ...data, stats: decayStats(data.stats, data.sleeping, now) };
  return commitCareMutation(applyCareMutation({ data: inputData, operation, now, random: careRandomSource }), title, state, message, sound, wakesInactivity);
}

function feedFood(foodId: FoodId): AppSnapshot {
  return runCareMutation({ kind: "feed", foodId }, "喂了小满", "eating", "鱼干真香", "crunch");
}

function bathePet(): AppSnapshot {
  return runCareMutation({ kind: "bath" }, "给小满洗澡", "happy", "洗得香香的", "chime");
}

function openGiftBox(): AppSnapshot {
  return runCareMutation({ kind: "open-gift" }, "打开了礼包", "celebrating", "礼包打开啦", "chime");
}

function startPetJob(jobId: JobId): AppSnapshot {
  return runCareMutation({ kind: "start-job", jobId }, "开始打工", "working", "打工中", "chime");
}

function cancelPetJobIpc(): AppSnapshot {
  return runCareMutation({ kind: "cancel-job" }, "取消打工", "idle", "已取消打工", "none");
}

function claimDailyQuest(questId: string): AppSnapshot {
  return runCareMutation({ kind: "claim-quest", questId }, "领取每日任务奖励", "celebrating", "领取成功", "chime");
}

function completeGame(gameId: GameId, score: number): AppSnapshot {
  return runCareMutation({ kind: "complete-game", gameId, score }, "完成互动游戏", "playful", "游戏完成", "pop");
}

async function performInteraction(action: InteractionAction): Promise<AppSnapshot> {
  if (action === "feed") return feedFood("fish-snack");
  const now = Date.now();
  data = { ...data, stats: decayStats(data.stats, data.sleeping, now) };
  data.stats.interactions += 1;

  if (action === "pet") {
    data = wakeInactivitySleep(data);
    data.stats.affection = clampStat(data.stats.affection + 4);
    data.stats.lastPettedAt = now;
    data.activity = appendActivity(data.activity, {
      source: "interaction",
      title: "摸了摸小满",
      detail: "好感度增加",
      state: "affectionate",
    });
    triggerState("affectionate", "再摸一下也可以", "interaction", 3200, 90, false);
    emitSound("purr");
  } else if (action === "play") {
    data = wakeInactivitySleep(data);
    data.stats.affection = clampStat(data.stats.affection + 3);
    data.stats.energy = clampStat(data.stats.energy - 7);
    data.stats.fullness = clampStat(data.stats.fullness - 2);
    data.activity = appendActivity(data.activity, {
      source: "interaction",
      title: "陪小满玩耍",
      detail: "消耗了一点精力",
      state: "playful",
    });
    triggerState("playful", "抓到你了", "interaction", 3800, 90, false);
    emitSound("pop");
  } else if (action === "sleep") {
    data.sleeping = true;
    data.sleepReason = "manual";
    data.activity = appendActivity(data.activity, {
      source: "interaction",
      title: "小满去睡觉",
      detail: "开始恢复精力",
      state: "sleeping",
    });
    triggerState("sleeping", "晚安", "interaction", null, 45, false);
    emitSound("purr");
  } else if (action === "wake") {
    data.sleeping = false;
    data.sleepReason = null;
    data.stats.energy = clampStat(data.stats.energy + 2);
    data.activity = appendActivity(data.activity, {
      source: "interaction",
      title: "叫醒小满",
      detail: "已经醒来",
      state: "happy",
    });
    triggerState("happy", "我醒啦", "interaction", 2600, 90, false);
    emitSound("meow");
  } else {
    data = wakeInactivitySleep(data);
    data.stats.affection = clampStat(data.stats.affection + 1);
    data.activity = appendActivity(data.activity, {
      source: "interaction",
      title: "和小满庆祝",
      detail: "今天也有好进展",
      state: "celebrating",
    });
    triggerState("celebrating", "值得庆祝", "interaction", 4200, 92, false);
    emitSound("chime");
  }

  persistAndBroadcast();
  return snapshot();
}

function updateLiveCodexThreadStatus(event: CodexMonitorEvent): void {
  if (!event.threadId || event.threadId === "unknown") return;
  if (event.kind === "started") {
    liveCodexThreadStatuses.set(event.threadId, {
      activity: "running",
      activeTurnId: event.turnId,
      updatedAt: event.at,
      expiresAt: null,
    });
    return;
  }
  if (event.kind === "waiting") {
    liveCodexThreadStatuses.set(event.threadId, {
      activity: "waiting",
      activeTurnId: event.turnId,
      updatedAt: event.at,
      expiresAt: null,
    });
    return;
  }
  liveCodexThreadStatuses.set(event.threadId, {
    activity: event.kind === "completed" ? "idle" : "error",
    activeTurnId: null,
    updatedAt: event.at,
    expiresAt: Date.now() + LIVE_TERMINAL_STATUS_MS,
  });
}

function markNativeReplyActive(threadId: string): void {
  const now = Date.now();
  liveCodexThreadStatuses.set(threadId, {
    activity: "running",
    activeTurnId: null,
    updatedAt: now,
    // The state DB can lag the native acknowledgement. Monitor events replace
    // this optimistic marker; otherwise it expires instead of becoming stale.
    expiresAt: now + NATIVE_REPLY_ASSUMED_ACTIVE_MS,
  });
}

function withLiveCodexThreadStatus(session: CodexSessionSummary | null): CodexSessionSummary | null {
  if (!session) return null;
  const live = liveCodexThreadStatuses.get(session.id);
  if (!live) return session;
  if (live.expiresAt !== null && live.expiresAt <= Date.now()) {
    liveCodexThreadStatuses.delete(session.id);
    return session;
  }
  return {
    ...session,
    updatedAt: Math.max(session.updatedAt, live.updatedAt),
    canAcceptDirectInput: session.canAcceptDirectInput
      || live.activity === "running"
      || live.activity === "waiting",
    status: {
      ...session.status,
      activity: live.activity,
      runtimeType: "monitor",
      activeTurnId: live.activeTurnId,
      inferredFromLog: true,
    },
  };
}

function handleCodexEvent(event: CodexMonitorEvent): void {
  updateLiveCodexThreadStatus(event);
  codexThreadCache = null;
  if (event.kind === "started") {
    activeCodexTurns.set(event.turnId, event.at);
    monitoring.codexBusy = true;
    monitoring.codexStartedAt = Math.min(...activeCodexTurns.values());
    if (!event.recovered) {
      data.activity = appendActivity(data.activity, {
        source: "codex",
        title: "Codex 开始工作",
        detail: "检测到新任务",
        state: "working",
      });
    }
    triggerState("working", "Codex 正在处理任务", "codex", null, 70, false);
    persistAndBroadcast();
    return;
  }

  if (event.kind === "waiting") {
    triggerState("waiting", "Codex 在等你回应", "codex", null, 82, false);
    if (!event.recovered) {
      data.activity = appendActivity(data.activity, {
        source: "codex",
        title: "Codex 等待回应",
        detail: "任务需要用户输入",
        state: "waiting",
      });
      emitSound("alert");
    }
    persistAndBroadcast();
    return;
  }

  activeCodexTurns.delete(event.turnId);
  monitoring.codexBusy = activeCodexTurns.size > 0;
  monitoring.codexStartedAt = monitoring.codexBusy ? Math.min(...activeCodexTurns.values()) : null;

  const failed = event.kind === "failed" || event.kind === "aborted";
  const state: PetState = failed ? "failed" : "ready";
  const title = failed ? "Codex 任务未完成" : "Codex 任务完成";
  if (event.kind === "completed") {
    const recovered = "recovered" in event && Boolean(event.recovered);
    const reward = applyCodexCompletionReward(data, { ...event, recovered }, careRandomSource);
    if (reward.ok && reward.data !== data) {
      data = reward.data;
      data.activity = appendActivity(data.activity, {
        source: "codex",
        title: "Codex 完成奖励",
        detail: reward.message ?? "Codex 完成奖励",
        state: "celebrating",
      });
    }
  }
  data.activity = appendActivity(data.activity, {
    source: "codex",
    title,
    detail: event.kind === "aborted" ? "任务已停止" : "只记录状态，不读取任务内容",
    state,
  });

  if (monitoring.codexBusy) {
    recomputeState(true);
  } else {
    triggerState(state, failed ? "这次需要再看看" : "任务完成啦", "codex", 6500, 88, false);
    emitSound(failed ? "alert" : "chime");
    if (data.settings.codexNotifications) showSystemNotification(title, failed ? "小满发现任务状态异常" : "小满来通知你查看结果");
  }
  persistAndBroadcast();
}

function matchesApplication(rule: AppRule, application: string): boolean {
  const normalized = application.toLocaleLowerCase();
  return rule.appPattern
    .split("|")
    .map((part) => part.trim().toLocaleLowerCase())
    .filter(Boolean)
    .some((part) => normalized.includes(part));
}

function handleFrontmostApplication(application: string): void {
  monitoring.activeApplication = application;
  const ownApplication = application.includes("小满桌面伴侣") || application === "Electron";
  const nextRule = ownApplication
    ? null
    : data.appRules.find((rule) => rule.enabled && matchesApplication(rule, application)) ?? null;

  if (nextRule?.id !== currentAppRule?.id) {
    currentAppRule = nextRule;
    if (nextRule) {
      data.activity = appendActivity(data.activity, {
        source: "application",
        title: nextRule.name,
        detail: application,
        state: nextRule.state,
      });
      emitSound(nextRule.sound);
      if (nextRule.notify) showSystemNotification(nextRule.name, nextRule.message);
      persist();
    }
    recomputeState();
  } else {
    broadcast();
  }
}

function runReminderScheduler(now = new Date()): void {
  if (!data.settings.remindersEnabled) return;
  let changed = false;
  for (const reminder of data.reminders) {
    const due = isReminderDue(reminder, now);
    if (!due.due) continue;
    reminder.lastTriggeredKey = due.key;
    if (reminder.repeat === "once") reminder.enabled = false;
    data.activity = appendActivity(data.activity, {
      source: "reminder",
      title: reminder.title,
      detail: reminder.message,
      state: "reminder",
    });
    triggerState("reminder", reminder.message || reminder.title, "reminder", 14_000, 100);
    emitSound(reminder.sound);
    showSystemNotification(reminder.title, reminder.message || "小满提醒你时间到了");
    changed = true;
  }
  if (changed) persistAndBroadcast();
}

function localDateKey(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function rolloverDailyQuests(now: number): boolean {
  const date = localDateKey(now);
  if (data.dailyQuestDate === date && data.dailyQuests.length === 5) return false;
  data = { ...data, dailyQuestDate: date, dailyQuests: createDailyQuests(now) };
  return true;
}

function settleDueJobInMain(now = Date.now()): boolean {
  const result = settleDuePetJob(data, now, careRandomSource);
  if (!result.ok) return false;
  data = result.data;
  data.activity = appendActivity(data.activity, {
    source: "interaction",
    title: "打工完成",
    detail: result.message ?? "打工完成啦",
    state: "celebrating",
  });
  triggerState("celebrating", result.message ?? "打工完成啦", "interaction", 5200, 94, false);
  emitSound("chime");
  return true;
}

function highPriorityReminderActive(): boolean {
  return runtimeState.source === "reminder"
    && (runtimeState.expiresAt === null || runtimeState.expiresAt > Date.now());
}

function runAutoSleepCheck(): void {
  if (!data.settings.autoSleepEnabled) {
    lastSystemIdleSeconds = null;
    return;
  }

  const idleSeconds = powerMonitor.getSystemIdleTime();
  const hadSystemActivity = lastSystemIdleSeconds !== null && idleSeconds < lastSystemIdleSeconds;
  lastSystemIdleSeconds = idleSeconds;

  if (hadSystemActivity && data.sleeping && data.sleepReason === "inactivity") {
    data = { ...data, sleeping: false, sleepReason: null };
    data.activity = appendActivity(data.activity, {
      source: "system",
      title: "小满醒来了",
      detail: "检测到系统活动",
      state: "happy",
    });
    triggerState("happy", "我醒啦", "system", 2600, 85, false);
    persistAndBroadcast();
    return;
  }

  const input: AutoSleepInput = {
    enabled: data.settings.autoSleepEnabled,
    idleSeconds,
    afterMinutes: data.settings.autoSleepAfterMin,
    codexBusy: monitoring.codexBusy,
    reminderActive: highPriorityReminderActive(),
    jobActive: Boolean(data.activeJob),
    gameActive,
    sleeping: data.sleeping,
    manualSleep: data.sleepReason === "manual",
  };
  if (!shouldAutoSleepForRuntime(input)) return;

  data = { ...data, sleeping: true, sleepReason: "inactivity" };
  data.activity = appendActivity(data.activity, {
    source: "system",
    title: "小满进入睡眠",
    detail: "系统空闲时间达到自动睡眠阈值",
    state: "sleeping",
  });
  triggerState("sleeping", "晚安", "system", null, 45, false);
  emitSound("purr");
  persistAndBroadcast();
}

function configurePowerMonitor(): void {
  powerMonitor.on("resume", () => {
    lastSystemIdleSeconds = 0;
    if (data.sleeping && data.sleepReason === "inactivity") {
      data = { ...data, sleeping: false, sleepReason: null };
      data.activity = appendActivity(data.activity, {
        source: "system",
        title: "小满醒来了",
        detail: "系统恢复活动",
        state: "happy",
      });
      triggerState("happy", "我醒啦", "system", 2600, 85, false);
      persistAndBroadcast();
    }
  });
  powerMonitor.on("unlock-screen", () => {
    lastSystemIdleSeconds = 0;
  });
  powerMonitor.on("lock-screen", () => {
    lastSystemIdleSeconds = null;
  });
}

function setGameActive(active: boolean): void {
  gameActive = active && data.settings.gameModeEnabled;
  if (!gameActive || !(data.sleeping && data.sleepReason === "inactivity")) return;
  data = { ...data, sleeping: false, sleepReason: null };
  data.activity = appendActivity(data.activity, {
    source: "interaction",
    title: "开始互动游戏",
    detail: "小满醒来陪你玩",
    state: "playful",
  });
  triggerState("playful", "一起玩吧", "interaction", 2600, 90, false);
  emitSound("pop");
  persistAndBroadcast();
}

function runMaintenance(): void {
  const now = Date.now();
  const questsRolled = rolloverDailyQuests(now);
  const jobSettled = settleDueJobInMain(now);
  data.stats = decayStats(data.stats, data.sleeping);
  const cooldownPassed = (last: number | null, cooldownMs: number) => last === null || now - last >= cooldownMs;

  if (data.settings.proactiveNotifications) {
    if (data.stats.fullness <= 20 && cooldownPassed(data.proactive.lastHungerNoticeAt, 2 * 60 * 60 * 1000)) {
      data.proactive.lastHungerNoticeAt = now;
      showSystemNotification("小满有点饿", "打开小满桌面伴侣喂一份鱼干吧");
      triggerState("hungry", "我好像闻到鱼干了", "needs", 9000, 65);
      emitSound("meow");
    }
    if (data.stats.energy <= 14 && cooldownPassed(data.proactive.lastEnergyNoticeAt, 3 * 60 * 60 * 1000)) {
      data.proactive.lastEnergyNoticeAt = now;
      showSystemNotification("小满困了", "让小满休息一会儿");
      triggerState("sleepy", "眼睛快睁不开了", "needs", 9000, 65);
    }
    if (
      monitoring.codexBusy &&
      monitoring.codexStartedAt &&
      now - monitoring.codexStartedAt >= 25 * 60 * 1000 &&
      cooldownPassed(data.proactive.lastLongWorkNoticeAt, 50 * 60 * 1000)
    ) {
      data.proactive.lastLongWorkNoticeAt = now;
      showSystemNotification("任务仍在运行", "小满还在陪 Codex 工作");
      triggerState("focused", "还在认真盯着任务", "codex", 9000, 75);
    }
  }

  if (jobSettled || questsRolled) persistAndBroadcast();
  else {
    persist();
    recomputeState();
  }
}

function normalizedReminder(input: ReminderInput, existing?: Reminder): Reminder {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) ? input.time : "09:00";
  return {
    id: existing?.id ?? input.id ?? makeId("reminder"),
    title: input.title.trim().slice(0, 40) || "小满提醒",
    message: input.message.trim().slice(0, 120),
    time,
    repeat: ["once", "daily", "weekdays", "weekly"].includes(input.repeat) ? input.repeat : "daily",
    date: input.date || null,
    days: [...new Set(input.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))],
    enabled: Boolean(input.enabled),
    sound: SOUND_NAMES.includes(input.sound) ? input.sound : "chime",
    lastTriggeredKey: existing?.lastTriggeredKey ?? null,
  };
}

function normalizedRule(input: AppRuleInput, existing?: AppRule): AppRule {
  const state = PET_STATES.includes(input.state) ? input.state : "focused";
  return {
    id: existing?.id ?? input.id ?? makeId("rule"),
    name: input.name.trim().slice(0, 32) || "应用事件",
    appPattern: input.appPattern.trim().slice(0, 160),
    state,
    message: input.message.trim().slice(0, 100),
    sound: SOUND_NAMES.includes(input.sound) ? input.sound : "none",
    notify: Boolean(input.notify),
    enabled: Boolean(input.enabled),
  };
}

function canReplyInNativeCodex(session: CodexSessionSummary): boolean {
  if (session.status.activeFlags.some((flag) => flag.toLowerCase().includes("approval"))) return false;
  return session.status.activity === "running"
    || session.status.activity === "waiting"
    || session.status.activity === "idle"
    || session.status.activity === "error"
    || canReplyToCodexSession(session);
}

function codexThreadSummary(
  session: CodexSessionSummary,
  transport: CompanionSettings["codexReplyTransport"],
): CodexThreadSummary {
  const currentSession = withLiveCodexThreadStatus(session)!;
  const approvalBlocked = currentSession.status.activeFlags.some((flag) => flag.toLowerCase().includes("approval"));
  return {
    id: currentSession.id,
    title: currentSession.title,
    projectName: currentSession.cwd ? path.basename(currentSession.cwd) : "本机任务",
    status: mapCodexThreadStatus(currentSession.status.activity, currentSession.status.runtimeType),
    updatedAt: currentSession.updatedAt,
    activeTurnId: currentSession.status.activeTurnId,
    sourceKind: currentSession.threadSource ?? currentSession.source,
    canReply: transport === "native" ? canReplyInNativeCodex(currentSession) : canReplyToCodexSession(currentSession),
    waitReason: approvalBlocked ? "approval" : null,
  };
}

async function listCodexThreads(force = false): Promise<CodexThreadListResult> {
  if (!data.settings.codexSessionControls) {
    codexThreadCache = null;
    return { threads: [], source: "off", warnings: [] };
  }
  if (!force && codexThreadCache && Date.now() - codexThreadCache.at < CODEX_THREAD_CACHE_MS) {
    return codexThreadCache.result;
  }
  if (codexThreadListInFlight) return await codexThreadListInFlight;
  codexThreadListInFlight = (async () => {
    const transport = data.settings.codexReplyTransport;
    const result = await codexSessionsService.listSessions({
      limit: 20,
      includeSubagents: false,
      sourceMode: transport,
    });
    const mapped: CodexThreadListResult = {
      threads: result.sessions.map((session) => codexThreadSummary(session, transport)),
      source: result.source,
      warnings: result.warnings,
    };
    codexThreadCache = { at: Date.now(), result: mapped };
    return mapped;
  })();
  try {
    return await codexThreadListInFlight;
  } finally {
    codexThreadListInFlight = null;
  }
}

async function openCodexThread(threadId: string): Promise<CodexOpenResult> {
  if (!data.settings.codexSessionControls) return { ok: false, message: "Codex 任务功能已关闭" };
  try {
    await codexSessionsService.openDesktopTarget(threadId);
    return { ok: true, message: "已打开对应 Codex 任务" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `无法打开对应 Codex 任务：${detail || "系统未关联 codex:// 协议"}` };
  }
}

async function replyToCodexThread(threadId: string, message: string): Promise<CodexReplyResult> {
  if (!data.settings.codexSessionControls) throw new Error("Codex 任务功能已关闭");
  if (codexReplyStarts.has(threadId)) throw new Error("这项任务正在处理上一条回复");
  codexReplyStarts.add(threadId);
  try {
    const transport = data.settings.codexReplyTransport;
    const session = withLiveCodexThreadStatus(
      await codexSessionsService.readSession(threadId, { sourceMode: transport }),
    );
    const approvalBlocked = session?.status.activeFlags.some((flag) => flag.toLowerCase().includes("approval")) ?? false;
    if (approvalBlocked) {
      throw new Error("该任务正在等待授权，请在 Codex 中处理");
    }
    if (session && (transport === "native" ? !canReplyInNativeCodex(session) : !canReplyToCodexSession(session))) {
      throw new Error("该任务当前状态不支持直接回复，请在 Codex 中查看");
    }
    let dispatch: CodexReplyDispatch;
    try {
      dispatch = await codexSessionsService.sendReply({
        threadId,
        message,
        transport,
        activity: session?.status.activity,
        cwd: session?.cwd,
      });
    } catch (error) {
      if (error instanceof CodexSessionCommandError) {
        throw new Error(error.result ? summarizeCodexProcessResult(error.result) : error.message);
      }
      throw error;
    }
    codexThreadCache = null;
    const usedCliFallback = transport === "native" && dispatch.transport === "exec-resume";
    if (transport === "native" && !usedCliFallback) markNativeReplyActive(threadId);
    const mode = dispatch.transport === "queue" ? "queued" : "started";
    const sessionTitle = session?.title ?? "本机任务";
    data.activity = appendActivity(data.activity, {
      source: "codex",
      title: mode === "queued" ? "已排队 Codex 回复" : "已启动 Codex 任务",
      detail: sessionTitle,
      state: "working",
    });
    triggerState("working", mode === "queued" ? "回复已经排队" : "Codex 已开始继续", "codex", 4200, 86);
    persistAndBroadcast();

    if (dispatch.transport === "exec-resume") {
      activeCodexReplyHandles.add(dispatch);
      const recordFailure = () => {
        data.activity = appendActivity(data.activity, {
          source: "codex",
          title: "Codex 任务继续失败",
          detail: sessionTitle,
          state: "failed",
        });
        triggerState("failed", "继续任务时遇到问题", "codex", 6500, 90);
        persistAndBroadcast();
        if (data.settings.codexNotifications) showSystemNotification("Codex 任务未继续", "请打开任务查看详细状态");
      };
      void dispatch.completion.then((result) => {
        if (result.code !== 0) recordFailure();
      }).catch(recordFailure).finally(() => activeCodexReplyHandles.delete(dispatch));
    }
    return {
      ok: true,
      mode,
      transport: usedCliFallback ? "cli" : transport,
      message: usedCliFallback
        ? "原生 Codex 未持有该任务，已回退到 CLI 继续执行"
        : transport === "native"
          ? "已发送到原生 Codex 窗口，正在继续执行"
        : mode === "queued"
          ? "CLI 兼容回复已排队；当前回复结束后会自动继续"
          : "CLI 兼容任务已启动，正在后台执行",
    };
  } finally {
    codexReplyStarts.delete(threadId);
  }
}

function assetPath(fileName: string): string {
  return isDevelopment
    ? path.join(process.cwd(), "public", "pet", fileName)
    : path.join(app.getAppPath(), "dist", "pet", fileName);
}

async function loadView(window: BrowserWindow, view: "overlay" | "center"): Promise<void> {
  if (isDevelopment) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL!);
    url.searchParams.set("view", view);
    await window.loadURL(url.toString());
  } else {
    await window.loadFile(path.join(app.getAppPath(), "dist", "index.html"), { query: { view } });
  }
}

function hardenRendererWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    const currentUrl = window.webContents.getURL();
    if (currentUrl && targetUrl !== currentUrl) event.preventDefault();
  });
}

function assertTrustedSender(
  sender: IpcMainInvokeEvent["sender"],
  senderFrame: IpcMainInvokeEvent["senderFrame"],
): void {
  const trustedContents = [overlayWindow?.webContents, centerWindow?.webContents]
    .filter((contents) => contents && !contents.isDestroyed());
  if (!trustedContents.includes(sender) || senderFrame !== sender.mainFrame) {
    throw new Error("Rejected IPC call from an untrusted renderer");
  }
}

function assertTrustedInvoke(event: IpcMainInvokeEvent): void {
  assertTrustedSender(event.sender, event.senderFrame);
}

function overlayDimensions(petSize = data.settings.petSize): { width: number; height: number } {
  return calculateOverlayDimensions(petSize, overlayTaskPanelOpen);
}

function defaultOverlayPosition(): { x: number; y: number } {
  const display = screen.getPrimaryDisplay();
  const dimensions = data ? overlayDimensions() : { width: DEFAULT_OVERLAY_WIDTH, height: DEFAULT_OVERLAY_HEIGHT };
  return {
    x: display.workArea.x + display.workArea.width - dimensions.width - 28,
    y: display.workArea.y + display.workArea.height - dimensions.height - 18,
  };
}

function createOverlayWindow(): void {
  const savedPosition = data.overlayPosition ?? defaultOverlayPosition();
  const dimensions = overlayDimensions();
  overlayWindow = new BrowserWindow({
    width: dimensions.width,
    height: dimensions.height,
    x: savedPosition.x,
    y: savedPosition.y,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: data.settings.alwaysOnTop,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  hardenRendererWindow(overlayWindow);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setHiddenInMissionControl(true);
  overlayWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      setOverlayTaskPanel(false);
      overlayWindow?.hide();
      data.settings.overlayVisible = false;
      persistAndBroadcast();
    }
  });
  overlayWindow.on("ready-to-show", () => {
    if (data.settings.overlayVisible) overlayWindow?.showInactive();
    broadcast();
  });
  void loadView(overlayWindow, "overlay");
}

function createCenterWindow(): void {
  centerWindow = new BrowserWindow({
    width: 1080,
    height: 730,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: "小满桌面伴侣",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#f4f5f2",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  hardenRendererWindow(centerWindow);
  centerWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      centerWindow?.hide();
    }
  });
  centerWindow.on("ready-to-show", () => {
    broadcast();
  });
  void loadView(centerWindow, "center");
}

function showCenter(): void {
  if (!centerWindow || centerWindow.isDestroyed()) createCenterWindow();
  centerWindow?.show();
  centerWindow?.focus();
}

function toggleOverlay(): void {
  if (!overlayWindow) return;
  data.settings.overlayVisible = !overlayWindow.isVisible();
  if (data.settings.overlayVisible) overlayWindow.showInactive();
  else {
    setOverlayTaskPanel(false);
    overlayWindow.hide();
  }
  persistAndBroadcast();
}

function createTray(): void {
  const source = nativeImage.createFromPath(assetPath("tray.png"));
  const icon = source.isEmpty() ? nativeImage.createEmpty() : source.resize({ width: 18, height: 18 });
  if (process.platform === "darwin" && !icon.isEmpty()) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("小满桌面伴侣");
  tray.on("click", () => showCenter());
  updateTrayMenu();
}

function updateTrayMenu(): void {
  if (!tray) return;
  const template: MenuItemConstructorOptions[] = [
    { label: `小满 · ${STATE_LABELS[runtimeState.state]}`, enabled: false },
    { type: "separator" },
    { label: "打开控制中心", click: () => showCenter() },
    { label: data.settings.overlayVisible ? "隐藏小满" : "显示小满", click: () => toggleOverlay() },
    { type: "separator" },
    { label: "喂鱼干", click: () => performInteraction("feed") },
    { label: "摸摸", click: () => performInteraction("pet") },
    { label: "一起玩", click: () => performInteraction("play") },
    { label: data.sleeping ? "叫醒" : "睡觉", click: () => performInteraction(data.sleeping ? "wake" : "sleep") },
    { type: "separator" },
    { label: "退出小满桌面伴侣", click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function showOverlayContextMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    { label: "喂鱼干", click: () => performInteraction("feed") },
    { label: "摸摸", click: () => performInteraction("pet") },
    { label: "一起玩", click: () => performInteraction("play") },
    { label: data.sleeping ? "叫醒" : "睡觉", click: () => performInteraction(data.sleeping ? "wake" : "sleep") },
    { type: "separator" },
    { label: "打开控制中心", click: () => showCenter() },
    { label: "隐藏小满", click: () => toggleOverlay() },
  ];
  Menu.buildFromTemplate(template).popup({ window: overlayWindow ?? undefined });
}

function scheduleOverlayPositionSave(): void {
  if (overlayPositionSaveTimer) clearTimeout(overlayPositionSaveTimer);
  overlayPositionSaveTimer = setTimeout(() => {
    if (!overlayWindow) return;
    data.overlayPosition = persistedOverlayPosition(overlayWindow.getBounds(), data.settings.petSize);
    persist();
  }, 450);
}

function moveOverlayBy(deltaX: number, deltaY: number): void {
  if (!overlayWindow || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
  const bounds = overlayWindow.getBounds();
  const target = {
    x: Math.round(bounds.x + Math.max(-80, Math.min(80, deltaX))),
    y: Math.round(bounds.y + Math.max(-80, Math.min(80, deltaY))),
    width: bounds.width,
    height: bounds.height,
  };
  const workArea = screen.getDisplayMatching(target).workArea;
  const x = Math.max(workArea.x - 30, Math.min(target.x, workArea.x + workArea.width - 100));
  const y = Math.max(workArea.y, Math.min(target.y, workArea.y + workArea.height - 100));
  overlayWindow.setPosition(x, y, false);
  scheduleOverlayPositionSave();
}

function resizeOverlayForPet(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const bounds = overlayWindow.getBounds();
  const dimensions = overlayDimensions();
  if (bounds.width === dimensions.width && bounds.height === dimensions.height) return;
  const target = {
    x: bounds.x + bounds.width - dimensions.width,
    y: bounds.y + bounds.height - dimensions.height,
    ...dimensions,
  };
  const workArea = screen.getDisplayMatching(target).workArea;
  target.x = Math.max(workArea.x - 30, Math.min(target.x, workArea.x + workArea.width - 100));
  target.y = Math.max(workArea.y, Math.min(target.y, workArea.y + workArea.height - 100));
  overlayWindow.setBounds(target, false);
  data.overlayPosition = persistedOverlayPosition(target, data.settings.petSize);
}

function setOverlayTaskPanel(open: boolean): void {
  const next = Boolean(open) && data.settings.codexSessionControls;
  if (overlayTaskPanelOpen === next) return;
  overlayTaskPanelOpen = next;
  resizeOverlayForPet();
  if (next && overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show();
    overlayWindow.focus();
  }
}

function applySettingsSideEffects(previous: CompanionSettings): void {
  if (overlayWindow) {
    overlayWindow.setAlwaysOnTop(data.settings.alwaysOnTop);
    if (data.settings.overlayVisible && !overlayWindow.isVisible()) overlayWindow.showInactive();
    if (!data.settings.overlayVisible && overlayWindow.isVisible()) overlayWindow.hide();
  }
  if (previous.monitorCodex !== data.settings.monitorCodex) void configureCodexMonitor();
  if (previous.monitorApps !== data.settings.monitorApps) configureApplicationMonitor();
  if (previous.gazeFrameRate !== data.settings.gazeFrameRate) configureCursorTimer();
  if (previous.petSize !== data.settings.petSize) resizeOverlayForPet();
  if (previous.codexSessionControls && !data.settings.codexSessionControls) setOverlayTaskPanel(false);
  if (previous.startAtLogin !== data.settings.startAtLogin && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: data.settings.startAtLogin });
  }
  if (previous.codexReplyTransport !== data.settings.codexReplyTransport) codexThreadCache = null;
  if (previous.gameModeEnabled && !data.settings.gameModeEnabled) gameActive = false;
  monitoring.notifications = !data.settings.systemNotifications
    ? "off"
    : Notification.isSupported()
      ? "available"
      : "unavailable";
}

async function configureCodexMonitor(): Promise<void> {
  await codexMonitor?.stop();
  codexMonitor = null;
  liveCodexThreadStatuses.clear();
  if (!data.settings.monitorCodex) {
    monitoring.codex = "off";
    activeCodexTurns.clear();
    liveCodexThreadStatuses.clear();
    monitoring.codexBusy = false;
    monitoring.codexStartedAt = null;
    recomputeState(true);
    return;
  }
  monitoring.codex = "watching";
  codexMonitor = new CodexSessionMonitor(
    codexSessionsService.sessionsRoot,
    handleCodexEvent,
    (available) => {
      monitoring.codex = available ? "watching" : "unavailable";
      broadcast();
    },
  );
  await codexMonitor.start();
  broadcast();
}

function configureApplicationMonitor(): void {
  applicationMonitor?.stop();
  applicationMonitor = null;
  if (!data.settings.monitorApps) {
    monitoring.applications = "off";
    monitoring.activeApplication = null;
    currentAppRule = null;
    recomputeState(true);
    return;
  }
  monitoring.applications = "watching";
  applicationMonitor = new FrontmostApplicationMonitor(handleFrontmostApplication, (available) => {
    monitoring.applications = available ? "watching" : "unavailable";
    broadcast();
  });
  applicationMonitor.start();
}

function registerIpcHandlers(): void {
  ipcMain.handle("snapshot:get", () => snapshot());
  ipcMain.handle("interaction:perform", (event, action: unknown) => {
    assertTrustedInvoke(event);
    if (!isInteractionAction(action)) throw new Error("没有这个互动动作");
    return performInteraction(action);
  });
  ipcMain.handle("care:feed-food", (event, foodId: FoodId) => {
    assertTrustedInvoke(event);
    if (!isFoodId(foodId)) throw new Error("没有这个食物");
    return feedFood(foodId);
  });
  ipcMain.handle("care:bathe-pet", (event) => {
    assertTrustedInvoke(event);
    return bathePet();
  });
  ipcMain.handle("care:open-gift-box", (event) => {
    assertTrustedInvoke(event);
    return openGiftBox();
  });
  ipcMain.handle("care:start-pet-job", (event, jobId: JobId) => {
    assertTrustedInvoke(event);
    if (!isJobId(jobId)) throw new Error("没有这个打工");
    return startPetJob(jobId);
  });
  ipcMain.handle("care:cancel-pet-job", (event) => {
    assertTrustedInvoke(event);
    return cancelPetJobIpc();
  });
  ipcMain.handle("care:claim-daily-quest", (event, questId: string) => {
    assertTrustedInvoke(event);
    if (typeof questId !== "string" || !questId.trim()) throw new Error("任务不存在");
    return claimDailyQuest(questId);
  });
  ipcMain.on("game:set-active", (event, active: unknown) => {
    assertTrustedSender(event.sender, event.senderFrame);
    if (typeof active === "boolean") setGameActive(active);
  });
  ipcMain.handle("game:complete", (event, gameId: GameId, score: number) => {
    assertTrustedInvoke(event);
    if (!isGameId(gameId)) throw new Error("没有这个小游戏");
    if (!data.settings.gameModeEnabled) throw new Error("小游戏模式已关闭");
    return completeGame(gameId, score);
  });
  ipcMain.handle("reminder:save", (_event, input: ReminderInput) => {
    const index = input.id ? data.reminders.findIndex((item) => item.id === input.id) : -1;
    const reminder = normalizedReminder(input, index >= 0 ? data.reminders[index] : undefined);
    if (index >= 0) data.reminders[index] = reminder;
    else data.reminders.push(reminder);
    persistAndBroadcast();
    return snapshot();
  });
  ipcMain.handle("reminder:remove", (_event, id: string) => {
    data.reminders = data.reminders.filter((item) => item.id !== id);
    persistAndBroadcast();
    return snapshot();
  });
  ipcMain.handle("reminder:toggle", (_event, id: string) => {
    const reminder = data.reminders.find((item) => item.id === id);
    if (reminder) reminder.enabled = !reminder.enabled;
    persistAndBroadcast();
    return snapshot();
  });
  ipcMain.handle("rule:save", (_event, input: AppRuleInput) => {
    const index = input.id ? data.appRules.findIndex((item) => item.id === input.id) : -1;
    const rule = normalizedRule(input, index >= 0 ? data.appRules[index] : undefined);
    if (index >= 0) data.appRules[index] = rule;
    else data.appRules.push(rule);
    persistAndBroadcast();
    return snapshot();
  });
  ipcMain.handle("rule:remove", (_event, id: string) => {
    data.appRules = data.appRules.filter((item) => item.id !== id);
    if (currentAppRule?.id === id) currentAppRule = null;
    persistAndBroadcast();
    recomputeState(true);
    return snapshot();
  });
  ipcMain.handle("rule:toggle", (_event, id: string) => {
    const rule = data.appRules.find((item) => item.id === id);
    if (rule) rule.enabled = !rule.enabled;
    if (currentAppRule?.id === id && !rule?.enabled) currentAppRule = null;
    persistAndBroadcast();
    recomputeState(true);
    return snapshot();
  });
  ipcMain.handle("settings:update", (_event, patch: Partial<CompanionSettings>) => {
    const previous = { ...data.settings };
    data.settings = normalizeCompanionSettings({ ...data.settings, ...patch });
    applySettingsSideEffects(previous);
    persistAndBroadcast();
    return snapshot();
  });
  ipcMain.handle("idle-phrases:update", (_event, phrases: unknown) => {
    data.idlePhrases = normalizeIdlePhrases(phrases);
    persistAndBroadcast();
    return snapshot();
  });
  ipcMain.handle("notification:test", () => {
    showSystemNotification("小满桌面伴侣", "系统通知工作正常");
    emitSound("chime");
  });
  ipcMain.handle("activity:clear", () => {
    data.activity = [];
    persistAndBroadcast();
    return snapshot();
  });
  ipcMain.handle("codex:threads:list", (event, force: boolean) => {
    assertTrustedInvoke(event);
    return listCodexThreads(Boolean(force));
  });
  ipcMain.handle("codex:thread:open", (event, threadId: string) => {
    assertTrustedInvoke(event);
    return openCodexThread(threadId);
  });
  ipcMain.handle("codex:thread:reply", (event, threadId: string, message: string) => {
    assertTrustedInvoke(event);
    return replyToCodexThread(threadId, message);
  });
  ipcMain.on("center:show", () => showCenter());
  ipcMain.on("overlay:toggle", () => toggleOverlay());
  ipcMain.on("overlay:task-panel", (_event, open: boolean) => setOverlayTaskPanel(open));
  ipcMain.on("overlay:move-by", (_event, deltaX: number, deltaY: number) => moveOverlayBy(deltaX, deltaY));
  ipcMain.on("overlay:context-menu", () => showOverlayContextMenu());
}

function startTimers(): void {
  schedulerTimer = setInterval(() => runReminderScheduler(), 10_000);
  maintenanceTimer = setInterval(() => runMaintenance(), 10_000);
  autoSleepTimer = setInterval(() => runAutoSleepCheck(), 1_000);
  configureCursorTimer();
}

function configureCursorTimer(): void {
  if (cursorTimer) clearInterval(cursorTimer);
  cursorTimer = setInterval(() => {
    if (!overlayWindow?.isVisible() || !data.settings.gazeEnabled) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = overlayWindow.getBounds();
    overlayWindow.webContents.send("cursor:changed", {
      x: cursor.x - bounds.x,
      y: cursor.y - bounds.y,
      windowWidth: bounds.width,
      windowHeight: bounds.height,
    });
  }, 1000 / data.settings.gazeFrameRate);
}

app.on("second-instance", () => showCenter());

app.whenReady().then(async () => {
  store = new CompanionStore(app.getPath("userData"));
  data = store.load();
  codexSessionsService = new CodexSessionsService();
  data.stats = decayStats(data.stats, data.sleeping);
  const dailyQuestsRolled = rolloverDailyQuests(Date.now());
  const jobSettled = settleDueJobInMain();
  if (dailyQuestsRolled && !jobSettled) persist();
  else if (jobSettled) persistAndBroadcast();
  monitoring.notifications = !data.settings.systemNotifications
    ? "off"
    : Notification.isSupported()
      ? "available"
      : "unavailable";

  registerIpcHandlers();
  createOverlayWindow();
  createCenterWindow();
  createTray();
  configurePowerMonitor();
  startTimers();
  await configureCodexMonitor();
  configureApplicationMonitor();
  recomputeState(true);
  runReminderScheduler();
});

app.on("activate", () => showCenter());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  quitting = true;
  if (schedulerTimer) clearInterval(schedulerTimer);
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  if (autoSleepTimer) clearInterval(autoSleepTimer);
  if (cursorTimer) clearInterval(cursorTimer);
  if (stateTimer) clearTimeout(stateTimer);
  if (overlayPositionSaveTimer) clearTimeout(overlayPositionSaveTimer);
  applicationMonitor?.stop();
  void codexMonitor?.stop();
  for (const handle of activeCodexReplyHandles) handle.cancel();
  activeCodexReplyHandles.clear();
  if (data && store) persist();
});
