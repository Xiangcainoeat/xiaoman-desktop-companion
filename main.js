"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyCareMutation = applyCareMutation;
exports.settleDuePetJob = settleDuePetJob;
exports.applyCodexCompletionReward = applyCodexCompletionReward;
exports.shouldAutoSleepForRuntime = shouldAutoSleepForRuntime;
exports.canCompleteGame = canCompleteGame;
exports.transitionGameActivity = transitionGameActivity;
exports.createDesktopBubbleSessionState = createDesktopBubbleSessionState;
exports.startDesktopBubbleSessionState = startDesktopBubbleSessionState;
exports.hitDesktopBubbleState = hitDesktopBubbleState;
exports.stopDesktopBubbleSessionState = stopDesktopBubbleSessionState;
exports.createQuickLoadController = createQuickLoadController;
exports.teardownQuickWindow = teardownQuickWindow;
exports.ensureQuickWindow = ensureQuickWindow;
exports.isTrustedSender = isTrustedSender;
exports.normalizeOverlayInteractionReport = normalizeOverlayInteractionReport;
exports.createOverlayHitRegionState = createOverlayHitRegionState;
exports.acceptOverlayHitRegionReport = acceptOverlayHitRegionReport;
exports.shouldCaptureOverlayPointer = shouldCaptureOverlayPointer;
exports.isTrustedOverlaySender = isTrustedOverlaySender;
exports.setOverlayPointerCaptureForWindow = setOverlayPointerCaptureForWindow;
exports.setOverlayMouseModeForWindow = setOverlayMouseModeForWindow;
exports.setCareRandomSourceForTests = setCareRandomSourceForTests;
exports.startDesktopBubbleSession = startDesktopBubbleSession;
exports.hitDesktopBubble = hitDesktopBubble;
exports.stopDesktopBubbleSession = stopDesktopBubbleSession;
exports.showQuickWindow = showQuickWindow;
exports.setOverlayMouseMode = setOverlayMouseMode;
const node_path_1 = __importDefault(require("node:path"));
const electron_1 = require("electron");
const store_1 = require("./store");
const codex_monitor_1 = require("./codex-monitor");
const codex_sessions_1 = require("./codex-sessions");
const application_monitor_1 = require("./application-monitor");
const article_game_host_1 = require("./article-game-host");
const care_1 = require("../src/shared/care");
const games_1 = require("../src/shared/games");
const sleep_1 = require("../src/shared/sleep");
const domain_1 = require("../src/shared/domain");
const overlay_layout_1 = require("../src/shared/overlay-layout");
const codex_ui_1 = require("../src/shared/codex-ui");
const desktop_interaction_1 = require("../src/shared/desktop-interaction");
const types_1 = require("../src/shared/types");
const registry_1 = require("../src/article-games/registry");
const layout_1 = require("../src/article-games/layout");
const pet_pack_service_1 = require("./pet-pack-service");
const runtime_1 = require("../src/pet-pack/runtime");
const prompt_1 = require("../src/pet-studio/prompt");
electron_1.app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
electron_1.app.setName("小满桌面伴侣");
const gotSingleInstanceLock = electron_1.app.requestSingleInstanceLock();
if (!gotSingleInstanceLock)
    electron_1.app.quit();
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const DEFAULT_OVERLAY_WIDTH = 320;
const DEFAULT_OVERLAY_HEIGHT = 360;
const CENTER_WINDOW_MIN_SIZE = { width: 900, height: 640 };
const CODEX_THREAD_CACHE_MS = 2_000;
const NATIVE_REPLY_ASSUMED_ACTIVE_MS = 45_000;
const GAME_IDS = games_1.REWARDED_GAME_IDS;
function isFoodId(value) {
    return typeof value === "string" && domain_1.FOOD_IDS.includes(value);
}
function isJobId(value) {
    return value === "desk-organizer" || value === "code-helper" || value === "delivery-run";
}
function isGameId(value) {
    return (0, games_1.isRewardedGameId)(value);
}
function isInteractionAction(value) {
    return value === "feed"
        || value === "pet"
        || value === "play"
        || value === "sleep"
        || value === "wake"
        || value === "celebrate";
}
function cancelPetJob(data) {
    if (!data.activeJob)
        return { ok: false, message: "现在没有打工" };
    return { ok: true, data: { ...data, activeJob: null }, message: "已取消打工" };
}
function applyGameSettlement(data, settlement, now) {
    const experience = data.stats.experience + settlement.experience;
    return {
        ...data,
        stats: {
            ...data.stats,
            affection: (0, domain_1.clampStat)(data.stats.affection + settlement.affection),
            experience,
            level: Math.max(1, Math.floor(experience / 100) + 1),
            lastUpdatedAt: now,
        },
        dailyQuests: data.dailyQuests.map((quest) => quest.kind === "play" && quest.progress < quest.target
            ? { ...quest, progress: quest.progress + 1 }
            : quest),
    };
}
function applyCareMutation(input) {
    const { data, operation, now, random = Math.random } = input;
    if (operation.kind === "feed") {
        if (!isFoodId(operation.foodId))
            return { ok: false, message: "没有这个食物" };
        const result = (0, care_1.applyFeed)(data, operation.foodId, now);
        return result.ok ? { ok: true, data: result.data, message: result.message ?? "喂食成功" } : result;
    }
    if (operation.kind === "bath") {
        const result = (0, care_1.applyBath)(data, now);
        return result.ok ? { ok: true, data: result.data, message: result.message ?? "洗澡完成" } : result;
    }
    if (operation.kind === "open-gift") {
        const result = (0, care_1.openGiftBox)(data, random);
        return result.ok ? { ok: true, data: result.data, message: result.message ?? "礼包打开啦" } : result;
    }
    if (operation.kind === "start-job") {
        if (!isJobId(operation.jobId))
            return { ok: false, message: "没有这个打工" };
        const result = (0, care_1.startPetJob)(data, operation.jobId, now);
        return result.ok ? { ok: true, data: result.data, message: result.message ?? "开始打工啦" } : result;
    }
    if (operation.kind === "complete-job") {
        const result = settleDuePetJob(data, now, random);
        return result.ok ? { ok: true, data: result.data, message: result.message ?? "打工完成啦" } : result;
    }
    if (operation.kind === "cancel-job")
        return cancelPetJob(data);
    if (operation.kind === "claim-quest") {
        if (typeof operation.questId !== "string" || !operation.questId.trim())
            return { ok: false, message: "任务不存在" };
        const result = (0, care_1.claimDailyQuest)(data, operation.questId, now);
        return result.ok ? { ok: true, data: result.data, message: result.message ?? "领取成功" } : result;
    }
    if (!isGameId(operation.gameId))
        return { ok: false, message: "没有这个小游戏" };
    const settlement = (0, games_1.settleGameResult)(operation.gameId, operation.score);
    return {
        ok: true,
        data: applyGameSettlement(data, settlement, now),
        message: `游戏完成，得分 ${settlement.score}`,
        settlement,
    };
}
function settleDuePetJob(data, now, random = Math.random) {
    const result = (0, care_1.completePetJob)(data, now, random);
    if (!result.ok)
        return result;
    return { ok: true, data: result.data, message: result.message ?? "打工完成啦" };
}
function applyCodexCompletionReward(data, event, random = Math.random) {
    if (event.recovered || !event.threadId || event.threadId === "unknown" || !event.turnId || event.turnId === "unknown") {
        return { ok: true, data, message: "无奖励" };
    }
    const key = `${event.threadId}:${event.turnId}`;
    if (data.codexRewardLedger.includes(key))
        return { ok: true, data };
    const result = (0, care_1.grantCodexCompletionReward)(data, key, random, event.at);
    return result.ok ? { ok: true, data: result.data, message: result.message ?? "Codex 完成奖励" } : result;
}
function shouldAutoSleepForRuntime(input) {
    return (0, sleep_1.shouldAutoSleep)(input);
}
function canCompleteGame(gameActive, gameModeEnabled, desktopSessionActive = false) {
    return gameActive && gameModeEnabled && !desktopSessionActive;
}
function transitionGameActivity(currentActive, desktopSessionActive, requestedActive, gameModeEnabled) {
    if (desktopSessionActive)
        return { accepted: false, active: currentActive };
    return { accepted: true, active: requestedActive && gameModeEnabled };
}
function createDesktopBubbleSessionState() {
    return {
        status: { active: false, sessionId: null, startedAt: null, score: 0 },
        hitIds: new Set(),
        lastSessionId: null,
    };
}
function startDesktopBubbleSessionState(state, now, gameModeEnabled, gameActive, sessionIdFactory = () => (0, domain_1.makeId)("desktop-session")) {
    if (state.status.active || !gameModeEnabled || gameActive)
        return state;
    return {
        status: {
            active: true,
            sessionId: sessionIdFactory(),
            startedAt: now,
            score: 0,
        },
        hitIds: new Set(),
        lastSessionId: null,
    };
}
function hitDesktopBubbleState(state, sessionId, bubbleId, now) {
    if (!(0, desktop_interaction_1.canHitDesktopBubble)(state.status, sessionId, bubbleId, now, state.hitIds)) {
        return { accepted: false, state };
    }
    const hitIds = new Set(state.hitIds);
    hitIds.add(bubbleId);
    return {
        accepted: true,
        state: {
            ...state,
            status: { ...state.status, score: Math.min(desktop_interaction_1.DESKTOP_BUBBLE_MAX_HITS, state.status.score + 1) },
            hitIds,
        },
    };
}
function stopDesktopBubbleSessionState(state, sessionId, completed, now) {
    if (!state.status.active) {
        return {
            state,
            settlement: null,
            accepted: state.lastSessionId === sessionId,
            changed: false,
        };
    }
    if (state.status.sessionId !== sessionId)
        return { state, settlement: null, accepted: false, changed: false };
    const expired = state.status.startedAt === null
        || now >= state.status.startedAt + desktop_interaction_1.DESKTOP_SESSION_DURATION_MS;
    const nextState = {
        status: { active: false, sessionId: null, startedAt: null, score: 0 },
        hitIds: new Set(),
        lastSessionId: sessionId,
    };
    return {
        state: nextState,
        settlement: completed && !expired ? (0, games_1.settleGameResult)("bubble-pop", state.status.score) : null,
        accepted: true,
        changed: true,
    };
}
function createQuickLoadController(load, isCurrent, onError = () => undefined) {
    let generation = 0;
    let queue = Promise.resolve();
    const enqueue = (window, mode) => {
        const requestGeneration = ++generation;
        queue = queue
            .catch(() => undefined)
            .then(async () => {
            if (requestGeneration !== generation || !isCurrent(window))
                return;
            try {
                await load(window, mode);
            }
            catch (error) {
                if (requestGeneration !== generation || !isCurrent(window))
                    return;
                try {
                    onError(error, window, mode);
                }
                catch {
                    // Error reporting must not create a second unhandled rejection.
                }
            }
        });
        void queue.catch(() => undefined);
    };
    return {
        enqueue,
        invalidate: () => {
            generation += 1;
        },
    };
}
function teardownQuickWindow(current, target) {
    if (current !== target)
        return current;
    if (!target.isDestroyed())
        target.destroy();
    return null;
}
function ensureQuickWindow(current, mode, createWindow, loadMode) {
    const window = current && !current.isDestroyed() ? current : createWindow();
    loadMode(window, mode);
    window.show();
    window.focus();
    return window;
}
function isTrustedSender(sender, senderFrame, trustedContents) {
    const mainFrame = sender?.mainFrame;
    return trustedContents.includes(sender) && senderFrame === mainFrame;
}
const MAX_OVERLAY_REGION_COORDINATE = 100_000;
const MAX_OVERLAY_REGION_SIZE = 20_000;
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}
function normalizeOverlayHitRegion(value, expectedKind) {
    if (!isRecord(value) || value.kind !== expectedKind)
        return null;
    const { x, y, width, height } = value;
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height))
        return null;
    if (width <= 0 || height <= 0 || width > MAX_OVERLAY_REGION_SIZE || height > MAX_OVERLAY_REGION_SIZE)
        return null;
    if (Math.abs(x) > MAX_OVERLAY_REGION_COORDINATE || Math.abs(y) > MAX_OVERLAY_REGION_COORDINATE)
        return null;
    return { kind: expectedKind, x, y, width, height };
}
function normalizeOverlayHitRegions(value, expectedKind) {
    if (!Array.isArray(value) || value.length > types_1.MAX_OVERLAY_HIT_REGIONS)
        return null;
    const regions = value.map((item) => normalizeOverlayHitRegion(item, expectedKind));
    return regions.every((region) => region !== null) ? regions : null;
}
function normalizeOverlayInteractionReport(value) {
    if (!isRecord(value)
        || typeof value.revision !== "number"
        || !Number.isSafeInteger(value.revision)
        || value.revision <= 0
        || typeof value.bubbleActive !== "boolean"
        || typeof value.interactiveActive !== "boolean") {
        return null;
    }
    const bubbleRegions = normalizeOverlayHitRegions(value.bubbleRegions, "bubble");
    const interactiveRegions = Array.isArray(value.interactiveRegions)
        && value.interactiveRegions.length <= types_1.MAX_OVERLAY_HIT_REGIONS
        ? value.interactiveRegions.map((item) => {
            if (!isRecord(item))
                return null;
            const kind = item.kind;
            if (kind !== "pet" && kind !== "actions" && kind !== "task")
                return null;
            return normalizeOverlayHitRegion(item, kind);
        })
        : null;
    if (!bubbleRegions || !interactiveRegions
        || interactiveRegions.some((region) => region === null)
        || bubbleRegions.length + interactiveRegions.length > types_1.MAX_OVERLAY_HIT_REGIONS) {
        return null;
    }
    return {
        revision: value.revision,
        bubbleActive: value.bubbleActive,
        interactiveActive: value.interactiveActive,
        bubbleRegions,
        interactiveRegions: interactiveRegions,
    };
}
function createOverlayHitRegionState() {
    return { sender: null, revision: 0, report: null };
}
function acceptOverlayHitRegionReport(state, sender, value) {
    const report = normalizeOverlayInteractionReport(value);
    if (!report)
        return { accepted: false, state };
    if (state.sender === sender && report.revision <= state.revision)
        return { accepted: false, state };
    return {
        accepted: true,
        state: { sender, revision: report.revision, report },
    };
}
function pointInOverlayBounds(point, bounds) {
    return isFiniteNumber(point.x)
        && isFiniteNumber(point.y)
        && isFiniteNumber(bounds.x)
        && isFiniteNumber(bounds.y)
        && isFiniteNumber(bounds.width)
        && isFiniteNumber(bounds.height)
        && bounds.width > 0
        && bounds.height > 0
        && point.x >= bounds.x
        && point.y >= bounds.y
        && point.x < bounds.x + bounds.width
        && point.y < bounds.y + bounds.height;
}
function pointInOverlayRegion(point, bounds, region) {
    const localX = point.x - bounds.x;
    const localY = point.y - bounds.y;
    return localX >= region.x
        && localY >= region.y
        && localX < region.x + region.width
        && localY < region.y + region.height;
}
function shouldCaptureOverlayPointer(input) {
    if (!input.visible)
        return false;
    // A task panel or an active pet drag owns the native window until release,
    // including while the pointer is outside the overlay's current bounds.
    if (input.report?.interactiveActive)
        return true;
    // The legacy renderer announces bubble activity with the same interactive
    // mode used by the pet. Once a report is present, scope that legacy mode to
    // the reported regions so transparent pixels remain click-through.
    if (input.requestedMode === "interactive" && (!input.report || !input.report.bubbleActive))
        return true;
    if (!pointInOverlayBounds(input.cursor ?? { x: NaN, y: NaN }, input.bounds))
        return false;
    if (!input.report || !input.cursor)
        return false;
    const regions = [
        ...(input.report.bubbleActive ? input.report.bubbleRegions : []),
        ...input.report.interactiveRegions,
    ];
    return regions.some((region) => pointInOverlayRegion(input.cursor, input.bounds, region));
}
function isTrustedOverlaySender(sender, senderFrame, overlayContents) {
    return overlayContents !== null
        && overlayContents !== undefined
        && isTrustedSender(sender, senderFrame, [overlayContents]);
}
function setOverlayPointerCaptureForWindow(window, capture) {
    if (capture)
        window.setIgnoreMouseEvents(false);
    else
        window.setIgnoreMouseEvents(true, { forward: true });
}
function setOverlayMouseModeForWindow(window, mode) {
    setOverlayPointerCaptureForWindow(window, mode === "interactive");
}
let store;
let data;
let petPackService = null;
let petPackRuntime = (0, runtime_1.createBundledPetPackRuntime)();
let petPackSummaries = [];
let overlayWindow = null;
let centerWindow = null;
let articleGameHost = null;
let articleGameHostStart = null;
let pendingCenterTab = null;
let centerWindowLoaded = false;
let tray = null;
let codexMonitor = null;
let codexSessionsService;
let applicationMonitor = null;
let schedulerTimer = null;
let maintenanceTimer = null;
let autoSleepTimer = null;
let cursorTimer = null;
let stateTimer = null;
let overlayPositionSaveTimer = null;
let desktopSessionExpiryTimer = null;
let overlayPanelMode = null;
let codexThreadCache = null;
let codexThreadListInFlight = null;
const codexReplyStarts = new Set();
let quitting = false;
let currentAppRule = null;
let stateSequence = 0;
let gameActive = false;
let desktopSessionState = createDesktopBubbleSessionState();
let overlayMouseMode = "passthrough";
let overlayHitRegionState = createOverlayHitRegionState();
let overlayMouseCapture = null;
let overlaySuppressedForArticleGame = false;
let lastSystemIdleSeconds = null;
let careRandomSource = () => Math.random();
function setCareRandomSourceForTests(random) {
    careRandomSource = random;
}
const activeCodexTurns = new Map();
const activeCodexReplyHandles = new Set();
const liveCodexThreadStatuses = new Map();
const LIVE_TERMINAL_STATUS_MS = 45_000;
const monitoring = {
    codex: "off",
    applications: "off",
    notifications: "off",
    activeApplication: null,
    codexBusy: false,
    codexStartedAt: null,
};
function createBundledPetPackSummary(active) {
    const bundledRuntime = (0, runtime_1.createBundledPetPackRuntime)();
    return {
        id: runtime_1.BUNDLED_PET_PACK_ID,
        name: "小满",
        version: "bundled",
        spriteVersionNumber: 2,
        active,
        bundled: true,
        assetCount: bundledRuntime.assets.length,
        hasCodex: true,
        hasDesktop: true,
        warnings: [],
    };
}
function toRendererPetPackSummary(summary, activeId) {
    return {
        id: summary.id,
        name: summary.name,
        version: summary.version,
        spriteVersionNumber: summary.spriteVersionNumber,
        active: activeId === summary.id,
        bundled: false,
        assetCount: summary.files.length,
        hasCodex: summary.hasCodex,
        hasDesktop: summary.hasDesktop,
        warnings: [...summary.warnings],
    };
}
function petPackErrorMessage(error) {
    if (error instanceof pet_pack_service_1.PetPackServiceError) {
        return error.errors.length > 0
            ? `${error.message}: ${error.errors.map((item) => item.message).join("；")}`
            : error.message;
    }
    return error instanceof Error ? error.message : String(error);
}
async function refreshPetPackState() {
    const bundledRuntime = (0, runtime_1.createBundledPetPackRuntime)();
    petPackRuntime = bundledRuntime;
    if (!petPackService) {
        petPackSummaries = [createBundledPetPackSummary(data?.activePetPackId === null)];
        return;
    }
    const installed = await petPackService.listInstalled();
    const activeId = data.activePetPackId;
    if (activeId !== null) {
        const selected = installed.find((summary) => summary.id === activeId);
        if (!selected) {
            data.activePetPackId = null;
        }
        else {
            try {
                petPackRuntime = await petPackService.getRuntime(activeId);
            }
            catch {
                data.activePetPackId = null;
            }
        }
    }
    const resolvedActiveId = data.activePetPackId;
    petPackSummaries = [
        createBundledPetPackSummary(resolvedActiveId === null),
        ...installed.map((summary) => toRendererPetPackSummary(summary, resolvedActiveId)),
    ];
}
function broadcastPetPackChanged() {
    const runtime = structuredClone(petPackRuntime);
    for (const window of [overlayWindow, centerWindow]) {
        if (window && !window.isDestroyed())
            window.webContents.send("pet-pack:changed", runtime);
    }
}
let runtimeState = {
    state: "idle",
    message: domain_1.STATE_LABELS.idle,
    source: "ambient",
    priority: 10,
    expiresAt: null,
};
function snapshot() {
    return {
        ...data,
        state: runtimeState.state,
        stateMessage: runtimeState.message,
        stateSource: runtimeState.source,
        monitoring: { ...monitoring },
        desktopInteraction: { ...desktopSessionState.status },
        petPacks: petPackSummaries,
        petPackRuntime,
    };
}
function persist() {
    store.save(data);
}
function broadcast() {
    const next = snapshot();
    for (const window of [overlayWindow, centerWindow]) {
        if (window && !window.isDestroyed())
            window.webContents.send("snapshot:changed", next);
    }
    updateTrayMenu();
}
function broadcastOverlayPanelState() {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send("overlay:panel-state", overlayPanelMode);
        // Keep the boolean event for older renderer builds during an in-place update.
        overlayWindow.webContents.send("overlay:task-panel-state", overlayPanelMode === "codex");
    }
}
function persistAndBroadcast() {
    persist();
    broadcast();
}
function clearStateTimer() {
    if (stateTimer)
        clearTimeout(stateTimer);
    stateTimer = null;
}
function triggerState(state, message, source, durationMs, priority, shouldBroadcast = true) {
    const now = Date.now();
    if (data?.sleeping && state !== "sleeping" && source !== "interaction")
        return;
    // Care actions do not hide a live Codex task or an active reminder.
    if (source === "interaction" && (monitoring.codexBusy || runtimeState.source === "codex" || runtimeState.source === "reminder"))
        return;
    if (runtimeState.expiresAt && runtimeState.expiresAt > now && priority < runtimeState.priority)
        return;
    clearStateTimer();
    const sequence = ++stateSequence;
    runtimeState = {
        state,
        message: message || domain_1.STATE_LABELS[state],
        source,
        priority,
        expiresAt: durationMs ? now + durationMs : null,
    };
    if (shouldBroadcast)
        broadcast();
    if (durationMs) {
        stateTimer = setTimeout(() => {
            if (sequence === stateSequence)
                recomputeState(true);
        }, durationMs);
    }
}
function recomputeState(force = false) {
    const now = Date.now();
    if (!force && runtimeState.expiresAt && runtimeState.expiresAt > now)
        return;
    clearStateTimer();
    stateSequence += 1;
    const state = (0, domain_1.deriveAmbientState)(data.stats, data.sleeping, monitoring.codexBusy, currentAppRule?.state ?? null);
    let message = domain_1.STATE_LABELS[state];
    let source = "ambient";
    let priority = 10;
    if (data.sleeping) {
        message = sleep_1.SLEEPING_NOTICE;
        source = "interaction";
        priority = 96;
    }
    else if (monitoring.codexBusy) {
        message = "Codex 正在处理任务";
        source = "codex";
        priority = 70;
    }
    else if (state === "hungry" || state === "dirty" || state === "sleepy") {
        source = "needs";
        priority = 40;
    }
    else if (currentAppRule) {
        message = currentAppRule.message || domain_1.STATE_LABELS[currentAppRule.state];
        source = "application";
        priority = 30;
    }
    runtimeState = { state, message, source, priority, expiresAt: null };
    broadcast();
}
function notifySleeping() {
    if (!data?.sleeping)
        return;
    clearStateTimer();
    stateSequence += 1;
    runtimeState = {
        state: "sleeping",
        message: sleep_1.SLEEPING_NOTICE,
        source: "interaction",
        priority: 96,
        expiresAt: null,
    };
    broadcast();
}
function emitSound(sound) {
    if (sound === "none" || !data.settings.soundEnabled || data.settings.volume <= 0)
        return;
    const target = overlayWindow?.isVisible() ? overlayWindow : centerWindow;
    if (target && !target.isDestroyed())
        target.webContents.send("sound:play", sound);
}
function showSystemNotification(title, body) {
    if (!data.settings.systemNotifications || !electron_1.Notification.isSupported())
        return;
    const notification = new electron_1.Notification({ title, body, silent: true });
    notification.on("click", () => showCenter());
    notification.show();
}
function wakeInactivitySleep(next) {
    return next.sleeping && next.sleepReason === "inactivity"
        ? { ...next, sleeping: false, sleepReason: null }
        : next;
}
function commitCareMutation(result, title, state, defaultMessage, sound, wakesInactivity = true, durationMs = 4200) {
    if (!result.ok)
        throw new Error(result.message);
    data = wakesInactivity ? wakeInactivitySleep(result.data) : result.data;
    data.activity = (0, domain_1.appendActivity)(data.activity, {
        source: "interaction",
        title,
        detail: result.message || defaultMessage,
        state,
    });
    triggerState(state, result.message || defaultMessage, "interaction", durationMs, 92, false);
    emitSound(sound);
    persistAndBroadcast();
    return snapshot();
}
function runCareMutation(operation, title, state, message, sound, wakesInactivity = true, durationMs = 4200) {
    if (data.sleeping) {
        notifySleeping();
        throw new Error(sleep_1.SLEEPING_NOTICE);
    }
    const now = Date.now();
    rolloverDailyQuests(now);
    const inputData = { ...data, stats: (0, domain_1.decayStats)(data.stats, data.sleeping, now) };
    return commitCareMutation(applyCareMutation({ data: inputData, operation, now, random: careRandomSource }), title, state, message, sound, wakesInactivity, durationMs);
}
function feedFood(foodId) {
    return runCareMutation({ kind: "feed", foodId }, "喂了小满", "eating", "鱼干真香", "crunch", true, 6200);
}
function bathePet() {
    return runCareMutation({ kind: "bath" }, "给小满洗澡", "bathing", "洗得香香的", "chime", true, 6200);
}
function openGiftBox() {
    return runCareMutation({ kind: "open-gift" }, "打开了礼包", "celebrating", "礼包打开啦", "chime");
}
function startPetJob(jobId) {
    return runCareMutation({ kind: "start-job", jobId }, "开始打工", "working", "打工中", "chime");
}
function collectPetJob() {
    return runCareMutation({ kind: "complete-job" }, "领取打工奖励", "celebrating", "打工奖励到账", "chime");
}
function cancelPetJobIpc() {
    return runCareMutation({ kind: "cancel-job" }, "取消打工", "idle", "已取消打工", "none");
}
function claimDailyQuest(questId) {
    return runCareMutation({ kind: "claim-quest", questId }, "领取每日任务奖励", "celebrating", "领取成功", "chime");
}
function completeGame(gameId, score) {
    if (data.sleeping) {
        notifySleeping();
        throw new Error(sleep_1.SLEEPING_NOTICE);
    }
    expireDesktopBubbleSessionIfNeeded();
    if (!canCompleteGame(gameActive, data.settings.gameModeEnabled, desktopSessionState.status.active)) {
        if (desktopSessionState.status.active)
            throw new Error("桌面泡泡互动正在进行");
        throw new Error("没有正在进行的游戏");
    }
    const result = runCareMutation({ kind: "complete-game", gameId, score }, "完成互动游戏", "playful", "游戏完成", "pop");
    gameActive = false;
    return result;
}
function wakeForGameInteraction(title = "开始互动游戏") {
    if (!(data.sleeping && data.sleepReason === "inactivity"))
        return;
    data = { ...data, sleeping: false, sleepReason: null };
    data.activity = (0, domain_1.appendActivity)(data.activity, {
        source: "interaction",
        title,
        detail: "小满醒来陪你玩",
        state: "playful",
    });
    triggerState("playful", "一起玩吧", "interaction", 2600, 90, false);
    emitSound("pop");
    persistAndBroadcast();
}
async function performInteraction(action) {
    if (data.sleeping && !(0, sleep_1.isSleepAllowedInteraction)(action)) {
        notifySleeping();
        return snapshot();
    }
    if (action === "feed")
        return feedFood("fish-snack");
    const now = Date.now();
    data = { ...data, stats: { ...(0, domain_1.decayStats)(data.stats, data.sleeping, now), lastUpdatedAt: now } };
    data.stats.interactions += 1;
    if (action === "pet") {
        data = wakeInactivitySleep(data);
        data.stats.affection = (0, domain_1.clampStat)(data.stats.affection + 4);
        data.stats.lastPettedAt = now;
        data.activity = (0, domain_1.appendActivity)(data.activity, {
            source: "interaction",
            title: "摸了摸小满",
            detail: "好感度增加",
            state: "affectionate",
        });
        triggerState("affectionate", "再摸一下也可以", "interaction", 3200, 90, false);
        emitSound("purr");
    }
    else if (action === "play") {
        data = wakeInactivitySleep(data);
        data.stats.affection = (0, domain_1.clampStat)(data.stats.affection + 3);
        data.stats.energy = (0, domain_1.clampStat)(data.stats.energy - 7);
        data.stats.fullness = (0, domain_1.clampStat)(data.stats.fullness - 2);
        data.activity = (0, domain_1.appendActivity)(data.activity, {
            source: "interaction",
            title: "陪小满玩耍",
            detail: "消耗了一点精力",
            state: "playful",
        });
        triggerState("playful", "抓到你了", "interaction", 3800, 90, false);
        emitSound("pop");
    }
    else if (action === "sleep") {
        data.sleeping = true;
        data.sleepReason = "manual";
        closeAuxiliaryPanelsForSleep();
        data.activity = (0, domain_1.appendActivity)(data.activity, {
            source: "interaction",
            title: "小满去睡觉",
            detail: "开始恢复精力",
            state: "sleeping",
        });
        triggerState("sleeping", sleep_1.SLEEPING_NOTICE, "interaction", null, 96, false);
        emitSound("purr");
    }
    else if (action === "wake") {
        data.sleeping = false;
        data.sleepReason = null;
        data.stats.energy = (0, domain_1.clampStat)(data.stats.energy + 2);
        data.activity = (0, domain_1.appendActivity)(data.activity, {
            source: "interaction",
            title: "叫醒小满",
            detail: "已经醒来",
            state: "happy",
        });
        triggerState("happy", "我醒啦", "interaction", 2600, 90, false);
        emitSound("meow");
    }
    else {
        data = wakeInactivitySleep(data);
        data.stats.affection = (0, domain_1.clampStat)(data.stats.affection + 1);
        data.activity = (0, domain_1.appendActivity)(data.activity, {
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
function updateLiveCodexThreadStatus(event) {
    if (!event.threadId || event.threadId === "unknown")
        return;
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
function markNativeReplyActive(threadId) {
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
function withLiveCodexThreadStatus(session) {
    if (!session)
        return null;
    const live = liveCodexThreadStatuses.get(session.id);
    if (!live)
        return session;
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
function handleCodexEvent(event) {
    updateLiveCodexThreadStatus(event);
    codexThreadCache = null;
    if (event.kind === "started") {
        activeCodexTurns.set(event.turnId, event.at);
        monitoring.codexBusy = true;
        monitoring.codexStartedAt = Math.min(...activeCodexTurns.values());
        if (!event.recovered) {
            data.activity = (0, domain_1.appendActivity)(data.activity, {
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
            data.activity = (0, domain_1.appendActivity)(data.activity, {
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
    const state = failed ? "failed" : "ready";
    const title = failed ? "Codex 任务未完成" : "Codex 任务完成";
    if (event.kind === "completed") {
        const recovered = "recovered" in event && Boolean(event.recovered);
        const reward = applyCodexCompletionReward(data, { ...event, recovered }, careRandomSource);
        if (reward.ok && reward.data !== data) {
            data = reward.data;
            data.activity = (0, domain_1.appendActivity)(data.activity, {
                source: "codex",
                title: "Codex 完成奖励",
                detail: reward.message ?? "Codex 完成奖励",
                state: "celebrating",
            });
        }
    }
    data.activity = (0, domain_1.appendActivity)(data.activity, {
        source: "codex",
        title,
        detail: event.kind === "aborted" ? "任务已停止" : "只记录状态，不读取任务内容",
        state,
    });
    if (monitoring.codexBusy) {
        recomputeState(true);
    }
    else {
        triggerState(state, failed ? "这次需要再看看" : "任务完成啦", "codex", 6500, 88, false);
        emitSound(failed ? "alert" : "chime");
        if (data.settings.codexNotifications)
            showSystemNotification(title, failed ? "小满发现任务状态异常" : "小满来通知你查看结果");
    }
    persistAndBroadcast();
}
function matchesApplication(rule, application) {
    const normalized = application.toLocaleLowerCase();
    return rule.appPattern
        .split("|")
        .map((part) => part.trim().toLocaleLowerCase())
        .filter(Boolean)
        .some((part) => normalized.includes(part));
}
function handleFrontmostApplication(application) {
    monitoring.activeApplication = application;
    const ownApplication = application.includes("小满桌面伴侣") || application === "Electron";
    const nextRule = ownApplication
        ? null
        : data.appRules.find((rule) => rule.enabled && matchesApplication(rule, application)) ?? null;
    if (nextRule?.id !== currentAppRule?.id) {
        currentAppRule = nextRule;
        if (nextRule) {
            data.activity = (0, domain_1.appendActivity)(data.activity, {
                source: "application",
                title: nextRule.name,
                detail: application,
                state: nextRule.state,
            });
            emitSound(nextRule.sound);
            if (nextRule.notify)
                showSystemNotification(nextRule.name, nextRule.message);
            persist();
        }
        recomputeState();
    }
    else {
        broadcast();
    }
}
function runReminderScheduler(now = new Date()) {
    if (!data.settings.remindersEnabled)
        return;
    let changed = false;
    for (const reminder of data.reminders) {
        const due = (0, domain_1.isReminderDue)(reminder, now);
        if (!due.due)
            continue;
        reminder.lastTriggeredKey = due.key;
        if (reminder.repeat === "once")
            reminder.enabled = false;
        data.activity = (0, domain_1.appendActivity)(data.activity, {
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
    if (changed)
        persistAndBroadcast();
}
function localDateKey(now) {
    const date = new Date(now);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function rolloverDailyQuests(now) {
    const date = localDateKey(now);
    if (data.dailyQuestDate === date && data.dailyQuests.length === 5)
        return false;
    data = { ...data, dailyQuestDate: date, dailyQuests: (0, domain_1.createDailyQuests)(now) };
    return true;
}
function settleDueJobInMain(now = Date.now()) {
    const result = settleDuePetJob(data, now, careRandomSource);
    if (!result.ok)
        return false;
    data = result.data;
    data.activity = (0, domain_1.appendActivity)(data.activity, {
        source: "interaction",
        title: "打工完成",
        detail: result.message ?? "打工完成啦",
        state: "celebrating",
    });
    triggerState("celebrating", result.message ?? "打工完成啦", "interaction", 5200, 94, false);
    emitSound("chime");
    return true;
}
function highPriorityReminderActive() {
    return runtimeState.source === "reminder"
        && (runtimeState.expiresAt === null || runtimeState.expiresAt > Date.now());
}
function runAutoSleepCheck() {
    if (!data.settings.autoSleepEnabled) {
        lastSystemIdleSeconds = null;
        return;
    }
    const idleSeconds = electron_1.powerMonitor.getSystemIdleTime();
    const hadSystemActivity = lastSystemIdleSeconds !== null && idleSeconds < lastSystemIdleSeconds;
    lastSystemIdleSeconds = idleSeconds;
    if (hadSystemActivity && data.sleeping && data.sleepReason === "inactivity") {
        data = { ...data, sleeping: false, sleepReason: null };
        data.activity = (0, domain_1.appendActivity)(data.activity, {
            source: "system",
            title: "小满醒来了",
            detail: "检测到系统活动",
            state: "happy",
        });
        triggerState("happy", "我醒啦", "system", 2600, 85, false);
        persistAndBroadcast();
        return;
    }
    const input = {
        enabled: data.settings.autoSleepEnabled,
        idleSeconds,
        afterMinutes: data.settings.autoSleepAfterMin,
        codexBusy: monitoring.codexBusy,
        reminderActive: highPriorityReminderActive(),
        jobActive: Boolean(data.activeJob),
        gameActive: gameActive || desktopSessionState.status.active,
        sleeping: data.sleeping,
        manualSleep: data.sleepReason === "manual",
    };
    if (!shouldAutoSleepForRuntime(input))
        return;
    data = { ...data, sleeping: true, sleepReason: "inactivity" };
    closeAuxiliaryPanelsForSleep();
    data.activity = (0, domain_1.appendActivity)(data.activity, {
        source: "system",
        title: "小满进入睡眠",
        detail: "系统空闲时间达到自动睡眠阈值",
        state: "sleeping",
    });
    triggerState("sleeping", sleep_1.SLEEPING_NOTICE, "system", null, 96, false);
    emitSound("purr");
    persistAndBroadcast();
}
function configurePowerMonitor() {
    electron_1.powerMonitor.on("resume", () => {
        lastSystemIdleSeconds = 0;
        if (data.sleeping && data.sleepReason === "inactivity") {
            data = { ...data, sleeping: false, sleepReason: null };
            data.activity = (0, domain_1.appendActivity)(data.activity, {
                source: "system",
                title: "小满醒来了",
                detail: "系统恢复活动",
                state: "happy",
            });
            triggerState("happy", "我醒啦", "system", 2600, 85, false);
            persistAndBroadcast();
        }
    });
    electron_1.powerMonitor.on("unlock-screen", () => {
        lastSystemIdleSeconds = 0;
    });
    electron_1.powerMonitor.on("lock-screen", () => {
        lastSystemIdleSeconds = null;
    });
}
function setGameActive(active) {
    if (data.sleeping) {
        notifySleeping();
        return false;
    }
    expireDesktopBubbleSessionIfNeeded();
    const transition = transitionGameActivity(gameActive, desktopSessionState.status.active, active, data.settings.gameModeEnabled);
    if (!transition.accepted)
        return false;
    gameActive = transition.active;
    if (!gameActive)
        return true;
    wakeForGameInteraction();
    return true;
}
function startGameSession() {
    if (data.sleeping) {
        notifySleeping();
        return { accepted: false, message: sleep_1.SLEEPING_NOTICE };
    }
    expireDesktopBubbleSessionIfNeeded();
    if (!data.settings.gameModeEnabled) {
        return { accepted: false, message: "小游戏模式已关闭" };
    }
    if (desktopSessionState.status.active) {
        return { accepted: false, message: "桌面泡泡互动正在进行" };
    }
    if (gameActive) {
        return { accepted: false, message: "已有游戏正在进行" };
    }
    const accepted = setGameActive(true);
    return accepted
        ? { accepted: true }
        : { accepted: false, message: "当前已有其他互动正在进行" };
}
function clearDesktopSessionExpiryTimer() {
    if (desktopSessionExpiryTimer)
        clearTimeout(desktopSessionExpiryTimer);
    desktopSessionExpiryTimer = null;
}
function clearDesktopBubbleSessionWithoutReward(shouldBroadcast = true) {
    clearDesktopSessionExpiryTimer();
    if (!desktopSessionState.status.active)
        return;
    const sessionId = desktopSessionState.status.sessionId;
    if (!sessionId)
        return;
    desktopSessionState = stopDesktopBubbleSessionState(desktopSessionState, sessionId, false, Date.now()).state;
    applyOverlayMousePolicy();
    if (shouldBroadcast)
        broadcast();
}
function expireDesktopBubbleSession(sessionId) {
    if (desktopSessionState.status.sessionId !== sessionId)
        return;
    clearDesktopBubbleSessionWithoutReward();
}
function expireDesktopBubbleSessionIfNeeded(now = Date.now()) {
    const { active, sessionId, startedAt } = desktopSessionState.status;
    if (!active || !sessionId || startedAt === null || now < startedAt + desktop_interaction_1.DESKTOP_SESSION_DURATION_MS)
        return false;
    expireDesktopBubbleSession(sessionId);
    return true;
}
function scheduleDesktopSessionExpiry(sessionId, startedAt) {
    clearDesktopSessionExpiryTimer();
    desktopSessionExpiryTimer = setTimeout(() => expireDesktopBubbleSession(sessionId), Math.max(0, startedAt + desktop_interaction_1.DESKTOP_SESSION_DURATION_MS - Date.now()));
}
function startDesktopBubbleSession() {
    if (data.sleeping) {
        notifySleeping();
        return Promise.reject(new Error(sleep_1.SLEEPING_NOTICE));
    }
    const now = Date.now();
    expireDesktopBubbleSessionIfNeeded(now);
    if (!data.settings.gameModeEnabled)
        return Promise.reject(new Error("小游戏模式已关闭"));
    if (desktopSessionState.status.active)
        return Promise.resolve(snapshot());
    if (gameActive)
        return Promise.reject(new Error("已有游戏正在进行"));
    desktopSessionState = startDesktopBubbleSessionState(desktopSessionState, now, data.settings.gameModeEnabled, gameActive);
    const sessionId = desktopSessionState.status.sessionId;
    if (!sessionId || desktopSessionState.status.startedAt === null)
        return Promise.reject(new Error("无法开始桌面互动"));
    wakeForGameInteraction("开始桌面泡泡互动");
    scheduleDesktopSessionExpiry(sessionId, desktopSessionState.status.startedAt);
    broadcast();
    return Promise.resolve(snapshot());
}
function hitDesktopBubble(sessionId, bubbleId) {
    if (data.sleeping) {
        notifySleeping();
        return Promise.reject(new Error(sleep_1.SLEEPING_NOTICE));
    }
    const now = Date.now();
    expireDesktopBubbleSessionIfNeeded(now);
    const result = hitDesktopBubbleState(desktopSessionState, sessionId, bubbleId, now);
    if (!result.accepted)
        return Promise.reject(new Error("泡泡命中无效"));
    desktopSessionState = result.state;
    broadcast();
    return Promise.resolve(snapshot());
}
function stopDesktopBubbleSession(sessionId, completed) {
    if (data.sleeping) {
        notifySleeping();
        return Promise.reject(new Error(sleep_1.SLEEPING_NOTICE));
    }
    const now = Date.now();
    const result = stopDesktopBubbleSessionState(desktopSessionState, sessionId, completed, now);
    if (!result.accepted)
        return Promise.reject(new Error("桌面互动 session 无效"));
    if (!result.changed)
        return Promise.resolve(snapshot());
    clearDesktopSessionExpiryTimer();
    desktopSessionState = result.state;
    applyOverlayMousePolicy();
    if (result.settlement) {
        const settled = runCareMutation({ kind: "complete-game", gameId: "bubble-pop", score: result.settlement.score }, "完成桌面泡泡互动", "playful", "泡泡互动完成", "pop");
        return Promise.resolve(settled);
    }
    broadcast();
    return Promise.resolve(snapshot());
}
function runMaintenance() {
    const now = Date.now();
    const questsRolled = rolloverDailyQuests(now);
    const jobSettled = settleDueJobInMain(now);
    data.stats = (0, domain_1.decayStats)(data.stats, data.sleeping);
    const cooldownPassed = (last, cooldownMs) => last === null || now - last >= cooldownMs;
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
        if (monitoring.codexBusy &&
            monitoring.codexStartedAt &&
            now - monitoring.codexStartedAt >= 25 * 60 * 1000 &&
            cooldownPassed(data.proactive.lastLongWorkNoticeAt, 50 * 60 * 1000)) {
            data.proactive.lastLongWorkNoticeAt = now;
            showSystemNotification("任务仍在运行", "小满还在陪 Codex 工作");
            triggerState("focused", "还在认真盯着任务", "codex", 9000, 75);
        }
    }
    if (jobSettled || questsRolled)
        persistAndBroadcast();
    else {
        persist();
        recomputeState();
    }
}
function normalizedReminder(input, existing) {
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) ? input.time : "09:00";
    return {
        id: existing?.id ?? input.id ?? (0, domain_1.makeId)("reminder"),
        title: input.title.trim().slice(0, 40) || "小满提醒",
        message: input.message.trim().slice(0, 120),
        time,
        repeat: ["once", "daily", "weekdays", "weekly"].includes(input.repeat) ? input.repeat : "daily",
        date: input.date || null,
        days: [...new Set(input.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))],
        enabled: Boolean(input.enabled),
        sound: types_1.SOUND_NAMES.includes(input.sound) ? input.sound : "chime",
        lastTriggeredKey: existing?.lastTriggeredKey ?? null,
    };
}
function normalizedRule(input, existing) {
    const state = types_1.PET_STATES.includes(input.state) ? input.state : "focused";
    return {
        id: existing?.id ?? input.id ?? (0, domain_1.makeId)("rule"),
        name: input.name.trim().slice(0, 32) || "应用事件",
        appPattern: input.appPattern.trim().slice(0, 160),
        state,
        message: input.message.trim().slice(0, 100),
        sound: types_1.SOUND_NAMES.includes(input.sound) ? input.sound : "none",
        notify: Boolean(input.notify),
        enabled: Boolean(input.enabled),
    };
}
function canReplyInNativeCodex(session) {
    if (session.status.activeFlags.some((flag) => flag.toLowerCase().includes("approval")))
        return false;
    return session.status.activity === "running"
        || session.status.activity === "waiting"
        || session.status.activity === "idle"
        || session.status.activity === "error"
        || (0, codex_sessions_1.canReplyToCodexSession)(session);
}
function codexThreadSummary(session, transport) {
    const currentSession = withLiveCodexThreadStatus(session);
    const approvalBlocked = currentSession.status.activeFlags.some((flag) => flag.toLowerCase().includes("approval"));
    return {
        id: currentSession.id,
        title: currentSession.title,
        projectName: currentSession.cwd ? node_path_1.default.basename(currentSession.cwd) : "本机任务",
        status: (0, codex_ui_1.mapCodexThreadStatus)(currentSession.status.activity, currentSession.status.runtimeType),
        updatedAt: currentSession.updatedAt,
        activeTurnId: currentSession.status.activeTurnId,
        sourceKind: currentSession.threadSource ?? currentSession.source,
        canReply: transport === "native" ? canReplyInNativeCodex(currentSession) : (0, codex_sessions_1.canReplyToCodexSession)(currentSession),
        waitReason: approvalBlocked ? "approval" : null,
    };
}
async function listCodexThreads(force = false) {
    if (!data.settings.codexSessionControls) {
        codexThreadCache = null;
        return { threads: [], source: "off", warnings: [] };
    }
    if (!force && codexThreadCache && Date.now() - codexThreadCache.at < CODEX_THREAD_CACHE_MS) {
        return codexThreadCache.result;
    }
    if (codexThreadListInFlight)
        return await codexThreadListInFlight;
    codexThreadListInFlight = (async () => {
        const transport = data.settings.codexReplyTransport;
        const result = await codexSessionsService.listSessions({
            limit: 20,
            includeSubagents: false,
            sourceMode: transport,
        });
        const mapped = {
            threads: result.sessions.map((session) => codexThreadSummary(session, transport)),
            source: result.source,
            warnings: result.warnings,
        };
        codexThreadCache = { at: Date.now(), result: mapped };
        return mapped;
    })();
    try {
        return await codexThreadListInFlight;
    }
    finally {
        codexThreadListInFlight = null;
    }
}
async function openCodexThread(threadId) {
    if (!data.settings.codexSessionControls)
        return { ok: false, message: "Codex 任务功能已关闭" };
    try {
        await codexSessionsService.openDesktopTarget(threadId);
        return { ok: true, message: "已打开对应 Codex 任务" };
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, message: `无法打开对应 Codex 任务：${detail || "系统未关联 codex:// 协议"}` };
    }
}
async function startPetStudio() {
    const base = {
        desktopOpened: false,
        installCommand: prompt_1.PET_STUDIO_INSTALL_COMMAND,
    };
    if (!data.settings.codexSessionControls) {
        return {
            ...base,
            ok: false,
            message: "Codex 任务功能已关闭，请先在偏好设置中开启",
        };
    }
    try {
        const started = await codexSessionsService.startPetStudioThread((0, prompt_1.buildPetStudioPrompt)(), electron_1.app.getPath("home"));
        codexThreadCache = null;
        data.activity = (0, domain_1.appendActivity)(data.activity, {
            source: "codex",
            title: "已打开宠物生成草稿",
            detail: "原生 Codex 新对话已预填，等待点击发送",
            state: "focused",
        });
        triggerState("focused", "原生 Codex 已打开，请点击发送", "codex", 6500, 86);
        persistAndBroadcast();
        return {
            ...base,
            ok: true,
            message: "已在原生 Codex 新建对话，提示词已填入，请在 Codex 中点击发送",
            desktopUrl: started.desktopUrl,
            desktopOpened: true,
            promptPrefilled: started.promptPrefilled,
        };
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
            ...base,
            ok: false,
            message: `无法打开原生 Codex 宠物生成对话：${detail || "未知错误"}`,
        };
    }
}
async function replyToCodexThread(threadId, message) {
    if (!data.settings.codexSessionControls)
        throw new Error("Codex 任务功能已关闭");
    if (codexReplyStarts.has(threadId))
        throw new Error("这项任务正在处理上一条回复");
    codexReplyStarts.add(threadId);
    try {
        const transport = data.settings.codexReplyTransport;
        const session = withLiveCodexThreadStatus(await codexSessionsService.readSession(threadId, { sourceMode: transport }));
        const approvalBlocked = session?.status.activeFlags.some((flag) => flag.toLowerCase().includes("approval")) ?? false;
        if (approvalBlocked) {
            throw new Error("该任务正在等待授权，请在 Codex 中处理");
        }
        if (session && (transport === "native" ? !canReplyInNativeCodex(session) : !(0, codex_sessions_1.canReplyToCodexSession)(session))) {
            throw new Error("该任务当前状态不支持直接回复，请在 Codex 中查看");
        }
        let dispatch;
        try {
            dispatch = await codexSessionsService.sendReply({
                threadId,
                message,
                transport,
                activity: session?.status.activity,
                cwd: session?.cwd,
            });
        }
        catch (error) {
            if (error instanceof codex_sessions_1.CodexSessionCommandError) {
                throw new Error(error.result ? (0, codex_sessions_1.summarizeCodexProcessResult)(error.result) : error.message);
            }
            throw error;
        }
        codexThreadCache = null;
        const usedCliFallback = transport === "native" && dispatch.transport === "exec-resume";
        if (transport === "native" && !usedCliFallback)
            markNativeReplyActive(threadId);
        const mode = dispatch.transport === "queue" ? "queued" : "started";
        const sessionTitle = session?.title ?? "本机任务";
        data.activity = (0, domain_1.appendActivity)(data.activity, {
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
                data.activity = (0, domain_1.appendActivity)(data.activity, {
                    source: "codex",
                    title: "Codex 任务继续失败",
                    detail: sessionTitle,
                    state: "failed",
                });
                triggerState("failed", "继续任务时遇到问题", "codex", 6500, 90);
                persistAndBroadcast();
                if (data.settings.codexNotifications)
                    showSystemNotification("Codex 任务未继续", "请打开任务查看详细状态");
            };
            void dispatch.completion.then((result) => {
                if (result.code !== 0)
                    recordFailure();
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
    }
    finally {
        codexReplyStarts.delete(threadId);
    }
}
function assetPath(fileName) {
    return isDevelopment
        ? node_path_1.default.join(process.cwd(), "public", "pet", fileName)
        : node_path_1.default.join(electron_1.app.getAppPath(), "dist", "pet", fileName);
}
async function loadView(window, view, mode) {
    if (isDevelopment) {
        const url = new URL(process.env.VITE_DEV_SERVER_URL);
        url.searchParams.set("view", view);
        if (view === "quick" && mode)
            url.searchParams.set("mode", mode);
        await window.loadURL(url.toString());
    }
    else {
        await window.loadFile(node_path_1.default.join(electron_1.app.getAppPath(), "dist", "index.html"), {
            query: view === "quick" && mode ? { view, mode } : { view },
        });
    }
}
function reportViewLoadError(view, error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[xiaoman] failed to load ${view} view${detail ? `: ${detail}` : ""}`);
}
function loadViewSafely(window, view, mode) {
    void loadView(window, view, mode).catch((error) => reportViewLoadError(view, error));
}
function isExternalHttpUrl(value) {
    try {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
    }
    catch {
        return false;
    }
}
function openExternalHttpUrl(value) {
    if (!isExternalHttpUrl(value))
        return;
    void electron_1.shell.openExternal(value).catch((error) => {
        console.warn(`[xiaoman] failed to open external link: ${String(error)}`);
    });
}
function articleGameRoot() {
    return isDevelopment
        ? node_path_1.default.join(process.cwd(), "public", "article-games")
        : node_path_1.default.join(electron_1.app.getAppPath(), "dist", "article-games");
}
async function getArticleGameHost() {
    if (articleGameHost)
        return articleGameHost;
    articleGameHostStart ??= (0, article_game_host_1.startArticleGameHost)(articleGameRoot()).then((host) => {
        articleGameHost = host;
        return host;
    }).catch((error) => {
        articleGameHostStart = null;
        throw error;
    });
    return articleGameHostStart;
}
async function articleGameUrl(id) {
    if (data.sleeping) {
        notifySleeping();
        throw new Error(sleep_1.SLEEPING_NOTICE);
    }
    if (!data.settings.gameModeEnabled)
        throw new Error("小游戏模式已关闭");
    const definition = (0, registry_1.getArticleGameDefinition)(id);
    if (definition.availability !== "offline") {
        throw new Error(`${definition.title}需要网络，请使用在线入口`);
    }
    const host = await getArticleGameHost();
    return `${host.url}/${encodeURIComponent(id)}/${definition.entryPath.replace(/^\/+/, "")}`;
}
async function closeArticleGameHost() {
    const host = articleGameHost;
    articleGameHost = null;
    articleGameHostStart = null;
    await host?.close();
}
function hardenRendererWindow(window) {
    window.webContents.setWindowOpenHandler(({ url }) => {
        openExternalHttpUrl(url);
        return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, targetUrl) => {
        const currentUrl = window.webContents.getURL();
        if (currentUrl && targetUrl !== currentUrl) {
            event.preventDefault();
            openExternalHttpUrl(targetUrl);
        }
    });
}
function assertTrustedSender(sender, senderFrame) {
    const trustedContents = [overlayWindow?.webContents, centerWindow?.webContents]
        .filter((contents) => contents && !contents.isDestroyed());
    if (!isTrustedSender(sender, senderFrame, trustedContents)) {
        throw new Error("Rejected IPC call from an untrusted renderer");
    }
}
function assertTrustedInvoke(event) {
    assertTrustedSender(event.sender, event.senderFrame);
}
function assertTrustedOverlaySender(sender, senderFrame) {
    if (!isTrustedOverlaySender(sender, senderFrame, overlayWindow?.webContents)) {
        throw new Error("Rejected overlay IPC call from an untrusted renderer");
    }
}
function resetOverlayHitRegionState() {
    overlayHitRegionState = createOverlayHitRegionState();
}
function effectiveOverlayHitRegionReport() {
    const report = overlayHitRegionState.report;
    if (!report)
        return null;
    const bubblesEnabled = Boolean(data?.settings?.gameModeEnabled && desktopSessionState.status.active);
    const interactiveActive = report.interactiveActive || overlayPanelMode !== null;
    if (report.bubbleActive && !bubblesEnabled) {
        return { ...report, bubbleActive: false, bubbleRegions: [], interactiveActive };
    }
    if (interactiveActive !== report.interactiveActive)
        return { ...report, interactiveActive };
    return report;
}
function applyOverlayMousePolicy() {
    const window = overlayWindow;
    if (!window || window.isDestroyed()) {
        overlayMouseCapture = null;
        return;
    }
    let visible = false;
    let bounds = { x: 0, y: 0, width: 0, height: 0 };
    let cursor = null;
    try {
        visible = window.isVisible();
        bounds = window.getBounds();
        cursor = electron_1.screen.getCursorScreenPoint();
    }
    catch {
        visible = false;
    }
    const capture = shouldCaptureOverlayPointer({
        visible,
        requestedMode: overlayMouseMode,
        cursor,
        bounds,
        report: effectiveOverlayHitRegionReport(),
    });
    if (overlayMouseCapture === capture)
        return;
    overlayMouseCapture = capture;
    setOverlayPointerCaptureForWindow(window, capture);
}
function overlayDimensions(petSize = data.settings.petSize) {
    return (0, overlay_layout_1.overlayDimensions)(petSize, overlayPanelMode);
}
function defaultOverlayPosition() {
    const display = electron_1.screen.getPrimaryDisplay();
    const dimensions = data ? overlayDimensions() : { width: DEFAULT_OVERLAY_WIDTH, height: DEFAULT_OVERLAY_HEIGHT };
    return {
        x: display.workArea.x + display.workArea.width - dimensions.width - 28,
        y: display.workArea.y + display.workArea.height - dimensions.height - 18,
    };
}
function createOverlayWindow() {
    const savedPosition = data.overlayPosition ?? defaultOverlayPosition();
    const dimensions = overlayDimensions();
    const window = new electron_1.BrowserWindow({
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
            preload: node_path_1.default.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    overlayWindow = window;
    overlayMouseMode = "passthrough";
    overlayHitRegionState = createOverlayHitRegionState();
    overlayMouseCapture = null;
    hardenRendererWindow(window);
    setOverlayPointerCaptureForWindow(window, false);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setHiddenInMissionControl(true);
    window.on("move", () => {
        if (overlayWindow === window)
            applyOverlayMousePolicy();
    });
    window.on("resize", () => {
        if (overlayWindow === window)
            applyOverlayMousePolicy();
    });
    window.on("focus", () => {
        if (overlayWindow === window)
            applyOverlayMousePolicy();
    });
    window.on("blur", () => {
        if (overlayWindow !== window)
            return;
        setOverlayPanel(null);
        // A lost pointer capture must never leave the transparent window blocking the desktop.
        overlayMouseMode = "passthrough";
        applyOverlayMousePolicy();
    });
    window.webContents.on("did-start-loading", () => {
        if (overlayWindow !== window)
            return;
        overlayMouseMode = "passthrough";
        resetOverlayHitRegionState();
        applyOverlayMousePolicy();
    });
    window.webContents.on("render-process-gone", () => {
        if (overlayWindow !== window)
            return;
        overlayMouseMode = "passthrough";
        resetOverlayHitRegionState();
        applyOverlayMousePolicy();
    });
    window.on("closed", () => {
        if (overlayWindow !== window)
            return;
        resetOverlayHitRegionState();
        overlayMouseCapture = null;
        overlayWindow = null;
    });
    window.on("close", (event) => {
        if (!quitting) {
            event.preventDefault();
            setOverlayPanel(null);
            overlayMouseMode = "passthrough";
            window.hide();
            applyOverlayMousePolicy();
            data.settings.overlayVisible = false;
            persistAndBroadcast();
        }
    });
    window.on("ready-to-show", () => {
        if (data.settings.overlayVisible && !overlaySuppressedForArticleGame)
            window.showInactive();
        applyOverlayMousePolicy();
        broadcast();
        broadcastOverlayPanelState();
    });
    loadViewSafely(window, "overlay");
}
const CENTER_TABS = [
    "features",
    "care",
    "games",
    "social",
    "codex",
    "overview",
    "reminders",
    "events",
    "settings",
];
function isCenterTab(value) {
    return typeof value === "string" && CENTER_TABS.includes(value);
}
function flushPendingCenterTab() {
    if (!centerWindow || centerWindow.isDestroyed() || !centerWindowLoaded || pendingCenterTab === null)
        return;
    const tab = pendingCenterTab;
    pendingCenterTab = null;
    centerWindow.webContents.send("center:select-tab", tab);
}
function createCenterWindow() {
    centerWindowLoaded = false;
    const window = new electron_1.BrowserWindow({
        width: layout_1.NORMAL_CENTER_WINDOW_SIZE.width,
        height: layout_1.NORMAL_CENTER_WINDOW_SIZE.height,
        minWidth: CENTER_WINDOW_MIN_SIZE.width,
        minHeight: CENTER_WINDOW_MIN_SIZE.height,
        show: false,
        title: "小满桌面伴侣",
        titleBarStyle: "hiddenInset",
        backgroundColor: "#f4f5f2",
        webPreferences: {
            preload: node_path_1.default.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    centerWindow = window;
    hardenRendererWindow(window);
    window.webContents.on("did-start-loading", () => {
        if (centerWindow !== window)
            return;
        centerWindowLoaded = false;
    });
    window.webContents.on("did-finish-load", () => {
        if (centerWindow !== window)
            return;
        centerWindowLoaded = true;
        flushPendingCenterTab();
    });
    window.on("close", (event) => {
        if (!quitting) {
            event.preventDefault();
            restoreGameWindow();
            window.hide();
        }
    });
    window.on("ready-to-show", () => {
        if (centerWindow !== window)
            return;
        flushPendingCenterTab();
        broadcast();
    });
    window.on("closed", () => {
        if (centerWindow !== window)
            return;
        restoreOverlayAfterArticleGame();
        centerWindowLoaded = false;
        pendingCenterTab = null;
        centerWindow = null;
    });
    loadViewSafely(window, "center");
}
function showCenter(tab) {
    // A center view replaces any overlay shortcut panel immediately.
    if (overlayPanelMode !== null)
        setOverlayPanel(null);
    if (tab !== undefined)
        pendingCenterTab = tab;
    if (!centerWindow || centerWindow.isDestroyed())
        createCenterWindow();
    if (tab !== undefined && tab !== "games")
        restoreGameWindow();
    centerWindow?.show();
    centerWindow?.focus();
    flushPendingCenterTab();
}
function suppressOverlayForArticleGame() {
    if (overlaySuppressedForArticleGame)
        return;
    overlaySuppressedForArticleGame = true;
    if (overlayPanelMode !== null)
        setOverlayPanel(null);
    overlayMouseMode = "passthrough";
    overlayMouseCapture = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.hide();
        applyOverlayMousePolicy();
    }
}
function restoreOverlayAfterArticleGame() {
    if (!overlaySuppressedForArticleGame)
        return;
    overlaySuppressedForArticleGame = false;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        if (data.settings.overlayVisible && !data.sleeping)
            overlayWindow.showInactive();
        applyOverlayMousePolicy();
    }
}
function fitCenterWindowToArticleGame(gameId) {
    const window = centerWindow;
    if (!window || window.isDestroyed())
        return;
    const layout = gameId ? (0, layout_1.articleGameWindowLayout)((0, registry_1.getArticleGameDefinition)(gameId)) : null;
    if (!layout) {
        restoreGameWindow();
        return;
    }
    suppressOverlayForArticleGame();
    window.setMinimumSize(CENTER_WINDOW_MIN_SIZE.width, CENTER_WINDOW_MIN_SIZE.height);
    const frameWidth = Math.max(layout.width, 1);
    const frameHeight = Math.max(layout.height + layout.chromeHeight, 1);
    const width = Math.max(layout.contentWidth, frameWidth);
    const height = Math.max(layout.contentHeight, frameHeight);
    window.setContentSize(width, height, false);
    clampCenterWindowToWorkArea(window);
}
function clampCenterWindowToWorkArea(window) {
    const bounds = window.getBounds();
    const workArea = electron_1.screen.getDisplayMatching(bounds).workArea;
    const maxX = Math.max(workArea.x, workArea.x + workArea.width - bounds.width);
    const maxY = Math.max(workArea.y, workArea.y + workArea.height - bounds.height);
    const x = Math.max(workArea.x, Math.min(bounds.x, maxX));
    const y = Math.max(workArea.y, Math.min(bounds.y, maxY));
    if (x !== bounds.x || y !== bounds.y)
        window.setPosition(x, y, false);
}
function restoreGameWindow() {
    restoreOverlayAfterArticleGame();
    const window = centerWindow;
    if (!window || window.isDestroyed())
        return;
    window.setMinimumSize(CENTER_WINDOW_MIN_SIZE.width, CENTER_WINDOW_MIN_SIZE.height);
    window.setSize(layout_1.NORMAL_CENTER_WINDOW_SIZE.width, layout_1.NORMAL_CENTER_WINDOW_SIZE.height, false);
    clampCenterWindowToWorkArea(window);
}
function closeAuxiliaryPanelsForSleep() {
    clearDesktopBubbleSessionWithoutReward(false);
    gameActive = false;
    resetOverlayHitRegionState();
    setOverlayPanel(null);
    applyOverlayMousePolicy();
}
function showQuickWindow(mode) {
    if (!(0, sleep_1.canOpenAuxiliaryPanel)(data.sleeping)) {
        notifySleeping();
        return;
    }
    // Care and interaction replace the Codex panel in the same transparent host.
    setOverlayPanel(mode);
}
function setOverlayMouseMode(mode) {
    overlayMouseMode = mode;
    applyOverlayMousePolicy();
}
function toggleOverlay() {
    if (!overlayWindow)
        return;
    if (data.sleeping && data.settings.overlayVisible && overlayWindow.isVisible()) {
        notifySleeping();
        return;
    }
    data.settings.overlayVisible = !data.settings.overlayVisible;
    if (data.settings.overlayVisible && !overlaySuppressedForArticleGame) {
        overlayWindow.showInactive();
        applyOverlayMousePolicy();
    }
    else if (!data.settings.overlayVisible) {
        setOverlayTaskPanel(false);
        overlayMouseMode = "passthrough";
        overlayWindow.hide();
        applyOverlayMousePolicy();
    }
    persistAndBroadcast();
}
function createTray() {
    const source = electron_1.nativeImage.createFromPath(assetPath("tray.png"));
    const icon = source.isEmpty() ? electron_1.nativeImage.createEmpty() : source.resize({ width: 18, height: 18 });
    if (process.platform === "darwin" && !icon.isEmpty())
        icon.setTemplateImage(true);
    tray = new electron_1.Tray(icon);
    tray.setToolTip("小满桌面伴侣");
    tray.on("click", () => showCenter());
    updateTrayMenu();
}
function updateTrayMenu() {
    if (!tray)
        return;
    const template = [
        { label: `小满 · ${domain_1.STATE_LABELS[runtimeState.state]}`, enabled: false },
        { type: "separator" },
        { label: "打开控制中心", click: () => showCenter() },
        { label: data.settings.overlayVisible ? "隐藏小满" : "显示小满", click: () => toggleOverlay() },
        { type: "separator" },
        { label: "喂鱼干", click: () => performMenuInteraction("feed") },
        { label: "摸摸", click: () => performMenuInteraction("pet") },
        { label: "一起玩", click: () => performMenuInteraction("play") },
        { label: data.sleeping ? "叫醒" : "睡觉", click: () => performMenuInteraction(data.sleeping ? "wake" : "sleep") },
        { type: "separator" },
        { label: "退出小满桌面伴侣", click: () => electron_1.app.quit() },
    ];
    tray.setContextMenu(electron_1.Menu.buildFromTemplate(template));
}
function showCenterFromOverlayMenu() {
    if (data.sleeping) {
        notifySleeping();
        return;
    }
    showCenter();
}
function showOverlayContextMenu() {
    const template = [
        { label: "喂鱼干", click: () => performMenuInteraction("feed") },
        { label: "摸摸", click: () => performMenuInteraction("pet") },
        { label: "一起玩", click: () => performMenuInteraction("play") },
        { label: data.sleeping ? "叫醒" : "睡觉", click: () => performMenuInteraction(data.sleeping ? "wake" : "sleep") },
        { type: "separator" },
        { label: "打开控制中心", click: () => showCenterFromOverlayMenu() },
        { label: "隐藏小满", click: () => toggleOverlay() },
        { type: "separator" },
        { label: "退出小满桌面伴侣", click: () => electron_1.app.quit() },
    ];
    electron_1.Menu.buildFromTemplate(template).popup({ window: overlayWindow ?? undefined });
}
function performMenuInteraction(action) {
    void performInteraction(action).catch((error) => {
        if (data.sleeping) {
            notifySleeping();
            return;
        }
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(`[xiaoman] menu interaction failed${detail ? `: ${detail}` : ""}`);
    });
}
function scheduleOverlayPositionSave() {
    if (overlayPositionSaveTimer)
        clearTimeout(overlayPositionSaveTimer);
    overlayPositionSaveTimer = setTimeout(() => {
        if (!overlayWindow)
            return;
        data.overlayPosition = (0, overlay_layout_1.persistedOverlayPosition)(overlayWindow.getBounds(), data.settings.petSize);
        persist();
    }, 450);
}
function moveOverlayBy(deltaX, deltaY) {
    if (!overlayWindow || !Number.isFinite(deltaX) || !Number.isFinite(deltaY))
        return;
    const bounds = overlayWindow.getBounds();
    const target = {
        x: Math.round(bounds.x + Math.max(-80, Math.min(80, deltaX))),
        y: Math.round(bounds.y + Math.max(-80, Math.min(80, deltaY))),
        width: bounds.width,
        height: bounds.height,
    };
    const workArea = electron_1.screen.getDisplayMatching(target).workArea;
    const x = Math.max(workArea.x - 30, Math.min(target.x, workArea.x + workArea.width - 100));
    const y = Math.max(workArea.y, Math.min(target.y, workArea.y + workArea.height - 100));
    overlayWindow.setPosition(x, y, false);
    scheduleOverlayPositionSave();
}
function resizeOverlayForPet() {
    if (!overlayWindow || overlayWindow.isDestroyed())
        return;
    const bounds = overlayWindow.getBounds();
    const dimensions = overlayDimensions();
    if (bounds.width === dimensions.width && bounds.height === dimensions.height)
        return;
    const target = {
        x: bounds.x + bounds.width - dimensions.width,
        y: bounds.y + bounds.height - dimensions.height,
        ...dimensions,
    };
    const workArea = electron_1.screen.getDisplayMatching(target).workArea;
    target.x = Math.max(workArea.x - 30, Math.min(target.x, workArea.x + workArea.width - 100));
    target.y = Math.max(workArea.y, Math.min(target.y, workArea.y + workArea.height - 100));
    overlayWindow.setBounds(target, false);
    data.overlayPosition = (0, overlay_layout_1.persistedOverlayPosition)(target, data.settings.petSize);
}
function setOverlayPanel(mode) {
    if (mode !== null && !(0, sleep_1.canOpenAuxiliaryPanel)(data.sleeping)) {
        notifySleeping();
        return;
    }
    const next = mode === "codex" && !data.settings.codexSessionControls ? null : mode;
    if (overlayPanelMode === next)
        return;
    if (next !== null && overlaySuppressedForArticleGame)
        return;
    overlayPanelMode = next;
    overlayMouseMode = next !== null ? "interactive" : "passthrough";
    resizeOverlayForPet();
    if (next !== null && overlayWindow && !overlayWindow.isDestroyed() && !overlaySuppressedForArticleGame) {
        overlayWindow.show();
        overlayWindow.focus();
    }
    if (next === null && !data.settings.overlayVisible && overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.hide();
    }
    applyOverlayMousePolicy();
    broadcastOverlayPanelState();
}
function setOverlayTaskPanel(open) {
    setOverlayPanel(open ? "codex" : null);
}
function applySettingsSideEffects(previous) {
    if (overlayWindow) {
        overlayWindow.setAlwaysOnTop(data.settings.alwaysOnTop);
        if (data.settings.overlayVisible && !overlaySuppressedForArticleGame && !overlayWindow.isVisible())
            overlayWindow.showInactive();
        if (!data.settings.overlayVisible) {
            overlayMouseMode = "passthrough";
            if (overlayWindow.isVisible())
                overlayWindow.hide();
        }
        applyOverlayMousePolicy();
    }
    if (previous.monitorCodex !== data.settings.monitorCodex)
        void configureCodexMonitor();
    if (previous.monitorApps !== data.settings.monitorApps)
        configureApplicationMonitor();
    if (previous.gazeFrameRate !== data.settings.gazeFrameRate)
        configureCursorTimer();
    if (previous.petSize !== data.settings.petSize)
        resizeOverlayForPet();
    if (previous.codexSessionControls && !data.settings.codexSessionControls && overlayPanelMode === "codex") {
        setOverlayPanel(null);
    }
    if (previous.startAtLogin !== data.settings.startAtLogin && electron_1.app.isPackaged) {
        electron_1.app.setLoginItemSettings({ openAtLogin: data.settings.startAtLogin });
    }
    if (previous.codexReplyTransport !== data.settings.codexReplyTransport)
        codexThreadCache = null;
    if (previous.gameModeEnabled && !data.settings.gameModeEnabled) {
        clearDesktopBubbleSessionWithoutReward(false);
        gameActive = false;
        resetOverlayHitRegionState();
        applyOverlayMousePolicy();
    }
    monitoring.notifications = !data.settings.systemNotifications
        ? "off"
        : electron_1.Notification.isSupported()
            ? "available"
            : "unavailable";
}
async function configureCodexMonitor() {
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
    codexMonitor = new codex_monitor_1.CodexSessionMonitor(codexSessionsService.sessionsRoot, handleCodexEvent, (available) => {
        monitoring.codex = available ? "watching" : "unavailable";
        broadcast();
    });
    await codexMonitor.start();
    broadcast();
}
function configureApplicationMonitor() {
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
    applicationMonitor = new application_monitor_1.FrontmostApplicationMonitor(handleFrontmostApplication, (available) => {
        monitoring.applications = available ? "watching" : "unavailable";
        broadcast();
    });
    applicationMonitor.start();
}
async function importPetPackFromRenderer(filePath) {
    if (!petPackService) {
        return { ok: false, message: "Pet Pack 服务尚未启动", errorCode: "service-unavailable" };
    }
    let selectedPath;
    if (typeof filePath === "string" && filePath.trim())
        selectedPath = node_path_1.default.resolve(filePath);
    if (!selectedPath) {
        const result = await electron_1.dialog.showOpenDialog({
            title: "导入 Pet Pack",
            properties: ["openFile"],
            filters: [{ name: "小满 Pet Pack", extensions: ["xmpet", "zip"] }],
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { ok: false, message: "已取消导入" };
        }
        selectedPath = result.filePaths[0];
    }
    try {
        const installed = await petPackService.importPackage(selectedPath);
        await refreshPetPackState();
        persistAndBroadcast();
        broadcastPetPackChanged();
        return {
            ok: true,
            message: `已导入 ${installed.name}`,
            summary: petPackSummaries.find((summary) => summary.id === installed.id),
            files: installed.files,
        };
    }
    catch (error) {
        return { ok: false, message: petPackErrorMessage(error), errorCode: error instanceof pet_pack_service_1.PetPackServiceError ? error.code : "import-failed" };
    }
}
async function activatePetPackFromRenderer(id) {
    if (!petPackService)
        throw new Error("Pet Pack 服务尚未启动");
    if (id === null) {
        await petPackService.clearActive();
        data.activePetPackId = null;
    }
    else {
        if (typeof id !== "string" || !id.trim())
            throw new Error("Pet Pack ID 无效");
        await petPackService.setActive(id);
        data.activePetPackId = id;
    }
    await refreshPetPackState();
    persistAndBroadcast();
    broadcastPetPackChanged();
    return snapshot();
}
async function removePetPackFromRenderer(id) {
    if (!petPackService)
        throw new Error("Pet Pack 服务尚未启动");
    if (typeof id !== "string" || !id.trim())
        throw new Error("Pet Pack ID 无效");
    await petPackService.remove(id);
    if (data.activePetPackId === id)
        data.activePetPackId = null;
    await refreshPetPackState();
    persistAndBroadcast();
    broadcastPetPackChanged();
    return snapshot();
}
async function exportPetPackToCodexFromRenderer(id) {
    if (!petPackService)
        return { ok: false, message: "Pet Pack 服务尚未启动", errorCode: "service-unavailable" };
    if (typeof id !== "string" || !id.trim())
        return { ok: false, message: "Pet Pack ID 无效", errorCode: "invalid-id" };
    try {
        const result = await petPackService.exportCodex(id);
        return {
            ok: true,
            message: `已导出到 ${result.path}`,
            files: result.files,
            path: result.path,
            backupPath: result.backupPath,
        };
    }
    catch (error) {
        return { ok: false, message: petPackErrorMessage(error), errorCode: error instanceof pet_pack_service_1.PetPackServiceError ? error.code : "export-failed" };
    }
}
function registerIpcHandlers() {
    electron_1.ipcMain.handle("snapshot:get", () => snapshot());
    electron_1.ipcMain.handle("interaction:perform", (event, action) => {
        assertTrustedInvoke(event);
        if (!isInteractionAction(action))
            throw new Error("没有这个互动动作");
        return performInteraction(action);
    });
    electron_1.ipcMain.handle("care:feed-food", (event, foodId) => {
        assertTrustedInvoke(event);
        if (!isFoodId(foodId))
            throw new Error("没有这个食物");
        return feedFood(foodId);
    });
    electron_1.ipcMain.handle("care:bathe-pet", (event) => {
        assertTrustedInvoke(event);
        return bathePet();
    });
    electron_1.ipcMain.handle("care:open-gift-box", (event) => {
        assertTrustedInvoke(event);
        return openGiftBox();
    });
    electron_1.ipcMain.handle("care:start-pet-job", (event, jobId) => {
        assertTrustedInvoke(event);
        if (!isJobId(jobId))
            throw new Error("没有这个打工");
        return startPetJob(jobId);
    });
    electron_1.ipcMain.handle("care:collect-pet-job", (event) => {
        assertTrustedInvoke(event);
        return collectPetJob();
    });
    electron_1.ipcMain.handle("care:cancel-pet-job", (event) => {
        assertTrustedInvoke(event);
        return cancelPetJobIpc();
    });
    electron_1.ipcMain.handle("care:claim-daily-quest", (event, questId) => {
        assertTrustedInvoke(event);
        if (typeof questId !== "string" || !questId.trim())
            throw new Error("任务不存在");
        return claimDailyQuest(questId);
    });
    electron_1.ipcMain.on("game:set-active", (event, active) => {
        assertTrustedSender(event.sender, event.senderFrame);
        if (typeof active === "boolean")
            setGameActive(active);
    });
    electron_1.ipcMain.handle("game:start", (event) => {
        assertTrustedInvoke(event);
        return startGameSession();
    });
    electron_1.ipcMain.handle("game:complete", (event, gameId, score) => {
        assertTrustedInvoke(event);
        if (!isGameId(gameId))
            throw new Error("没有这个小游戏");
        if (!data.settings.gameModeEnabled)
            throw new Error("小游戏模式已关闭");
        return completeGame(gameId, score);
    });
    electron_1.ipcMain.handle("article-game:url", async (event, gameId) => {
        assertTrustedInvoke(event);
        if (!(0, registry_1.isArticleGameId)(gameId))
            throw new Error("文章游戏无效");
        return articleGameUrl(gameId);
    });
    electron_1.ipcMain.handle("article-game:fit", (event, gameId) => {
        assertTrustedInvoke(event);
        if (gameId !== null && !(0, registry_1.isArticleGameId)(gameId))
            throw new Error("文章游戏无效");
        fitCenterWindowToArticleGame(gameId);
    });
    electron_1.ipcMain.handle("article-game:restore", (event) => {
        assertTrustedInvoke(event);
        restoreGameWindow();
    });
    electron_1.ipcMain.handle("article-game:open-online", async (event, gameId) => {
        assertTrustedInvoke(event);
        if (!(0, registry_1.isArticleGameId)(gameId))
            throw new Error("文章游戏无效");
        const definition = (0, registry_1.getArticleGameDefinition)(gameId);
        if (!definition.requiresNetwork || !definition.onlineUrl) {
            return { ok: false, message: "这个游戏已经内置在应用中" };
        }
        await electron_1.shell.openExternal(definition.onlineUrl);
        return { ok: true, message: `已在浏览器打开${definition.title}` };
    });
    electron_1.ipcMain.handle("desktop-bubble:start", (event) => {
        assertTrustedInvoke(event);
        return startDesktopBubbleSession();
    });
    electron_1.ipcMain.handle("desktop-bubble:hit", (event, sessionId, bubbleId) => {
        assertTrustedInvoke(event);
        if (typeof sessionId !== "string" || !sessionId || typeof bubbleId !== "string" || !bubbleId) {
            throw new Error("泡泡命中参数无效");
        }
        return hitDesktopBubble(sessionId, bubbleId);
    });
    electron_1.ipcMain.handle("desktop-bubble:stop", (event, sessionId, completed) => {
        assertTrustedInvoke(event);
        if (typeof sessionId !== "string" || !sessionId || typeof completed !== "boolean") {
            throw new Error("桌面互动结束参数无效");
        }
        return stopDesktopBubbleSession(sessionId, completed);
    });
    electron_1.ipcMain.handle("reminder:save", (_event, input) => {
        const index = input.id ? data.reminders.findIndex((item) => item.id === input.id) : -1;
        const reminder = normalizedReminder(input, index >= 0 ? data.reminders[index] : undefined);
        if (index >= 0)
            data.reminders[index] = reminder;
        else
            data.reminders.push(reminder);
        persistAndBroadcast();
        return snapshot();
    });
    electron_1.ipcMain.handle("reminder:remove", (_event, id) => {
        data.reminders = data.reminders.filter((item) => item.id !== id);
        persistAndBroadcast();
        return snapshot();
    });
    electron_1.ipcMain.handle("reminder:toggle", (_event, id) => {
        const reminder = data.reminders.find((item) => item.id === id);
        if (reminder)
            reminder.enabled = !reminder.enabled;
        persistAndBroadcast();
        return snapshot();
    });
    electron_1.ipcMain.handle("rule:save", (_event, input) => {
        const index = input.id ? data.appRules.findIndex((item) => item.id === input.id) : -1;
        const rule = normalizedRule(input, index >= 0 ? data.appRules[index] : undefined);
        if (index >= 0)
            data.appRules[index] = rule;
        else
            data.appRules.push(rule);
        persistAndBroadcast();
        return snapshot();
    });
    electron_1.ipcMain.handle("rule:remove", (_event, id) => {
        data.appRules = data.appRules.filter((item) => item.id !== id);
        if (currentAppRule?.id === id)
            currentAppRule = null;
        persistAndBroadcast();
        recomputeState(true);
        return snapshot();
    });
    electron_1.ipcMain.handle("rule:toggle", (_event, id) => {
        const rule = data.appRules.find((item) => item.id === id);
        if (rule)
            rule.enabled = !rule.enabled;
        if (currentAppRule?.id === id && !rule?.enabled)
            currentAppRule = null;
        persistAndBroadcast();
        recomputeState(true);
        return snapshot();
    });
    electron_1.ipcMain.handle("settings:update", (_event, patch) => {
        const previous = { ...data.settings };
        data.settings = (0, domain_1.normalizeCompanionSettings)({ ...data.settings, ...patch });
        applySettingsSideEffects(previous);
        persistAndBroadcast();
        return snapshot();
    });
    electron_1.ipcMain.handle("idle-phrases:update", (_event, phrases) => {
        data.idlePhrases = (0, domain_1.normalizeIdlePhrases)(phrases);
        persistAndBroadcast();
        return snapshot();
    });
    electron_1.ipcMain.handle("notification:test", () => {
        showSystemNotification("小满桌面伴侣", "系统通知工作正常");
        emitSound("chime");
    });
    electron_1.ipcMain.handle("activity:clear", () => {
        data.activity = [];
        persistAndBroadcast();
        return snapshot();
    });
    electron_1.ipcMain.handle("codex:threads:list", (event, force) => {
        assertTrustedInvoke(event);
        return listCodexThreads(Boolean(force));
    });
    electron_1.ipcMain.handle("codex:thread:open", (event, threadId) => {
        assertTrustedInvoke(event);
        return openCodexThread(threadId);
    });
    electron_1.ipcMain.handle("codex:thread:reply", (event, threadId, message) => {
        assertTrustedInvoke(event);
        return replyToCodexThread(threadId, message);
    });
    electron_1.ipcMain.handle("pet-studio:start", (event) => {
        assertTrustedInvoke(event);
        return startPetStudio();
    });
    electron_1.ipcMain.handle("pet-pack:list", (event) => {
        assertTrustedInvoke(event);
        return structuredClone(petPackSummaries);
    });
    electron_1.ipcMain.handle("pet-pack:runtime", (event) => {
        assertTrustedInvoke(event);
        return structuredClone(petPackRuntime);
    });
    electron_1.ipcMain.handle("pet-pack:import", (event, filePath) => {
        assertTrustedInvoke(event);
        return importPetPackFromRenderer(filePath);
    });
    electron_1.ipcMain.handle("pet-pack:activate", (event, id) => {
        assertTrustedInvoke(event);
        return activatePetPackFromRenderer(id);
    });
    electron_1.ipcMain.handle("pet-pack:remove", (event, id) => {
        assertTrustedInvoke(event);
        return removePetPackFromRenderer(id);
    });
    electron_1.ipcMain.handle("pet-pack:export-codex", (event, id) => {
        assertTrustedInvoke(event);
        return exportPetPackToCodexFromRenderer(id);
    });
    electron_1.ipcMain.on("quick:show", (event, mode) => {
        assertTrustedSender(event.sender, event.senderFrame);
        if (mode !== "care" && mode !== "interaction")
            throw new Error("快捷窗口模式无效");
        showQuickWindow(mode);
    });
    electron_1.ipcMain.on("app:quit", (event) => {
        assertTrustedSender(event.sender, event.senderFrame);
        electron_1.app.quit();
    });
    electron_1.ipcMain.on("overlay:hit-regions", (event, report) => {
        // Hit reports are high-frequency fire-and-forget messages; reject foreign senders without throwing in the main process.
        if (!isTrustedOverlaySender(event.sender, event.senderFrame, overlayWindow?.webContents))
            return;
        const next = acceptOverlayHitRegionReport(overlayHitRegionState, event.sender, report);
        if (!next.accepted)
            return;
        overlayHitRegionState = next.state;
        applyOverlayMousePolicy();
    });
    electron_1.ipcMain.on("overlay:mouse-mode", (event, mode) => {
        assertTrustedOverlaySender(event.sender, event.senderFrame);
        if (mode !== "passthrough" && mode !== "interactive")
            throw new Error("Overlay 鼠标模式无效");
        setOverlayMouseMode(mode);
    });
    electron_1.ipcMain.on("center:show", (event, tab) => {
        assertTrustedSender(event.sender, event.senderFrame);
        if (tab !== undefined && !isCenterTab(tab))
            throw new Error("控制中心标签无效");
        showCenter(tab);
    });
    electron_1.ipcMain.on("overlay:toggle", () => toggleOverlay());
    electron_1.ipcMain.on("overlay:task-panel", (event, open) => {
        assertTrustedOverlaySender(event.sender, event.senderFrame);
        if (typeof open === "boolean")
            setOverlayTaskPanel(open);
    });
    electron_1.ipcMain.on("overlay:panel", (event, mode) => {
        assertTrustedOverlaySender(event.sender, event.senderFrame);
        if (mode !== null && mode !== "codex" && mode !== "care" && mode !== "interaction") {
            throw new Error("Overlay 面板模式无效");
        }
        setOverlayPanel(mode);
    });
    electron_1.ipcMain.on("overlay:move-by", (event, deltaX, deltaY) => {
        assertTrustedOverlaySender(event.sender, event.senderFrame);
        moveOverlayBy(deltaX, deltaY);
    });
    electron_1.ipcMain.on("overlay:context-menu", (event) => {
        assertTrustedOverlaySender(event.sender, event.senderFrame);
        showOverlayContextMenu();
    });
}
function startTimers() {
    schedulerTimer = setInterval(() => runReminderScheduler(), 10_000);
    maintenanceTimer = setInterval(() => runMaintenance(), 10_000);
    autoSleepTimer = setInterval(() => runAutoSleepCheck(), 1_000);
    configureCursorTimer();
}
function configureCursorTimer() {
    if (cursorTimer)
        clearInterval(cursorTimer);
    cursorTimer = setInterval(() => {
        const window = overlayWindow;
        if (!window || window.isDestroyed()) {
            overlayMouseCapture = null;
            return;
        }
        let cursor;
        let bounds;
        let visible = false;
        try {
            visible = window.isVisible();
            cursor = electron_1.screen.getCursorScreenPoint();
            bounds = window.getBounds();
        }
        catch {
            overlayMouseCapture = null;
            return;
        }
        const capture = shouldCaptureOverlayPointer({
            visible,
            requestedMode: overlayMouseMode,
            cursor,
            bounds,
            report: effectiveOverlayHitRegionReport(),
        });
        if (overlayMouseCapture !== capture) {
            overlayMouseCapture = capture;
            setOverlayPointerCaptureForWindow(window, capture);
        }
        if (!visible || !data.settings.gazeEnabled)
            return;
        window.webContents.send("cursor:changed", {
            x: cursor.x - bounds.x,
            y: cursor.y - bounds.y,
            windowWidth: bounds.width,
            windowHeight: bounds.height,
        });
    }, 1000 / Math.max(30, Math.min(60, data.settings.gazeFrameRate)));
}
electron_1.app.on("second-instance", () => showCenter());
electron_1.app.whenReady().then(async () => {
    store = new store_1.CompanionStore(electron_1.app.getPath("userData"));
    data = store.load();
    petPackService = new pet_pack_service_1.PetPackService(electron_1.app.getPath("userData"));
    const loadedActivePetPackId = data.activePetPackId;
    try {
        const installed = await petPackService.listInstalled();
        const selected = data.activePetPackId && installed.some((summary) => summary.id === data.activePetPackId)
            ? data.activePetPackId
            : null;
        if (selected)
            await petPackService.setActive(selected);
        else
            await petPackService.clearActive();
        if (data.activePetPackId !== selected)
            data.activePetPackId = selected;
        await refreshPetPackState();
    }
    catch (error) {
        console.warn(`[xiaoman] Pet Pack state unavailable: ${petPackErrorMessage(error)}`);
        data.activePetPackId = null;
        petPackRuntime = (0, runtime_1.createBundledPetPackRuntime)();
        petPackSummaries = [createBundledPetPackSummary(true)];
    }
    if (loadedActivePetPackId !== data.activePetPackId)
        persist();
    codexSessionsService = new codex_sessions_1.CodexSessionsService();
    data.stats = (0, domain_1.decayStats)(data.stats, data.sleeping);
    const dailyQuestsRolled = rolloverDailyQuests(Date.now());
    const jobSettled = settleDueJobInMain();
    if (dailyQuestsRolled && !jobSettled)
        persist();
    else if (jobSettled)
        persistAndBroadcast();
    monitoring.notifications = !data.settings.systemNotifications
        ? "off"
        : electron_1.Notification.isSupported()
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
electron_1.app.on("activate", () => showCenter());
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
electron_1.app.on("before-quit", () => {
    quitting = true;
    if (schedulerTimer)
        clearInterval(schedulerTimer);
    if (maintenanceTimer)
        clearInterval(maintenanceTimer);
    if (autoSleepTimer)
        clearInterval(autoSleepTimer);
    if (cursorTimer)
        clearInterval(cursorTimer);
    if (stateTimer)
        clearTimeout(stateTimer);
    if (overlayPositionSaveTimer)
        clearTimeout(overlayPositionSaveTimer);
    clearDesktopSessionExpiryTimer();
    clearDesktopBubbleSessionWithoutReward(false);
    resetOverlayHitRegionState();
    if (overlayWindow && !overlayWindow.isDestroyed())
        setOverlayPointerCaptureForWindow(overlayWindow, false);
    overlayMouseCapture = null;
    applicationMonitor?.stop();
    void codexMonitor?.stop();
    for (const handle of activeCodexReplyHandles)
        handle.cancel();
    activeCodexReplyHandles.clear();
    void closeArticleGameHost();
    if (data && store)
        persist();
});
