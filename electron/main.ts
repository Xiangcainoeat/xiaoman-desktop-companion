import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
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
  type CodexSessionActivity,
  type CodexSessionSummary,
} from "./codex-sessions";
import { FrontmostApplicationMonitor } from "./application-monitor";
import { startArticleGameHost, type ArticleGameHost } from "./article-game-host";
import {
  applyBath,
  applyFeed,
  claimDailyQuest as claimCareQuest,
  completePetJob,
  grantCodexCompletionReward,
  openGiftBox as openCareGiftBox,
  startPetJob as startCareJob,
} from "../src/shared/care";
import { isRewardedGameId, REWARDED_GAME_IDS, settleGameResult } from "../src/shared/games";
import {
  canOpenAuxiliaryPanel,
  isSleepAllowedInteraction,
  shouldAutoSleep,
  SLEEPING_NOTICE,
  type AutoSleepInput,
} from "../src/shared/sleep";
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
  canHitDesktopBubble,
  DESKTOP_BUBBLE_MAX_HITS,
  DESKTOP_SESSION_DURATION_MS,
} from "../src/shared/desktop-interaction";
import {
  PET_STATES,
  SOUND_NAMES,
  type AppRule,
  type AppRuleInput,
  type AppSnapshot,
  type CenterTab,
  type CompanionSettings,
  type CodexOpenResult,
  type CodexReplyResult,
  type CodexThreadListResult,
  type CodexThreadSummary,
  type DesktopInteractionStatus,
  type FoodId,
  type GameId,
  type GameStartResult,
  type GameSettlement,
  type JobId,
  type InteractionAction,
  MAX_OVERLAY_HIT_REGIONS,
  type OverlayHitRegion,
  type OverlayInteractionReport,
  type OverlayPanelMode,
  type PetPackOperationResult,
  type PetPackSummary,
  type PetStudioStartResult,
  type PersistedData,
  type PetState,
  type Reminder,
  type ReminderInput,
  type SoundName,
  type QuickViewMode,
} from "../src/shared/types";
import {
  getArticleGameDefinition,
  isArticleGameId,
  type ArticleGameId,
} from "../src/article-games/registry";
import { articleGameWindowLayout, NORMAL_CENTER_WINDOW_SIZE } from "../src/article-games/layout";
import {
  PetPackService,
  PetPackServiceError,
  type PetPackSummary as InstalledPetPackSummary,
} from "./pet-pack-service";
import {
  BUNDLED_PET_PACK_ID,
  createBundledPetPackRuntime,
} from "../src/pet-pack/runtime";
import type { PetPackRuntime } from "../src/shared/types";
import { PET_STUDIO_INSTALL_COMMAND, buildPetStudioPrompt } from "../src/pet-studio/prompt";

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.setName("小满桌面伴侣");

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const DEFAULT_OVERLAY_WIDTH = 320;
const DEFAULT_OVERLAY_HEIGHT = 360;
const CENTER_WINDOW_MIN_SIZE = { width: 900, height: 640 } as const;
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
  | { kind: "complete-job" }
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

const GAME_IDS: readonly GameId[] = REWARDED_GAME_IDS;

function isFoodId(value: unknown): value is FoodId {
  return typeof value === "string" && FOOD_IDS.includes(value as FoodId);
}

function isJobId(value: unknown): value is JobId {
  return value === "desk-organizer" || value === "code-helper" || value === "delivery-run";
}

function isGameId(value: unknown): value is GameId {
  return isRewardedGameId(value);
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
  if (operation.kind === "complete-job") {
    const result = settleDuePetJob(data, now, random);
    return result.ok ? { ok: true, data: result.data, message: result.message ?? "打工完成啦" } : result;
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
  const result = completePetJob(data, now, random);
  if (!result.ok) return result;
  return { ok: true, data: result.data, message: result.message ?? "打工完成啦" };
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

export function canCompleteGame(
  gameActive: boolean,
  gameModeEnabled: boolean,
  desktopSessionActive = false,
): boolean {
  return gameActive && gameModeEnabled && !desktopSessionActive;
}

export function transitionGameActivity(
  currentActive: boolean,
  desktopSessionActive: boolean,
  requestedActive: boolean,
  gameModeEnabled: boolean,
): { accepted: boolean; active: boolean } {
  if (desktopSessionActive) return { accepted: false, active: currentActive };
  return { accepted: true, active: requestedActive && gameModeEnabled };
}

export interface DesktopBubbleSessionState {
  status: DesktopInteractionStatus;
  hitIds: ReadonlySet<string>;
  lastSessionId: string | null;
}

export function createDesktopBubbleSessionState(): DesktopBubbleSessionState {
  return {
    status: { active: false, sessionId: null, startedAt: null, score: 0 },
    hitIds: new Set(),
    lastSessionId: null,
  };
}

export function startDesktopBubbleSessionState(
  state: DesktopBubbleSessionState,
  now: number,
  gameModeEnabled: boolean,
  gameActive: boolean,
  sessionIdFactory = () => makeId("desktop-session"),
): DesktopBubbleSessionState {
  if (state.status.active || !gameModeEnabled || gameActive) return state;
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

export function hitDesktopBubbleState(
  state: DesktopBubbleSessionState,
  sessionId: string,
  bubbleId: string,
  now: number,
): { accepted: boolean; state: DesktopBubbleSessionState } {
  if (!canHitDesktopBubble(state.status, sessionId, bubbleId, now, state.hitIds)) {
    return { accepted: false, state };
  }
  const hitIds = new Set(state.hitIds);
  hitIds.add(bubbleId);
  return {
    accepted: true,
    state: {
      ...state,
      status: { ...state.status, score: Math.min(DESKTOP_BUBBLE_MAX_HITS, state.status.score + 1) },
      hitIds,
    },
  };
}

export function stopDesktopBubbleSessionState(
  state: DesktopBubbleSessionState,
  sessionId: string,
  completed: boolean,
  now: number,
): { state: DesktopBubbleSessionState; settlement: GameSettlement | null; accepted: boolean; changed: boolean } {
  if (!state.status.active) {
    return {
      state,
      settlement: null,
      accepted: state.lastSessionId === sessionId,
      changed: false,
    };
  }
  if (state.status.sessionId !== sessionId) return { state, settlement: null, accepted: false, changed: false };

  const expired = state.status.startedAt === null
    || now >= state.status.startedAt + DESKTOP_SESSION_DURATION_MS;
  const nextState: DesktopBubbleSessionState = {
    status: { active: false, sessionId: null, startedAt: null, score: 0 },
    hitIds: new Set(),
    lastSessionId: sessionId,
  };
  return {
    state: nextState,
    settlement: completed && !expired ? settleGameResult("bubble-pop", state.status.score) : null,
    accepted: true,
    changed: true,
  };
}

interface QuickWindowLike {
  isDestroyed(): boolean;
  show(): void;
  focus(): void;
}

export interface QuickLoadController<T> {
  enqueue(window: T, mode: QuickViewMode): void;
  invalidate(window: T): void;
}

export function createQuickLoadController<T>(
  load: (window: T, mode: QuickViewMode) => Promise<void>,
  isCurrent: (window: T) => boolean,
  onError: (error: unknown, window: T, mode: QuickViewMode) => void = () => undefined,
): QuickLoadController<T> {
  let generation = 0;
  let queue = Promise.resolve();

  const enqueue = (window: T, mode: QuickViewMode): void => {
    const requestGeneration = ++generation;
    queue = queue
      .catch(() => undefined)
      .then(async () => {
        if (requestGeneration !== generation || !isCurrent(window)) return;
        try {
          await load(window, mode);
        } catch (error) {
          if (requestGeneration !== generation || !isCurrent(window)) return;
          try {
            onError(error, window, mode);
          } catch {
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

export function teardownQuickWindow<T extends { isDestroyed(): boolean; destroy(): void }>(current: T | null, target: T): T | null {
  if (current !== target) return current;
  if (!target.isDestroyed()) target.destroy();
  return null;
}

export function ensureQuickWindow<T extends QuickWindowLike>(
  current: T | null,
  mode: QuickViewMode,
  createWindow: () => T,
  loadMode: (window: T, mode: QuickViewMode) => void,
): T {
  const window = current && !current.isDestroyed() ? current : createWindow();
  loadMode(window, mode);
  window.show();
  window.focus();
  return window;
}

export function isTrustedSender(
  sender: unknown,
  senderFrame: unknown,
  trustedContents: readonly unknown[],
): boolean {
  const mainFrame = (sender as { mainFrame?: unknown } | null)?.mainFrame;
  return trustedContents.includes(sender) && senderFrame === mainFrame;
}

export type OverlayMouseMode = "passthrough" | "interactive";

export interface OverlayScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayScreenPoint {
  x: number;
  y: number;
}

export interface OverlayPointerPolicyInput {
  visible: boolean;
  requestedMode: OverlayMouseMode;
  cursor: OverlayScreenPoint | null;
  bounds: OverlayScreenBounds;
  report: OverlayInteractionReport | null;
}

export interface OverlayHitRegionState {
  sender: unknown | null;
  revision: number;
  report: OverlayInteractionReport | null;
}

const MAX_OVERLAY_REGION_COORDINATE = 100_000;
const MAX_OVERLAY_REGION_SIZE = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeOverlayHitRegion(value: unknown, expectedKind: OverlayHitRegion["kind"]): OverlayHitRegion | null {
  if (!isRecord(value) || value.kind !== expectedKind) return null;
  const { x, y, width, height } = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  if (width <= 0 || height <= 0 || width > MAX_OVERLAY_REGION_SIZE || height > MAX_OVERLAY_REGION_SIZE) return null;
  if (Math.abs(x) > MAX_OVERLAY_REGION_COORDINATE || Math.abs(y) > MAX_OVERLAY_REGION_COORDINATE) return null;
  return { kind: expectedKind, x, y, width, height };
}

function normalizeOverlayHitRegions(
  value: unknown,
  expectedKind: OverlayHitRegion["kind"],
): OverlayHitRegion[] | null {
  if (!Array.isArray(value) || value.length > MAX_OVERLAY_HIT_REGIONS) return null;
  const regions = value.map((item) => normalizeOverlayHitRegion(item, expectedKind));
  return regions.every((region): region is OverlayHitRegion => region !== null) ? regions : null;
}

export function normalizeOverlayInteractionReport(value: unknown): OverlayInteractionReport | null {
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
    && value.interactiveRegions.length <= MAX_OVERLAY_HIT_REGIONS
    ? (value.interactiveRegions as unknown[]).map((item) => {
      if (!isRecord(item)) return null;
      const kind = item.kind;
      if (kind !== "pet" && kind !== "actions" && kind !== "task") return null;
      return normalizeOverlayHitRegion(item, kind);
    })
    : null;
  if (!bubbleRegions || !interactiveRegions
    || interactiveRegions.some((region): region is null => region === null)
    || bubbleRegions.length + interactiveRegions.length > MAX_OVERLAY_HIT_REGIONS) {
    return null;
  }
  return {
    revision: value.revision,
    bubbleActive: value.bubbleActive,
    interactiveActive: value.interactiveActive,
    bubbleRegions,
    interactiveRegions: interactiveRegions as OverlayHitRegion[],
  };
}

export function createOverlayHitRegionState(): OverlayHitRegionState {
  return { sender: null, revision: 0, report: null };
}

export function acceptOverlayHitRegionReport(
  state: OverlayHitRegionState,
  sender: unknown,
  value: unknown,
): { accepted: boolean; state: OverlayHitRegionState } {
  const report = normalizeOverlayInteractionReport(value);
  if (!report) return { accepted: false, state };
  if (state.sender === sender && report.revision <= state.revision) return { accepted: false, state };
  return {
    accepted: true,
    state: { sender, revision: report.revision, report },
  };
}

function pointInOverlayBounds(point: OverlayScreenPoint, bounds: OverlayScreenBounds): boolean {
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

function pointInOverlayRegion(
  point: OverlayScreenPoint,
  bounds: OverlayScreenBounds,
  region: OverlayHitRegion,
): boolean {
  const localX = point.x - bounds.x;
  const localY = point.y - bounds.y;
  return localX >= region.x
    && localY >= region.y
    && localX < region.x + region.width
    && localY < region.y + region.height;
}

export function shouldCaptureOverlayPointer(input: OverlayPointerPolicyInput): boolean {
  if (!input.visible) return false;
  // A task panel or an active pet drag owns the native window until release,
  // including while the pointer is outside the overlay's current bounds.
  if (input.report?.interactiveActive) return true;
  // The legacy renderer announces bubble activity with the same interactive
  // mode used by the pet. Once a report is present, scope that legacy mode to
  // the reported regions so transparent pixels remain click-through.
  if (input.requestedMode === "interactive" && (!input.report || !input.report.bubbleActive)) return true;
  if (!pointInOverlayBounds(input.cursor ?? { x: NaN, y: NaN }, input.bounds)) return false;
  if (!input.report || !input.cursor) return false;
  const regions = [
    ...(input.report.bubbleActive ? input.report.bubbleRegions : []),
    ...input.report.interactiveRegions,
  ];
  return regions.some((region) => pointInOverlayRegion(input.cursor!, input.bounds, region));
}

export function isTrustedOverlaySender(
  sender: unknown,
  senderFrame: unknown,
  overlayContents: unknown,
): boolean {
  return overlayContents !== null
    && overlayContents !== undefined
    && isTrustedSender(sender, senderFrame, [overlayContents]);
}

export function setOverlayPointerCaptureForWindow(
  window: { setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }): void },
  capture: boolean,
): void {
  if (capture) window.setIgnoreMouseEvents(false);
  else window.setIgnoreMouseEvents(true, { forward: true });
}

export function setOverlayMouseModeForWindow(
  window: { setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }): void },
  mode: OverlayMouseMode,
): void {
  setOverlayPointerCaptureForWindow(window, mode === "interactive");
}

let store: CompanionStore;
let data: PersistedData;
let petPackService: PetPackService | null = null;
let petPackRuntime: PetPackRuntime = createBundledPetPackRuntime();
let petPackSummaries: PetPackSummary[] = [];
let overlayWindow: BrowserWindow | null = null;
let centerWindow: BrowserWindow | null = null;
let articleGameHost: ArticleGameHost | null = null;
let articleGameHostStart: Promise<ArticleGameHost> | null = null;
let pendingCenterTab: CenterTab | null = null;
let centerWindowLoaded = false;
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
let desktopSessionExpiryTimer: NodeJS.Timeout | null = null;
let overlayPanelMode: OverlayPanelMode | null = null;
let codexThreadCache: { at: number; result: CodexThreadListResult } | null = null;
let codexThreadListInFlight: Promise<CodexThreadListResult> | null = null;
const codexReplyStarts = new Set<string>();
let quitting = false;
let currentAppRule: AppRule | null = null;
let stateSequence = 0;
let gameActive = false;
let desktopSessionState = createDesktopBubbleSessionState();
let overlayMouseMode: OverlayMouseMode = "passthrough";
let overlayHitRegionState = createOverlayHitRegionState();
let overlayMouseCapture: boolean | null = null;
let overlaySuppressedForArticleGame = false;
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

function createBundledPetPackSummary(active: boolean): PetPackSummary {
  const bundledRuntime = createBundledPetPackRuntime();
  return {
    id: BUNDLED_PET_PACK_ID,
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

function toRendererPetPackSummary(summary: InstalledPetPackSummary, activeId: string | null): PetPackSummary {
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

function petPackErrorMessage(error: unknown): string {
  if (error instanceof PetPackServiceError) {
    return error.errors.length > 0
      ? `${error.message}: ${error.errors.map((item) => item.message).join("；")}`
      : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

async function refreshPetPackState(): Promise<void> {
  const bundledRuntime = createBundledPetPackRuntime();
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
    } else {
      try {
        petPackRuntime = await petPackService.getRuntime(activeId);
      } catch {
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

function broadcastPetPackChanged(): void {
  const runtime = structuredClone(petPackRuntime);
  for (const window of [overlayWindow, centerWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send("pet-pack:changed", runtime);
  }
}

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
    desktopInteraction: { ...desktopSessionState.status },
    petPacks: petPackSummaries,
    petPackRuntime,
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

function broadcastOverlayPanelState(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("overlay:panel-state", overlayPanelMode);
    // Keep the boolean event for older renderer builds during an in-place update.
    overlayWindow.webContents.send("overlay:task-panel-state", overlayPanelMode === "codex");
  }
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
  if (data?.sleeping && state !== "sleeping" && source !== "interaction") return;
  // Care actions do not hide a live Codex task or an active reminder.
  if (source === "interaction" && (monitoring.codexBusy || runtimeState.source === "codex" || runtimeState.source === "reminder")) return;
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

  if (data.sleeping) {
    message = SLEEPING_NOTICE;
    source = "interaction";
    priority = 96;
  } else if (monitoring.codexBusy) {
    message = "Codex 正在处理任务";
    source = "codex";
    priority = 70;
  } else if (state === "hungry" || state === "dirty" || state === "sleepy") {
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

function notifySleeping(): void {
  if (!data?.sleeping) return;
  clearStateTimer();
  stateSequence += 1;
  runtimeState = {
    state: "sleeping",
    message: SLEEPING_NOTICE,
    source: "interaction",
    priority: 96,
    expiresAt: null,
  };
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
  durationMs = 4200,
): AppSnapshot {
  if (!result.ok) throw new Error(result.message);
  data = wakesInactivity ? wakeInactivitySleep(result.data) : result.data;
  data.activity = appendActivity(data.activity, {
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

function runCareMutation(
  operation: CareMutation,
  title: string,
  state: PetState,
  message: string,
  sound: SoundName,
  wakesInactivity = true,
  durationMs = 4200,
): AppSnapshot {
  if (data.sleeping) {
    notifySleeping();
    throw new Error(SLEEPING_NOTICE);
  }
  const now = Date.now();
  rolloverDailyQuests(now);
  const inputData = { ...data, stats: decayStats(data.stats, data.sleeping, now) };
  return commitCareMutation(applyCareMutation({ data: inputData, operation, now, random: careRandomSource }), title, state, message, sound, wakesInactivity, durationMs);
}

function feedFood(foodId: FoodId): AppSnapshot {
  return runCareMutation({ kind: "feed", foodId }, "喂了小满", "eating", "鱼干真香", "crunch", true, 6200);
}

function bathePet(): AppSnapshot {
  return runCareMutation({ kind: "bath" }, "给小满洗澡", "bathing", "洗得香香的", "chime", true, 6200);
}

function openGiftBox(): AppSnapshot {
  return runCareMutation({ kind: "open-gift" }, "打开了礼包", "celebrating", "礼包打开啦", "chime");
}

function startPetJob(jobId: JobId): AppSnapshot {
  return runCareMutation({ kind: "start-job", jobId }, "开始打工", "working", "打工中", "chime");
}

function collectPetJob(): AppSnapshot {
  return runCareMutation({ kind: "complete-job" }, "领取打工奖励", "celebrating", "打工奖励到账", "chime");
}

function cancelPetJobIpc(): AppSnapshot {
  return runCareMutation({ kind: "cancel-job" }, "取消打工", "idle", "已取消打工", "none");
}

function claimDailyQuest(questId: string): AppSnapshot {
  return runCareMutation({ kind: "claim-quest", questId }, "领取每日任务奖励", "celebrating", "领取成功", "chime");
}

function completeGame(gameId: GameId, score: number): AppSnapshot {
  if (data.sleeping) {
    notifySleeping();
    throw new Error(SLEEPING_NOTICE);
  }
  expireDesktopBubbleSessionIfNeeded();
  if (!canCompleteGame(gameActive, data.settings.gameModeEnabled, desktopSessionState.status.active)) {
    if (desktopSessionState.status.active) throw new Error("桌面泡泡互动正在进行");
    throw new Error("没有正在进行的游戏");
  }
  const result = runCareMutation({ kind: "complete-game", gameId, score }, "完成互动游戏", "playful", "游戏完成", "pop");
  gameActive = false;
  return result;
}

function wakeForGameInteraction(title = "开始互动游戏"): void {
  if (!(data.sleeping && data.sleepReason === "inactivity")) return;
  data = { ...data, sleeping: false, sleepReason: null };
  data.activity = appendActivity(data.activity, {
    source: "interaction",
    title,
    detail: "小满醒来陪你玩",
    state: "playful",
  });
  triggerState("playful", "一起玩吧", "interaction", 2600, 90, false);
  emitSound("pop");
  persistAndBroadcast();
}

async function performInteraction(action: InteractionAction): Promise<AppSnapshot> {
  if (data.sleeping && !isSleepAllowedInteraction(action)) {
    notifySleeping();
    return snapshot();
  }
  if (action === "feed") return feedFood("fish-snack");
  const now = Date.now();
  data = { ...data, stats: { ...decayStats(data.stats, data.sleeping, now), lastUpdatedAt: now } };
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
    closeAuxiliaryPanelsForSleep();
    data.activity = appendActivity(data.activity, {
      source: "interaction",
      title: "小满去睡觉",
      detail: "开始恢复精力",
      state: "sleeping",
    });
    triggerState("sleeping", SLEEPING_NOTICE, "interaction", null, 96, false);
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
    gameActive: gameActive || desktopSessionState.status.active,
    sleeping: data.sleeping,
    manualSleep: data.sleepReason === "manual",
  };
  if (!shouldAutoSleepForRuntime(input)) return;

  data = { ...data, sleeping: true, sleepReason: "inactivity" };
  closeAuxiliaryPanelsForSleep();
  data.activity = appendActivity(data.activity, {
    source: "system",
    title: "小满进入睡眠",
    detail: "系统空闲时间达到自动睡眠阈值",
    state: "sleeping",
  });
  triggerState("sleeping", SLEEPING_NOTICE, "system", null, 96, false);
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

function setGameActive(active: boolean): boolean {
  if (data.sleeping) {
    notifySleeping();
    return false;
  }
  expireDesktopBubbleSessionIfNeeded();
  const transition = transitionGameActivity(
    gameActive,
    desktopSessionState.status.active,
    active,
    data.settings.gameModeEnabled,
  );
  if (!transition.accepted) return false;
  gameActive = transition.active;
  if (!gameActive) return true;
  wakeForGameInteraction();
  return true;
}

function startGameSession(): GameStartResult {
  if (data.sleeping) {
    notifySleeping();
    return { accepted: false, message: SLEEPING_NOTICE };
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

function clearDesktopSessionExpiryTimer(): void {
  if (desktopSessionExpiryTimer) clearTimeout(desktopSessionExpiryTimer);
  desktopSessionExpiryTimer = null;
}

function clearDesktopBubbleSessionWithoutReward(shouldBroadcast = true): void {
  clearDesktopSessionExpiryTimer();
  if (!desktopSessionState.status.active) return;
  const sessionId = desktopSessionState.status.sessionId;
  if (!sessionId) return;
  desktopSessionState = stopDesktopBubbleSessionState(desktopSessionState, sessionId, false, Date.now()).state;
  applyOverlayMousePolicy();
  if (shouldBroadcast) broadcast();
}

function expireDesktopBubbleSession(sessionId: string): void {
  if (desktopSessionState.status.sessionId !== sessionId) return;
  clearDesktopBubbleSessionWithoutReward();
}

function expireDesktopBubbleSessionIfNeeded(now = Date.now()): boolean {
  const { active, sessionId, startedAt } = desktopSessionState.status;
  if (!active || !sessionId || startedAt === null || now < startedAt + DESKTOP_SESSION_DURATION_MS) return false;
  expireDesktopBubbleSession(sessionId);
  return true;
}

function scheduleDesktopSessionExpiry(sessionId: string, startedAt: number): void {
  clearDesktopSessionExpiryTimer();
  desktopSessionExpiryTimer = setTimeout(() => expireDesktopBubbleSession(sessionId), Math.max(0, startedAt + DESKTOP_SESSION_DURATION_MS - Date.now()));
}

export function startDesktopBubbleSession(): Promise<AppSnapshot> {
  if (data.sleeping) {
    notifySleeping();
    return Promise.reject(new Error(SLEEPING_NOTICE));
  }
  const now = Date.now();
  expireDesktopBubbleSessionIfNeeded(now);
  if (!data.settings.gameModeEnabled) return Promise.reject(new Error("小游戏模式已关闭"));
  if (desktopSessionState.status.active) return Promise.resolve(snapshot());
  if (gameActive) return Promise.reject(new Error("已有游戏正在进行"));
  desktopSessionState = startDesktopBubbleSessionState(desktopSessionState, now, data.settings.gameModeEnabled, gameActive);
  const sessionId = desktopSessionState.status.sessionId;
  if (!sessionId || desktopSessionState.status.startedAt === null) return Promise.reject(new Error("无法开始桌面互动"));
  wakeForGameInteraction("开始桌面泡泡互动");
  scheduleDesktopSessionExpiry(sessionId, desktopSessionState.status.startedAt);
  broadcast();
  return Promise.resolve(snapshot());
}

export function hitDesktopBubble(sessionId: string, bubbleId: string): Promise<AppSnapshot> {
  if (data.sleeping) {
    notifySleeping();
    return Promise.reject(new Error(SLEEPING_NOTICE));
  }
  const now = Date.now();
  expireDesktopBubbleSessionIfNeeded(now);
  const result = hitDesktopBubbleState(desktopSessionState, sessionId, bubbleId, now);
  if (!result.accepted) return Promise.reject(new Error("泡泡命中无效"));
  desktopSessionState = result.state;
  broadcast();
  return Promise.resolve(snapshot());
}

export function stopDesktopBubbleSession(sessionId: string, completed: boolean): Promise<AppSnapshot> {
  if (data.sleeping) {
    notifySleeping();
    return Promise.reject(new Error(SLEEPING_NOTICE));
  }
  const now = Date.now();
  const result = stopDesktopBubbleSessionState(desktopSessionState, sessionId, completed, now);
  if (!result.accepted) return Promise.reject(new Error("桌面互动 session 无效"));
  if (!result.changed) return Promise.resolve(snapshot());
  clearDesktopSessionExpiryTimer();
  desktopSessionState = result.state;
  applyOverlayMousePolicy();
  if (result.settlement) {
    const settled = runCareMutation(
      { kind: "complete-game", gameId: "bubble-pop", score: result.settlement.score },
      "完成桌面泡泡互动",
      "playful",
      "泡泡互动完成",
      "pop",
    );
    return Promise.resolve(settled);
  }
  broadcast();
  return Promise.resolve(snapshot());
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

async function startPetStudio(): Promise<PetStudioStartResult> {
  const base = {
    desktopOpened: false,
    installCommand: PET_STUDIO_INSTALL_COMMAND,
  };
  if (!data.settings.codexSessionControls) {
    return {
      ...base,
      ok: false,
      message: "Codex 任务功能已关闭，请先在偏好设置中开启",
    };
  }

  try {
    const started = await codexSessionsService.startPetStudioThread(
      buildPetStudioPrompt(),
      app.getPath("home"),
    );
    codexThreadCache = null;
    data.activity = appendActivity(data.activity, {
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
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      ok: false,
      message: `无法打开原生 Codex 宠物生成对话：${detail || "未知错误"}`,
    };
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

async function loadView(window: BrowserWindow, view: "overlay" | "center" | "quick", mode?: QuickViewMode): Promise<void> {
  if (isDevelopment) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL!);
    url.searchParams.set("view", view);
    if (view === "quick" && mode) url.searchParams.set("mode", mode);
    await window.loadURL(url.toString());
  } else {
    await window.loadFile(path.join(app.getAppPath(), "dist", "index.html"), {
      query: view === "quick" && mode ? { view, mode } : { view },
    });
  }
}

function reportViewLoadError(view: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[xiaoman] failed to load ${view} view${detail ? `: ${detail}` : ""}`);
}

function loadViewSafely(window: BrowserWindow, view: "overlay" | "center" | "quick", mode?: QuickViewMode): void {
  void loadView(window, view, mode).catch((error) => reportViewLoadError(view, error));
}

function isExternalHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function openExternalHttpUrl(value: string): void {
  if (!isExternalHttpUrl(value)) return;
  void shell.openExternal(value).catch((error) => {
    console.warn(`[xiaoman] failed to open external link: ${String(error)}`);
  });
}

function articleGameRoot(): string {
  return isDevelopment
    ? path.join(process.cwd(), "public", "article-games")
    : path.join(app.getAppPath(), "dist", "article-games");
}

async function getArticleGameHost(): Promise<ArticleGameHost> {
  if (articleGameHost) return articleGameHost;
  articleGameHostStart ??= startArticleGameHost(articleGameRoot()).then((host) => {
    articleGameHost = host;
    return host;
  }).catch((error) => {
    articleGameHostStart = null;
    throw error;
  });
  return articleGameHostStart;
}

async function articleGameUrl(id: ArticleGameId): Promise<string> {
  if (data.sleeping) {
    notifySleeping();
    throw new Error(SLEEPING_NOTICE);
  }
  if (!data.settings.gameModeEnabled) throw new Error("小游戏模式已关闭");
  const definition = getArticleGameDefinition(id);
  if (definition.availability !== "offline") {
    throw new Error(`${definition.title}需要网络，请使用在线入口`);
  }
  const host = await getArticleGameHost();
  return `${host.url}/${encodeURIComponent(id)}/${definition.entryPath.replace(/^\/+/, "")}`;
}

async function closeArticleGameHost(): Promise<void> {
  const host = articleGameHost;
  articleGameHost = null;
  articleGameHostStart = null;
  await host?.close();
}

function hardenRendererWindow(window: BrowserWindow): void {
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

function assertTrustedSender(
  sender: IpcMainInvokeEvent["sender"],
  senderFrame: IpcMainInvokeEvent["senderFrame"],
): void {
  const trustedContents = [overlayWindow?.webContents, centerWindow?.webContents]
    .filter((contents) => contents && !contents.isDestroyed());
  if (!isTrustedSender(sender, senderFrame, trustedContents)) {
    throw new Error("Rejected IPC call from an untrusted renderer");
  }
}

function assertTrustedInvoke(event: IpcMainInvokeEvent): void {
  assertTrustedSender(event.sender, event.senderFrame);
}

function assertTrustedOverlaySender(
  sender: IpcMainInvokeEvent["sender"],
  senderFrame: IpcMainInvokeEvent["senderFrame"],
): void {
  if (!isTrustedOverlaySender(sender, senderFrame, overlayWindow?.webContents)) {
    throw new Error("Rejected overlay IPC call from an untrusted renderer");
  }
}

function resetOverlayHitRegionState(): void {
  overlayHitRegionState = createOverlayHitRegionState();
}

function effectiveOverlayHitRegionReport(): OverlayInteractionReport | null {
  const report = overlayHitRegionState.report;
  if (!report) return null;
  const bubblesEnabled = Boolean(data?.settings?.gameModeEnabled && desktopSessionState.status.active);
  const interactiveActive = report.interactiveActive || overlayPanelMode !== null;
  if (report.bubbleActive && !bubblesEnabled) {
    return { ...report, bubbleActive: false, bubbleRegions: [], interactiveActive };
  }
  if (interactiveActive !== report.interactiveActive) return { ...report, interactiveActive };
  return report;
}

function applyOverlayMousePolicy(): void {
  const window = overlayWindow;
  if (!window || window.isDestroyed()) {
    overlayMouseCapture = null;
    return;
  }

  let visible = false;
  let bounds: OverlayScreenBounds = { x: 0, y: 0, width: 0, height: 0 };
  let cursor: OverlayScreenPoint | null = null;
  try {
    visible = window.isVisible();
    bounds = window.getBounds();
    cursor = screen.getCursorScreenPoint();
  } catch {
    visible = false;
  }
  const capture = shouldCaptureOverlayPointer({
    visible,
    requestedMode: overlayMouseMode,
    cursor,
    bounds,
    report: effectiveOverlayHitRegionReport(),
  });
  if (overlayMouseCapture === capture) return;
  overlayMouseCapture = capture;
  setOverlayPointerCaptureForWindow(window, capture);
}

function overlayDimensions(petSize = data.settings.petSize): { width: number; height: number } {
  return calculateOverlayDimensions(petSize, overlayPanelMode);
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
  const window = new BrowserWindow({
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
  overlayWindow = window;
  overlayMouseMode = "passthrough";
  overlayHitRegionState = createOverlayHitRegionState();
  overlayMouseCapture = null;
  hardenRendererWindow(window);
  setOverlayPointerCaptureForWindow(window, false);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setHiddenInMissionControl(true);
  window.on("move", () => {
    if (overlayWindow === window) applyOverlayMousePolicy();
  });
  window.on("resize", () => {
    if (overlayWindow === window) applyOverlayMousePolicy();
  });
  window.on("focus", () => {
    if (overlayWindow === window) applyOverlayMousePolicy();
  });
  window.on("blur", () => {
    if (overlayWindow !== window) return;
    setOverlayPanel(null);
    // A lost pointer capture must never leave the transparent window blocking the desktop.
    overlayMouseMode = "passthrough";
    applyOverlayMousePolicy();
  });
  window.webContents.on("did-start-loading", () => {
    if (overlayWindow !== window) return;
    overlayMouseMode = "passthrough";
    resetOverlayHitRegionState();
    applyOverlayMousePolicy();
  });
  window.webContents.on("render-process-gone", () => {
    if (overlayWindow !== window) return;
    overlayMouseMode = "passthrough";
    resetOverlayHitRegionState();
    applyOverlayMousePolicy();
  });
  window.on("closed", () => {
    if (overlayWindow !== window) return;
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
    if (data.settings.overlayVisible && !overlaySuppressedForArticleGame) window.showInactive();
    applyOverlayMousePolicy();
    broadcast();
    broadcastOverlayPanelState();
  });
  loadViewSafely(window, "overlay");
}

const CENTER_TABS: readonly CenterTab[] = [
  "features",
  "care",
  "games",
  "codex",
  "overview",
  "reminders",
  "events",
  "settings",
];

function isCenterTab(value: unknown): value is CenterTab {
  return typeof value === "string" && CENTER_TABS.includes(value as CenterTab);
}

function flushPendingCenterTab(): void {
  if (!centerWindow || centerWindow.isDestroyed() || !centerWindowLoaded || pendingCenterTab === null) return;
  const tab = pendingCenterTab;
  pendingCenterTab = null;
  centerWindow.webContents.send("center:select-tab", tab);
}

function createCenterWindow(): void {
  centerWindowLoaded = false;
  const window = new BrowserWindow({
    width: NORMAL_CENTER_WINDOW_SIZE.width,
    height: NORMAL_CENTER_WINDOW_SIZE.height,
    minWidth: CENTER_WINDOW_MIN_SIZE.width,
    minHeight: CENTER_WINDOW_MIN_SIZE.height,
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
  centerWindow = window;
  hardenRendererWindow(window);
  window.webContents.on("did-start-loading", () => {
    if (centerWindow !== window) return;
    centerWindowLoaded = false;
  });
  window.webContents.on("did-finish-load", () => {
    if (centerWindow !== window) return;
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
    if (centerWindow !== window) return;
    flushPendingCenterTab();
    broadcast();
  });
  window.on("closed", () => {
    if (centerWindow !== window) return;
    restoreOverlayAfterArticleGame();
    centerWindowLoaded = false;
    pendingCenterTab = null;
    centerWindow = null;
  });
  loadViewSafely(window, "center");
}

function showCenter(tab?: CenterTab): void {
  // A center view replaces any overlay shortcut panel immediately.
  if (overlayPanelMode !== null) setOverlayPanel(null);
  if (tab !== undefined) pendingCenterTab = tab;
  if (!centerWindow || centerWindow.isDestroyed()) createCenterWindow();
  if (tab !== undefined && tab !== "games") restoreGameWindow();
  centerWindow?.show();
  centerWindow?.focus();
  flushPendingCenterTab();
}

function suppressOverlayForArticleGame(): void {
  if (overlaySuppressedForArticleGame) return;
  overlaySuppressedForArticleGame = true;
  if (overlayPanelMode !== null) setOverlayPanel(null);
  overlayMouseMode = "passthrough";
  overlayMouseCapture = null;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
    applyOverlayMousePolicy();
  }
}

function restoreOverlayAfterArticleGame(): void {
  if (!overlaySuppressedForArticleGame) return;
  overlaySuppressedForArticleGame = false;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (data.settings.overlayVisible && !data.sleeping) overlayWindow.showInactive();
    applyOverlayMousePolicy();
  }
}

function fitCenterWindowToArticleGame(gameId: ArticleGameId | null): void {
  const window = centerWindow;
  if (!window || window.isDestroyed()) return;
  const layout = gameId ? articleGameWindowLayout(getArticleGameDefinition(gameId)) : null;
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

function clampCenterWindowToWorkArea(window: BrowserWindow): void {
  const bounds = window.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - bounds.width);
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - bounds.height);
  const x = Math.max(workArea.x, Math.min(bounds.x, maxX));
  const y = Math.max(workArea.y, Math.min(bounds.y, maxY));
  if (x !== bounds.x || y !== bounds.y) window.setPosition(x, y, false);
}

function restoreGameWindow(): void {
  restoreOverlayAfterArticleGame();
  const window = centerWindow;
  if (!window || window.isDestroyed()) return;
  window.setMinimumSize(CENTER_WINDOW_MIN_SIZE.width, CENTER_WINDOW_MIN_SIZE.height);
  window.setSize(NORMAL_CENTER_WINDOW_SIZE.width, NORMAL_CENTER_WINDOW_SIZE.height, false);
  clampCenterWindowToWorkArea(window);
}

function closeAuxiliaryPanelsForSleep(): void {
  clearDesktopBubbleSessionWithoutReward(false);
  gameActive = false;
  resetOverlayHitRegionState();
  setOverlayPanel(null);
  applyOverlayMousePolicy();
}

export function showQuickWindow(mode: QuickViewMode): void {
  if (!canOpenAuxiliaryPanel(data.sleeping)) {
    notifySleeping();
    return;
  }
  // Care and interaction replace the Codex panel in the same transparent host.
  setOverlayPanel(mode);
}

export function setOverlayMouseMode(mode: OverlayMouseMode): void {
  overlayMouseMode = mode;
  applyOverlayMousePolicy();
}

function toggleOverlay(): void {
  if (!overlayWindow) return;
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
    { label: "喂鱼干", click: () => performMenuInteraction("feed") },
    { label: "摸摸", click: () => performMenuInteraction("pet") },
    { label: "一起玩", click: () => performMenuInteraction("play") },
    { label: data.sleeping ? "叫醒" : "睡觉", click: () => performMenuInteraction(data.sleeping ? "wake" : "sleep") },
    { type: "separator" },
    { label: "退出小满桌面伴侣", click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function showCenterFromOverlayMenu(): void {
  if (data.sleeping) {
    notifySleeping();
    return;
  }
  showCenter();
}

function showOverlayContextMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    { label: "喂鱼干", click: () => performMenuInteraction("feed") },
    { label: "摸摸", click: () => performMenuInteraction("pet") },
    { label: "一起玩", click: () => performMenuInteraction("play") },
    { label: data.sleeping ? "叫醒" : "睡觉", click: () => performMenuInteraction(data.sleeping ? "wake" : "sleep") },
    { type: "separator" },
    { label: "打开控制中心", click: () => showCenterFromOverlayMenu() },
    { label: "隐藏小满", click: () => toggleOverlay() },
    { type: "separator" },
    { label: "退出小满桌面伴侣", click: () => app.quit() },
  ];
  Menu.buildFromTemplate(template).popup({ window: overlayWindow ?? undefined });
}

function performMenuInteraction(action: InteractionAction): void {
  void performInteraction(action).catch((error) => {
    if (data.sleeping) {
      notifySleeping();
      return;
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[xiaoman] menu interaction failed${detail ? `: ${detail}` : ""}`);
  });
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

function setOverlayPanel(mode: OverlayPanelMode | null): void {
  if (mode !== null && !canOpenAuxiliaryPanel(data.sleeping)) {
    notifySleeping();
    return;
  }
  const next = mode === "codex" && !data.settings.codexSessionControls ? null : mode;
  if (overlayPanelMode === next) return;
  if (next !== null && overlaySuppressedForArticleGame) return;
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

function setOverlayTaskPanel(open: boolean): void {
  setOverlayPanel(open ? "codex" : null);
}

function applySettingsSideEffects(previous: CompanionSettings): void {
  if (overlayWindow) {
    overlayWindow.setAlwaysOnTop(data.settings.alwaysOnTop);
    if (data.settings.overlayVisible && !overlaySuppressedForArticleGame && !overlayWindow.isVisible()) overlayWindow.showInactive();
    if (!data.settings.overlayVisible) {
      overlayMouseMode = "passthrough";
      if (overlayWindow.isVisible()) overlayWindow.hide();
    }
    applyOverlayMousePolicy();
  }
  if (previous.monitorCodex !== data.settings.monitorCodex) void configureCodexMonitor();
  if (previous.monitorApps !== data.settings.monitorApps) configureApplicationMonitor();
  if (previous.gazeFrameRate !== data.settings.gazeFrameRate) configureCursorTimer();
  if (previous.petSize !== data.settings.petSize) resizeOverlayForPet();
  if (previous.codexSessionControls && !data.settings.codexSessionControls && overlayPanelMode === "codex") {
    setOverlayPanel(null);
  }
  if (previous.startAtLogin !== data.settings.startAtLogin && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: data.settings.startAtLogin });
  }
  if (previous.codexReplyTransport !== data.settings.codexReplyTransport) codexThreadCache = null;
  if (previous.gameModeEnabled && !data.settings.gameModeEnabled) {
    clearDesktopBubbleSessionWithoutReward(false);
    gameActive = false;
    resetOverlayHitRegionState();
    applyOverlayMousePolicy();
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

async function importPetPackFromRenderer(filePath: unknown): Promise<PetPackOperationResult> {
  if (!petPackService) {
    return { ok: false, message: "Pet Pack 服务尚未启动", errorCode: "service-unavailable" };
  }
  let selectedPath: string | undefined;
  if (typeof filePath === "string" && filePath.trim()) selectedPath = path.resolve(filePath);
  if (!selectedPath) {
    const result = await dialog.showOpenDialog({
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
  } catch (error) {
    return { ok: false, message: petPackErrorMessage(error), errorCode: error instanceof PetPackServiceError ? error.code : "import-failed" };
  }
}

async function activatePetPackFromRenderer(id: unknown): Promise<AppSnapshot> {
  if (!petPackService) throw new Error("Pet Pack 服务尚未启动");
  if (id === null) {
    await petPackService.clearActive();
    data.activePetPackId = null;
  } else {
    if (typeof id !== "string" || !id.trim()) throw new Error("Pet Pack ID 无效");
    await petPackService.setActive(id);
    data.activePetPackId = id;
  }
  await refreshPetPackState();
  persistAndBroadcast();
  broadcastPetPackChanged();
  return snapshot();
}

async function removePetPackFromRenderer(id: unknown): Promise<AppSnapshot> {
  if (!petPackService) throw new Error("Pet Pack 服务尚未启动");
  if (typeof id !== "string" || !id.trim()) throw new Error("Pet Pack ID 无效");
  await petPackService.remove(id);
  if (data.activePetPackId === id) data.activePetPackId = null;
  await refreshPetPackState();
  persistAndBroadcast();
  broadcastPetPackChanged();
  return snapshot();
}

async function exportPetPackToCodexFromRenderer(id: unknown): Promise<PetPackOperationResult> {
  if (!petPackService) return { ok: false, message: "Pet Pack 服务尚未启动", errorCode: "service-unavailable" };
  if (typeof id !== "string" || !id.trim()) return { ok: false, message: "Pet Pack ID 无效", errorCode: "invalid-id" };
  try {
    const result = await petPackService.exportCodex(id);
    return {
      ok: true,
      message: `已导出到 ${result.path}`,
      files: result.files,
      path: result.path,
      backupPath: result.backupPath,
    };
  } catch (error) {
    return { ok: false, message: petPackErrorMessage(error), errorCode: error instanceof PetPackServiceError ? error.code : "export-failed" };
  }
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
  ipcMain.handle("care:collect-pet-job", (event) => {
    assertTrustedInvoke(event);
    return collectPetJob();
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
  ipcMain.handle("game:start", (event) => {
    assertTrustedInvoke(event);
    return startGameSession();
  });
  ipcMain.handle("game:complete", (event, gameId: GameId, score: number) => {
    assertTrustedInvoke(event);
    if (!isGameId(gameId)) throw new Error("没有这个小游戏");
    if (!data.settings.gameModeEnabled) throw new Error("小游戏模式已关闭");
    return completeGame(gameId, score);
  });
  ipcMain.handle("article-game:url", async (event, gameId: unknown) => {
    assertTrustedInvoke(event);
    if (!isArticleGameId(gameId)) throw new Error("文章游戏无效");
    return articleGameUrl(gameId);
  });
  ipcMain.handle("article-game:fit", (event, gameId: unknown) => {
    assertTrustedInvoke(event);
    if (gameId !== null && !isArticleGameId(gameId)) throw new Error("文章游戏无效");
    fitCenterWindowToArticleGame(gameId);
  });
  ipcMain.handle("article-game:restore", (event) => {
    assertTrustedInvoke(event);
    restoreGameWindow();
  });
  ipcMain.handle("article-game:open-online", async (event, gameId: unknown) => {
    assertTrustedInvoke(event);
    if (!isArticleGameId(gameId)) throw new Error("文章游戏无效");
    const definition = getArticleGameDefinition(gameId);
    if (!definition.requiresNetwork || !definition.onlineUrl) {
      return { ok: false, message: "这个游戏已经内置在应用中" };
    }
    await shell.openExternal(definition.onlineUrl);
    return { ok: true, message: `已在浏览器打开${definition.title}` };
  });
  ipcMain.handle("desktop-bubble:start", (event) => {
    assertTrustedInvoke(event);
    return startDesktopBubbleSession();
  });
  ipcMain.handle("desktop-bubble:hit", (event, sessionId: unknown, bubbleId: unknown) => {
    assertTrustedInvoke(event);
    if (typeof sessionId !== "string" || !sessionId || typeof bubbleId !== "string" || !bubbleId) {
      throw new Error("泡泡命中参数无效");
    }
    return hitDesktopBubble(sessionId, bubbleId);
  });
  ipcMain.handle("desktop-bubble:stop", (event, sessionId: unknown, completed: unknown) => {
    assertTrustedInvoke(event);
    if (typeof sessionId !== "string" || !sessionId || typeof completed !== "boolean") {
      throw new Error("桌面互动结束参数无效");
    }
    return stopDesktopBubbleSession(sessionId, completed);
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
  ipcMain.handle("pet-studio:start", (event) => {
    assertTrustedInvoke(event);
    return startPetStudio();
  });
  ipcMain.handle("pet-pack:list", (event) => {
    assertTrustedInvoke(event);
    return structuredClone(petPackSummaries);
  });
  ipcMain.handle("pet-pack:runtime", (event) => {
    assertTrustedInvoke(event);
    return structuredClone(petPackRuntime);
  });
  ipcMain.handle("pet-pack:import", (event, filePath: unknown) => {
    assertTrustedInvoke(event);
    return importPetPackFromRenderer(filePath);
  });
  ipcMain.handle("pet-pack:activate", (event, id: unknown) => {
    assertTrustedInvoke(event);
    return activatePetPackFromRenderer(id);
  });
  ipcMain.handle("pet-pack:remove", (event, id: unknown) => {
    assertTrustedInvoke(event);
    return removePetPackFromRenderer(id);
  });
  ipcMain.handle("pet-pack:export-codex", (event, id: unknown) => {
    assertTrustedInvoke(event);
    return exportPetPackToCodexFromRenderer(id);
  });
  ipcMain.on("quick:show", (event, mode: unknown) => {
    assertTrustedSender(event.sender, event.senderFrame);
    if (mode !== "care" && mode !== "interaction") throw new Error("快捷窗口模式无效");
    showQuickWindow(mode);
  });
  ipcMain.on("app:quit", (event) => {
    assertTrustedSender(event.sender, event.senderFrame);
    app.quit();
  });
  ipcMain.on("overlay:hit-regions", (event, report: unknown) => {
    // Hit reports are high-frequency fire-and-forget messages; reject foreign senders without throwing in the main process.
    if (!isTrustedOverlaySender(event.sender, event.senderFrame, overlayWindow?.webContents)) return;
    const next = acceptOverlayHitRegionReport(overlayHitRegionState, event.sender, report);
    if (!next.accepted) return;
    overlayHitRegionState = next.state;
    applyOverlayMousePolicy();
  });
  ipcMain.on("overlay:mouse-mode", (event, mode: unknown) => {
    assertTrustedOverlaySender(event.sender, event.senderFrame);
    if (mode !== "passthrough" && mode !== "interactive") throw new Error("Overlay 鼠标模式无效");
    setOverlayMouseMode(mode);
  });
  ipcMain.on("center:show", (event, tab: unknown) => {
    assertTrustedSender(event.sender, event.senderFrame);
    if (tab !== undefined && !isCenterTab(tab)) throw new Error("控制中心标签无效");
    showCenter(tab as CenterTab | undefined);
  });
  ipcMain.on("overlay:toggle", () => toggleOverlay());
  ipcMain.on("overlay:task-panel", (event, open: unknown) => {
    assertTrustedOverlaySender(event.sender, event.senderFrame);
    if (typeof open === "boolean") setOverlayTaskPanel(open);
  });
  ipcMain.on("overlay:panel", (event, mode: unknown) => {
    assertTrustedOverlaySender(event.sender, event.senderFrame);
    if (mode !== null && mode !== "codex" && mode !== "care" && mode !== "interaction") {
      throw new Error("Overlay 面板模式无效");
    }
    setOverlayPanel(mode as OverlayPanelMode | null);
  });
  ipcMain.on("overlay:move-by", (event, deltaX: number, deltaY: number) => {
    assertTrustedOverlaySender(event.sender, event.senderFrame);
    moveOverlayBy(deltaX, deltaY);
  });
  ipcMain.on("overlay:context-menu", (event) => {
    assertTrustedOverlaySender(event.sender, event.senderFrame);
    showOverlayContextMenu();
  });
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
    const window = overlayWindow;
    if (!window || window.isDestroyed()) {
      overlayMouseCapture = null;
      return;
    }

    let cursor: OverlayScreenPoint;
    let bounds: OverlayScreenBounds;
    let visible = false;
    try {
      visible = window.isVisible();
      cursor = screen.getCursorScreenPoint();
      bounds = window.getBounds();
    } catch {
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
    if (!visible || !data.settings.gazeEnabled) return;
    window.webContents.send("cursor:changed", {
      x: cursor.x - bounds.x,
      y: cursor.y - bounds.y,
      windowWidth: bounds.width,
      windowHeight: bounds.height,
    });
  }, 1000 / Math.max(30, Math.min(60, data.settings.gazeFrameRate)));
}

app.on("second-instance", () => showCenter());

app.whenReady().then(async () => {
  store = new CompanionStore(app.getPath("userData"));
  data = store.load();
  petPackService = new PetPackService(app.getPath("userData"));
  const loadedActivePetPackId = data.activePetPackId;
  try {
    const installed = await petPackService.listInstalled();
    const selected = data.activePetPackId && installed.some((summary) => summary.id === data.activePetPackId)
      ? data.activePetPackId
      : null;
    if (selected) await petPackService.setActive(selected);
    else await petPackService.clearActive();
    if (data.activePetPackId !== selected) data.activePetPackId = selected;
    await refreshPetPackState();
  } catch (error) {
    console.warn(`[xiaoman] Pet Pack state unavailable: ${petPackErrorMessage(error)}`);
    data.activePetPackId = null;
    petPackRuntime = createBundledPetPackRuntime();
    petPackSummaries = [createBundledPetPackSummary(true)];
  }
  if (loadedActivePetPackId !== data.activePetPackId) persist();
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
  clearDesktopSessionExpiryTimer();
  clearDesktopBubbleSessionWithoutReward(false);
  resetOverlayHitRegionState();
  if (overlayWindow && !overlayWindow.isDestroyed()) setOverlayPointerCaptureForWindow(overlayWindow, false);
  overlayMouseCapture = null;
  applicationMonitor?.stop();
  void codexMonitor?.stop();
  for (const handle of activeCodexReplyHandles) handle.cancel();
  activeCodexReplyHandles.clear();
  void closeArticleGameHost();
  if (data && store) persist();
});
