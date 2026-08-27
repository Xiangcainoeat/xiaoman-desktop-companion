import { describe, expect, it, vi } from "vitest";
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
  ensureQuickWindow,
  hitDesktopBubbleState,
  isTrustedSender,
  setOverlayMouseModeForWindow,
  startDesktopBubbleSessionState,
  stopDesktopBubbleSessionState,
} from "./main";

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
});
