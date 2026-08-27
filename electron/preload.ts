import { contextBridge, ipcRenderer } from "electron";
import type {
  AppRuleInput,
  AppSnapshot,
  CenterTab,
  CompanionSettings,
  CodexOpenResult,
  CodexReplyResult,
  CodexThreadListResult,
  CursorPayload,
  FoodId,
  GameId,
  GameStartResult,
  JobId,
  InteractionAction,
  OverlayHitRegion,
  OverlayInteractionReport,
  QuickViewMode,
  ReminderInput,
  SoundName,
} from "../src/shared/types";

// Sandboxed preloads cannot require application-relative runtime modules.
// Keep this protocol limit local and aligned with the shared type contract.
const MAX_OVERLAY_HIT_REGIONS = 64;

function isOverlayView(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URL(window.location.href).searchParams.get("view") === "overlay";
  } catch {
    return false;
  }
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

const centerTabListeners = new Set<(tab: CenterTab) => void>();
let pendingCenterTab: CenterTab | null = null;

ipcRenderer.on("center:select-tab", (_event, value: unknown) => {
  if (!isCenterTab(value)) return;
  if (centerTabListeners.size === 0) {
    pendingCenterTab = value;
    return;
  }
  for (const listener of centerTabListeners) listener(value);
});

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function readOverlayHitRegion(element: Element, kind: OverlayHitRegion["kind"]): OverlayHitRegion | null {
  const rect = element.getBoundingClientRect();
  if (!Number.isFinite(rect.left)
    || !Number.isFinite(rect.top)
    || !Number.isFinite(rect.width)
    || !Number.isFinite(rect.height)
    || rect.width <= 0
    || rect.height <= 0) {
    return null;
  }
  return {
    kind,
    x: rounded(rect.left),
    y: rounded(rect.top),
    width: rounded(rect.width),
    height: rounded(rect.height),
  };
}

function installOverlayHitRegionReporter(): void {
  if (!isOverlayView() || typeof document === "undefined") return;

  let revision = 0;
  let lastFingerprint = "";
  let animationFrame = 0;
  let disposed = false;
  let observer: MutationObserver | null = null;
  let resizeObserver: ResizeObserver | null = null;
  const activePetPointers = new Set<number>();

  const isPetPointer = (event: PointerEvent): boolean => (
    event.target instanceof Element
    && event.target.closest(".overlay-pet-hitbox") !== null
  );

  const report = (force = false): void => {
    if (disposed) return;
    const bubbleRegions = Array.from(document.querySelectorAll(".desktop-bubble.is-active"))
      .map((element) => readOverlayHitRegion(element, "bubble"))
      .filter((region): region is OverlayHitRegion => region !== null);
    const interactiveRegions = [
      ...Array.from(document.querySelectorAll(".overlay-pet-hitbox"))
        .map((element) => readOverlayHitRegion(element, "pet")),
      ...Array.from(document.querySelectorAll(".overlay-actions"))
        .map((element) => readOverlayHitRegion(element, "actions")),
      ...Array.from(document.querySelectorAll(".overlay-codex-panel"))
        .map((element) => readOverlayHitRegion(element, "task")),
    ].filter((region): region is OverlayHitRegion => region !== null);
    const boundedBubbles = bubbleRegions.slice(0, MAX_OVERLAY_HIT_REGIONS);
    const boundedInteractive = interactiveRegions.slice(0, Math.max(0, MAX_OVERLAY_HIT_REGIONS - boundedBubbles.length));
    const payload = {
      bubbleActive: document.querySelector(".desktop-bubble") !== null,
      interactiveActive: activePetPointers.size > 0
        || document.querySelector(".overlay-root.has-task-panel") !== null,
      bubbleRegions: boundedBubbles,
      interactiveRegions: boundedInteractive,
    } satisfies Omit<OverlayInteractionReport, "revision">;
    const fingerprint = JSON.stringify(payload);
    if (!force && fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    revision += 1;
    ipcRenderer.send("overlay:hit-regions", { ...payload, revision });
  };

  const scheduleReport = (): void => {
    if (disposed || animationFrame !== 0) return;
    animationFrame = window.requestAnimationFrame(() => {
      animationFrame = 0;
      report();
    });
  };

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
    observer?.disconnect();
    resizeObserver?.disconnect();
    document.removeEventListener("pointerdown", handlePointerDown, true);
    document.removeEventListener("pointerup", handlePointerEnd, true);
    document.removeEventListener("pointercancel", handlePointerEnd, true);
    document.removeEventListener("lostpointercapture", handlePointerEnd, true);
    window.removeEventListener("blur", handleWindowBlur);
    activePetPointers.clear();
    revision += 1;
    ipcRenderer.send("overlay:hit-regions", {
      revision,
      bubbleActive: false,
      interactiveActive: false,
      bubbleRegions: [],
      interactiveRegions: [],
    } satisfies OverlayInteractionReport);
  };

  const handlePointerDown = (event: PointerEvent): void => {
    if (!isPetPointer(event)) return;
    activePetPointers.add(event.pointerId);
    report(true);
  };

  const handlePointerEnd = (event: PointerEvent): void => {
    if (!activePetPointers.delete(event.pointerId)) return;
    report(true);
  };

  const handleWindowBlur = (): void => {
    if (activePetPointers.size === 0) return;
    activePetPointers.clear();
    report(true);
  };

  const start = (): void => {
    if (disposed) return;
    observer = new MutationObserver(scheduleReport);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style", "disabled"],
    });
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleReport);
      resizeObserver.observe(document.documentElement);
    }
    window.addEventListener("resize", scheduleReport);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointerup", handlePointerEnd, true);
    document.addEventListener("pointercancel", handlePointerEnd, true);
    document.addEventListener("lostpointercapture", handlePointerEnd, true);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("beforeunload", cleanup, { once: true });
    window.addEventListener("pagehide", cleanup, { once: true });
    report(true);
    const tick = (): void => {
      if (disposed) return;
      report();
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

contextBridge.exposeInMainWorld("xiaoman", {
  getSnapshot: (): Promise<AppSnapshot> => ipcRenderer.invoke("snapshot:get"),
  interact: (action: InteractionAction): Promise<AppSnapshot> => ipcRenderer.invoke("interaction:perform", action),
  feedFood: (foodId: FoodId): Promise<AppSnapshot> => ipcRenderer.invoke("care:feed-food", foodId),
  bathePet: (): Promise<AppSnapshot> => ipcRenderer.invoke("care:bathe-pet"),
  openGiftBox: (): Promise<AppSnapshot> => ipcRenderer.invoke("care:open-gift-box"),
  startPetJob: (jobId: JobId): Promise<AppSnapshot> => ipcRenderer.invoke("care:start-pet-job", jobId),
  collectPetJob: (): Promise<AppSnapshot> => ipcRenderer.invoke("care:collect-pet-job"),
  cancelPetJob: (): Promise<AppSnapshot> => ipcRenderer.invoke("care:cancel-pet-job"),
  claimDailyQuest: (questId: string): Promise<AppSnapshot> => ipcRenderer.invoke("care:claim-daily-quest", questId),
  setGameActive: (active: boolean): void => ipcRenderer.send("game:set-active", active),
  startGameSession: (): Promise<GameStartResult> => ipcRenderer.invoke("game:start"),
  completeGame: (gameId: GameId, score: number): Promise<AppSnapshot> => ipcRenderer.invoke("game:complete", gameId, score),
  startDesktopBubbleSession: (): Promise<AppSnapshot> => ipcRenderer.invoke("desktop-bubble:start"),
  hitDesktopBubble: (sessionId: string, bubbleId: string): Promise<AppSnapshot> =>
    ipcRenderer.invoke("desktop-bubble:hit", sessionId, bubbleId),
  stopDesktopBubbleSession: (sessionId: string, completed: boolean): Promise<AppSnapshot> =>
    ipcRenderer.invoke("desktop-bubble:stop", sessionId, completed),
  saveReminder: (input: ReminderInput): Promise<AppSnapshot> => ipcRenderer.invoke("reminder:save", input),
  removeReminder: (id: string): Promise<AppSnapshot> => ipcRenderer.invoke("reminder:remove", id),
  toggleReminder: (id: string): Promise<AppSnapshot> => ipcRenderer.invoke("reminder:toggle", id),
  saveRule: (input: AppRuleInput): Promise<AppSnapshot> => ipcRenderer.invoke("rule:save", input),
  removeRule: (id: string): Promise<AppSnapshot> => ipcRenderer.invoke("rule:remove", id),
  toggleRule: (id: string): Promise<AppSnapshot> => ipcRenderer.invoke("rule:toggle", id),
  updateSettings: (patch: Partial<CompanionSettings>): Promise<AppSnapshot> =>
    ipcRenderer.invoke("settings:update", patch),
  updateIdlePhrases: (phrases: string[]): Promise<AppSnapshot> => ipcRenderer.invoke("idle-phrases:update", phrases),
  testNotification: (): Promise<void> => ipcRenderer.invoke("notification:test"),
  clearActivity: (): Promise<AppSnapshot> => ipcRenderer.invoke("activity:clear"),
  listCodexThreads: (force = false): Promise<CodexThreadListResult> => ipcRenderer.invoke("codex:threads:list", force),
  openCodexThread: (threadId: string): Promise<CodexOpenResult> => ipcRenderer.invoke("codex:thread:open", threadId),
  replyCodexThread: (threadId: string, message: string): Promise<CodexReplyResult> =>
    ipcRenderer.invoke("codex:thread:reply", threadId, message),
  setOverlayTaskPanel: (open: boolean): void => ipcRenderer.send("overlay:task-panel", open),
  showCenter: (tab?: CenterTab): void => ipcRenderer.send("center:show", tab),
  showQuickWindow: (mode: QuickViewMode): void => ipcRenderer.send("quick:show", mode),
  toggleOverlay: (): void => ipcRenderer.send("overlay:toggle"),
  moveOverlayBy: (deltaX: number, deltaY: number): void => ipcRenderer.send("overlay:move-by", deltaX, deltaY),
  setOverlayMouseMode: (mode: "passthrough" | "interactive"): void => ipcRenderer.send("overlay:mouse-mode", mode),
  reportOverlayHitRegions: (report: OverlayInteractionReport): void => ipcRenderer.send("overlay:hit-regions", report),
  showOverlayMenu: (): void => ipcRenderer.send("overlay:context-menu"),
  onSnapshot: (callback: (snapshot: AppSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => callback(snapshot);
    ipcRenderer.on("snapshot:changed", listener);
    return () => ipcRenderer.removeListener("snapshot:changed", listener);
  },
  onCursor: (callback: (payload: CursorPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: CursorPayload) => callback(payload);
    ipcRenderer.on("cursor:changed", listener);
    return () => ipcRenderer.removeListener("cursor:changed", listener);
  },
  onSound: (callback: (sound: SoundName) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, sound: SoundName) => callback(sound);
    ipcRenderer.on("sound:play", listener);
    return () => ipcRenderer.removeListener("sound:play", listener);
  },
  onCenterTab: (callback: (tab: CenterTab) => void): (() => void) => {
    centerTabListeners.add(callback);
    if (pendingCenterTab !== null) {
      const tab = pendingCenterTab;
      pendingCenterTab = null;
      queueMicrotask(() => {
        if (centerTabListeners.has(callback)) callback(tab);
      });
    }
    return () => centerTabListeners.delete(callback);
  },
});

installOverlayHitRegionReporter();
