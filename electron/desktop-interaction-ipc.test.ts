import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockApiForTests } from "../src/bridge";
import type { DesktopInteractionStatus } from "../src/shared/types";
import { DESKTOP_SESSION_DURATION_MS } from "../src/shared/desktop-interaction";

vi.mock("electron", () => ({
  app: {
    commandLine: { appendSwitch: vi.fn() },
    setName: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    quit: vi.fn(),
    on: vi.fn(),
    whenReady: vi.fn(() => new Promise(() => undefined)),
  },
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: {},
  Notification: {},
  powerMonitor: { on: vi.fn(), getSystemIdleTime: vi.fn(() => 0) },
  screen: {},
  Tray: class {},
}));

import {
  createDesktopBubbleSessionState,
  createQuickLoadController,
  canCompleteGame,
  ensureQuickWindow,
  hitDesktopBubbleState,
  isTrustedSender,
  setOverlayMouseModeForWindow,
  startDesktopBubbleSessionState,
  stopDesktopBubbleSessionState,
  teardownQuickWindow,
  transitionGameActivity,
} from "./main";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("desktop interaction Electron boundary", () => {
  it("reuses one quick window while replacing its requested mode", () => {
    const firstWindow = { isDestroyed: () => false, show: vi.fn(), focus: vi.fn() };
    const createWindow = vi.fn(() => firstWindow);
    const loadMode = vi.fn();

    const careWindow = ensureQuickWindow(null, "care", createWindow, loadMode);
    const interactionWindow = ensureQuickWindow(careWindow, "interaction", createWindow, loadMode);

    expect(interactionWindow).toBe(firstWindow);
    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(loadMode).toHaveBeenNthCalledWith(1, firstWindow, "care");
    expect(loadMode).toHaveBeenNthCalledWith(2, firstWindow, "interaction");
  });

  it("rejects wrong-session and duplicate bubble hits while accepting a live hit", () => {
    const started = startDesktopBubbleSessionState(
      createDesktopBubbleSessionState(),
      1_000,
      true,
      false,
      () => "desktop-session-1",
    );

    expect(hitDesktopBubbleState(started, "other-session", "bubble-1", 1_001)).toMatchObject({ accepted: false });
    const firstHit = hitDesktopBubbleState(started, "desktop-session-1", "bubble-1", 1_001);
    expect(firstHit).toMatchObject({ accepted: true, state: { status: { score: 1 } } });
    expect(hitDesktopBubbleState(firstHit.state, "desktop-session-1", "bubble-1", 1_002)).toMatchObject({ accepted: false });
  });

  it("settles completion once, gives cancellation no reward, and expires without settlement", () => {
    const started = startDesktopBubbleSessionState(
      createDesktopBubbleSessionState(),
      2_000,
      true,
      false,
      () => "desktop-session-2",
    );
    const hit = hitDesktopBubbleState(started, "desktop-session-2", "bubble-1", 2_001).state;
    const completed = stopDesktopBubbleSessionState(hit, "desktop-session-2", true, 2_002);
    expect(completed.settlement).toMatchObject({ gameId: "bubble-pop", score: 1 });
    expect(stopDesktopBubbleSessionState(completed.state, "desktop-session-2", true, 2_003).settlement).toBeNull();

    const cancelled = stopDesktopBubbleSessionState(
      startDesktopBubbleSessionState(createDesktopBubbleSessionState(), 3_000, true, false, () => "desktop-session-3"),
      "desktop-session-3",
      false,
      3_001,
    );
    expect(cancelled.settlement).toBeNull();

    const expired = stopDesktopBubbleSessionState(
      startDesktopBubbleSessionState(createDesktopBubbleSessionState(), 4_000, true, false, () => "desktop-session-4"),
      "desktop-session-4",
      true,
      4_000 + DESKTOP_SESSION_DURATION_MS,
    );
    expect(expired.settlement).toBeNull();
    expect(expired.changed).toBe(true);
    expect(stopDesktopBubbleSessionState(expired.state, "desktop-session-4", true, 4_003)).toMatchObject({
      accepted: true,
      changed: false,
      settlement: null,
    });
  });

  it("accepts only trusted main-frame senders and applies explicit overlay mouse modes", () => {
    const mainFrame = {};
    const sender = { mainFrame };
    const window = { setIgnoreMouseEvents: vi.fn() };

    expect(isTrustedSender(sender, mainFrame, [sender])).toBe(true);
    expect(isTrustedSender(sender, {}, [sender])).toBe(false);
    expect(isTrustedSender(sender, mainFrame, [])).toBe(false);

    setOverlayMouseModeForWindow(window, "passthrough");
    setOverlayMouseModeForWindow(window, "interactive");
    expect(window.setIgnoreMouseEvents).toHaveBeenNthCalledWith(1, true, { forward: true });
    expect(window.setIgnoreMouseEvents).toHaveBeenNthCalledWith(2, false);
  });

  it("keeps regular game ownership separate from the desktop bubble session", () => {
    expect(transitionGameActivity(false, true, true, true)).toEqual({ accepted: false, active: false });
    expect(transitionGameActivity(true, true, false, true)).toEqual({ accepted: false, active: true });
    expect(canCompleteGame(true, true, true)).toBe(false);
    expect(canCompleteGame(true, true, false)).toBe(true);
  });

  it("returns a start rejection before a regular game can render during desktop interaction", async () => {
    vi.stubGlobal("window", { setTimeout, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const api = createMockApiForTests();
    const desktop = await api.startDesktopBubbleSession();

    await expect(api.startGameSession()).resolves.toEqual({
      accepted: false,
      message: "桌面泡泡互动正在进行",
    });

    await api.stopDesktopBubbleSession(desktop.desktopInteraction.sessionId!, false);
    await expect(api.startGameSession()).resolves.toEqual({ accepted: true });
    await expect(api.completeGame("bubble-pop", 0)).resolves.toBeTruthy();
  });

  it("serializes latest quick loads and contains navigation failures", async () => {
    const window = {};
    const calls: string[] = [];
    const load = vi.fn(async (_window: object, mode: "care" | "interaction") => {
      calls.push(mode);
    });
    const controller = createQuickLoadController(load, () => true);

    controller.enqueue(window, "care");
    controller.enqueue(window, "interaction");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(["interaction"]);

    const errors: unknown[] = [];
    const failing = vi.fn(async () => {
      throw new Error("navigation aborted");
    });
    const safeController = createQuickLoadController(failing, () => true, (error) => errors.push(error));
    safeController.enqueue(window, "care");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toHaveLength(1);
    safeController.enqueue(window, "interaction");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("waits for an in-flight navigation before applying the next mode", async () => {
    const window = {};
    const calls: string[] = [];
    let releaseFirst!: () => void;
    const load = vi.fn((_window: object, mode: "care" | "interaction") => {
      calls.push(mode);
      if (mode === "care") return new Promise<void>((resolve) => { releaseFirst = resolve; });
      return Promise.resolve();
    });
    const controller = createQuickLoadController(load, () => true);

    controller.enqueue(window, "care");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(["care"]);
    controller.enqueue(window, "interaction");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(["care"]);

    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(["care", "interaction"]);
  });

  it("destroys the exact quick window whose renderer went away", () => {
    const window = { isDestroyed: () => false, destroy: vi.fn() };
    expect(teardownQuickWindow(window, window)).toBeNull();
    expect(window.destroy).toHaveBeenCalledTimes(1);

    const otherWindow = { isDestroyed: () => false, destroy: vi.fn() };
    expect(teardownQuickWindow(otherWindow, window)).toBe(otherWindow);
    expect(otherWindow.destroy).not.toHaveBeenCalled();
  });
});

describe("browser mock desktop interaction boundary", () => {
  it("rejects desktop start during a regular game and releases regular ownership after completion", async () => {
    vi.stubGlobal("window", { setTimeout, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const api = createMockApiForTests();
    api.setGameActive(true);

    await expect(api.startDesktopBubbleSession()).rejects.toThrow("已有游戏正在进行");
    await expect(api.completeGame("bubble-pop", 4)).resolves.toMatchObject({
      desktopInteraction: { active: false },
    });

    const started = await api.startDesktopBubbleSession();
    expect(started.desktopInteraction.active).toBe(true);
    api.setGameActive(true);
    await expect(api.completeGame("bubble-pop", 4)).rejects.toThrow("桌面泡泡互动正在进行");
    await api.stopDesktopBubbleSession(started.desktopInteraction.sessionId!, false);
    await expect(api.completeGame("bubble-pop", 4)).rejects.toThrow("没有正在进行的游戏");
  });

  it("expires from the observable mock boundary and allows a fresh session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    vi.stubGlobal("window", { setTimeout, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const api = createMockApiForTests();
    const first = await api.startDesktopBubbleSession();
    const firstSessionId = first.desktopInteraction.sessionId!;

    vi.setSystemTime(10_000 + DESKTOP_SESSION_DURATION_MS);
    await expect(api.getSnapshot()).resolves.toMatchObject({
      desktopInteraction: { active: false, sessionId: null, score: 0 },
    });
    await expect(api.hitDesktopBubble(firstSessionId, "bubble-after-expiry")).rejects.toThrow("泡泡命中无效");

    vi.setSystemTime(10_001 + DESKTOP_SESSION_DURATION_MS);
    const second = await api.startDesktopBubbleSession();
    expect(second.desktopInteraction.active).toBe(true);
    expect(second.desktopInteraction.sessionId).not.toBe(firstSessionId);
    await api.stopDesktopBubbleSession(second.desktopInteraction.sessionId!, false);
  });

  it("clears the mock desktop session, hits, and game ownership when game mode is disabled", async () => {
    vi.stubGlobal("window", { setTimeout, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const api = createMockApiForTests();
    const started = await api.startDesktopBubbleSession();
    const sessionId = started.desktopInteraction.sessionId!;
    await api.hitDesktopBubble(sessionId, "bubble-1");

    const disabled = await api.updateSettings({ gameModeEnabled: false });
    expect(disabled.desktopInteraction).toEqual({ active: false, sessionId: null, startedAt: null, score: 0 });
    await expect(api.hitDesktopBubble(sessionId, "bubble-2")).rejects.toThrow("泡泡命中无效");
    await expect(api.stopDesktopBubbleSession(sessionId, true)).resolves.toMatchObject({
      desktopInteraction: { active: false, score: 0 },
    });

    await api.updateSettings({ gameModeEnabled: true });
    await expect(api.completeGame("bubble-pop", 4)).rejects.toThrow("没有正在进行的游戏");
    api.setGameActive(true);
    await expect(api.completeGame("bubble-pop", 4)).resolves.toBeTruthy();
  });
});
