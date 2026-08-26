import path from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
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
  type CodexSessionSummary,
} from "./codex-sessions";
import { FrontmostApplicationMonitor } from "./application-monitor";
import {
  appendActivity,
  clampStat,
  decayStats,
  deriveAmbientState,
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
const CODEX_THREAD_CACHE_MS = 7_000;

interface RuntimeState {
  state: PetState;
  message: string;
  source: string;
  priority: number;
  expiresAt: number | null;
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

const activeCodexTurns = new Map<string, number>();
const activeCodexReplyHandles = new Set<CodexReplyDispatch>();
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
): void {
  const now = Date.now();
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
  broadcast();
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

function performInteraction(action: InteractionAction): AppSnapshot {
  const now = Date.now();
  data.stats = decayStats(data.stats, data.sleeping, now);
  data.stats.interactions += 1;

  if (action === "feed") {
    data.sleeping = false;
    data.stats.fullness = clampStat(data.stats.fullness + 28);
    data.stats.energy = clampStat(data.stats.energy + 3);
    data.stats.affection = clampStat(data.stats.affection + 2);
    data.stats.lastFedAt = now;
    data.stats.meals += 1;
    data.activity = appendActivity(data.activity, {
      source: "interaction",
      title: "喂了小满",
      detail: "饱食度增加",
      state: "eating",
    });
    triggerState("eating", "鱼干真香", "interaction", 4200, 95);
    emitSound("crunch");
  } else if (action === "pet") {
    data.stats.affection = clampStat(data.stats.affection + 4);
    data.stats.lastPettedAt = now;
    data.activity = appendActivity(data.activity, {
      source: "interaction",
      title: "摸了摸小满",
      detail: "好感度增加",
      state: "affectionate",
    });
    triggerState("affectionate", "再摸一下也可以", "interaction", 3200, 90);
    emitSound("purr");
  } else if (action === "play") {
    data.sleeping = false;
    data.stats.affection = clampStat(data.stats.affection + 3);
    data.stats.energy = clampStat(data.stats.energy - 7);
    data.stats.fullness = clampStat(data.stats.fullness - 2);
    data.activity = appendActivity(data.activity, {
      source: "interaction",
      title: "陪小满玩耍",
      detail: "消耗了一点精力",
      state: "playful",
    });
    triggerState("playful", "抓到你了", "interaction", 3800, 90);
    emitSound("pop");
  } else if (action === "sleep") {
    data.sleeping = true;
    data.activity = appendActivity(data.activity, {
      source: "interaction",
      title: "小满去睡觉",
      detail: "开始恢复精力",
      state: "sleeping",
    });
    triggerState("sleeping", "晚安", "interaction", null, 45);
    emitSound("purr");
  } else if (action === "wake") {
    data.sleeping = false;
    data.stats.energy = clampStat(data.stats.energy + 2);
    data.activity = appendActivity(data.activity, {
      source: "interaction",
      title: "叫醒小满",
      detail: "已经醒来",
      state: "happy",
    });
    triggerState("happy", "我醒啦", "interaction", 2600, 90);
    emitSound("meow");
  } else {
    data.sleeping = false;
    data.stats.affection = clampStat(data.stats.affection + 1);
    data.activity = appendActivity(data.activity, {
      source: "interaction",
      title: "和小满庆祝",
      detail: "今天也有好进展",
      state: "celebrating",
    });
    triggerState("celebrating", "值得庆祝", "interaction", 4200, 92);
    emitSound("chime");
  }

  persist();
  broadcast();
  return snapshot();
}

function handleCodexEvent(event: CodexMonitorEvent): void {
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
    triggerState("working", "Codex 正在处理任务", "codex", null, 70);
    persist();
    return;
  }

  if (event.kind === "waiting") {
    triggerState("waiting", "Codex 在等你回应", "codex", null, 82);
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
  data.activity = appendActivity(data.activity, {
    source: "codex",
    title,
    detail: event.kind === "aborted" ? "任务已停止" : "只记录状态，不读取任务内容",
    state,
  });

  if (monitoring.codexBusy) {
    recomputeState(true);
  } else {
    triggerState(state, failed ? "这次需要再看看" : "任务完成啦", "codex", 6500, 88);
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

function runMaintenance(): void {
  data.stats = decayStats(data.stats, data.sleeping);
  const now = Date.now();
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

  persist();
  recomputeState();
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

function codexThreadSummary(session: CodexSessionSummary): CodexThreadSummary {
  const approvalBlocked = session.status.activeFlags.some((flag) => flag.toLowerCase().includes("approval"));
  return {
    id: session.id,
    title: session.title,
    projectName: session.cwd ? path.basename(session.cwd) : "本机任务",
    status: mapCodexThreadStatus(session.status.activity, session.status.runtimeType),
    updatedAt: session.updatedAt,
    activeTurnId: session.status.activeTurnId,
    sourceKind: session.threadSource ?? session.source,
    canReply: canReplyToCodexSession(session),
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
    const result = await codexSessionsService.listSessions({ limit: 20, includeSubagents: false });
    const mapped: CodexThreadListResult = {
      threads: result.sessions.map(codexThreadSummary),
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
  const target = codexSessionsService.getDesktopTarget(threadId);
  if (!target.available) return { ok: false, message: "未找到 ChatGPT/Codex 桌面应用" };
  await shell.openExternal(target.url);
  return { ok: true, message: "已打开对应 Codex 任务" };
}

async function replyToCodexThread(threadId: string, message: string): Promise<CodexReplyResult> {
  if (!data.settings.codexSessionControls) throw new Error("Codex 任务功能已关闭");
  if (codexReplyStarts.has(threadId)) throw new Error("这项任务正在处理上一条回复");
  codexReplyStarts.add(threadId);
  try {
    const session = await codexSessionsService.readSession(threadId);
    const approvalBlocked = session?.status.activeFlags.some((flag) => flag.toLowerCase().includes("approval")) ?? false;
    if (approvalBlocked) {
      throw new Error("该任务正在等待授权，请在 Codex 中处理");
    }
    if (session && !canReplyToCodexSession(session)) {
      throw new Error("该任务当前状态不支持直接回复，请在 Codex 中查看");
    }
    let dispatch: CodexReplyDispatch;
    try {
      dispatch = await codexSessionsService.sendReply({
        threadId,
        message,
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
      message: mode === "queued" ? "回复已排队；当前回复结束后会自动继续" : "任务已启动，正在后台执行",
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

function assertTrustedInvoke(event: IpcMainInvokeEvent): void {
  const trustedContents = [overlayWindow?.webContents, centerWindow?.webContents]
    .filter((contents) => contents && !contents.isDestroyed());
  if (!trustedContents.includes(event.sender) || event.senderFrame !== event.sender.mainFrame) {
    throw new Error("Rejected IPC call from an untrusted renderer");
  }
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
  monitoring.notifications = !data.settings.systemNotifications
    ? "off"
    : Notification.isSupported()
      ? "available"
      : "unavailable";
}

async function configureCodexMonitor(): Promise<void> {
  await codexMonitor?.stop();
  codexMonitor = null;
  if (!data.settings.monitorCodex) {
    monitoring.codex = "off";
    activeCodexTurns.clear();
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
  ipcMain.handle("interaction:perform", (_event, action: InteractionAction) => performInteraction(action));
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
  maintenanceTimer = setInterval(() => runMaintenance(), 60_000);
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
  monitoring.notifications = !data.settings.systemNotifications
    ? "off"
    : Notification.isSupported()
      ? "available"
      : "unavailable";

  registerIpcHandlers();
  createOverlayWindow();
  createCenterWindow();
  createTray();
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
  if (cursorTimer) clearInterval(cursorTimer);
  if (stateTimer) clearTimeout(stateTimer);
  if (overlayPositionSaveTimer) clearTimeout(overlayPositionSaveTimer);
  applicationMonitor?.stop();
  void codexMonitor?.stop();
  for (const handle of activeCodexReplyHandles) handle.cancel();
  activeCodexReplyHandles.clear();
  if (data && store) persist();
});
