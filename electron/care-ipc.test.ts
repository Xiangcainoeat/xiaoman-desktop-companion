import { describe, expect, it, vi } from "vitest";

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
import { createDefaultData } from "../src/shared/domain";
import {
  applyCareMutation,
  applyCodexCompletionReward,
  canCompleteGame,
  settleDuePetJob,
  shouldAutoSleepForRuntime,
} from "./main";

describe("care IPC integration boundary", () => {
  it("returns an explicit failure and leaves inventory unchanged when food is depleted", () => {
    const data = createDefaultData(100);
    const result = applyCareMutation({
      data: { ...data, inventory: { ...data.inventory, food: { ...data.inventory.food, "fish-snack": 0 } } },
      operation: { kind: "feed", foodId: "fish-snack" },
      now: 100,
    });

    expect(result).toEqual({ ok: false, message: "小鱼干吃完啦" });
  });

  it("uses the pure bath operation at the IPC boundary", () => {
    const result = applyCareMutation({ data: createDefaultData(100), operation: { kind: "bath" }, now: 200 });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.data.stats).toMatchObject({ cleanliness: 100, affection: 44, energy: 83 });
  });

  it("settles a started job only after its due time", () => {
    const started = applyCareMutation({ data: createDefaultData(1000), operation: { kind: "start-job", jobId: "desk-organizer" }, now: 1000 });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    expect(settleDuePetJob(started.data, 1000 + 10 * 60_000 - 1)).toEqual({ ok: false, message: "打工还没完成" });
    const completed = settleDuePetJob(started.data, 1000 + 10 * 60_000 + 1);
    expect(completed.ok).toBe(true);
    if (completed.ok) expect(completed.data.inventory.food["fish-snack"]).toBe(9);
  });

  it("applies code-helper's 12 percent gift chance at completion", () => {
    const started = applyCareMutation({ data: createDefaultData(1000), operation: { kind: "start-job", jobId: "code-helper" }, now: 1000 });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const completed = settleDuePetJob(started.data, 1000 + 25 * 60_000, () => 0.1199);
    expect(completed.ok).toBe(true);
    if (completed.ok) expect(completed.data.inventory.giftBoxes).toBe(2);
  });

  it("claims a completed quest through the pure care operation", () => {
    const data = createDefaultData(100);
    const quest = data.dailyQuests[0];
    const ready = {
      ...data,
      dailyQuests: data.dailyQuests.map((item) => item.id === quest.id ? { ...item, progress: item.target } : item),
    };
    const result = applyCareMutation({ data: ready, operation: { kind: "claim-quest", questId: quest.id }, now: 300 });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.dailyQuests[0].claimed).toBe(true);
  });

  it("clamps game scores before applying the game reward", () => {
    const result = applyCareMutation({ data: createDefaultData(100), operation: { kind: "complete-game", gameId: "bubble-pop", score: 9999 }, now: 400 });

    expect(result).toMatchObject({ ok: true, settlement: { score: 100 } });
    if (result.ok) expect(result.data.stats).toMatchObject({ affection: 47, experience: 12 });
  });

  it("blocks auto sleep while either a game or Codex task is active", () => {
    const input = { enabled: true, idleSeconds: 900, afterMinutes: 15, codexBusy: false, reminderActive: false, jobActive: false, sleeping: false, manualSleep: false };
    expect(shouldAutoSleepForRuntime({ ...input, gameActive: true })).toBe(false);
    expect(shouldAutoSleepForRuntime({ ...input, gameActive: false, codexBusy: true })).toBe(false);
  });

  it("only accepts a game settlement from an active enabled session", () => {
    expect(canCompleteGame(false, true)).toBe(false);
    expect(canCompleteGame(true, false)).toBe(false);
    expect(canCompleteGame(true, true)).toBe(true);
  });

  it("grants one completion reward for duplicate non-recovered monitor events", () => {
    const data = createDefaultData(100);
    const event = { kind: "completed" as const, threadId: "thread-1", turnId: "turn-1", at: 500, durationMs: 10 };
    const first = applyCodexCompletionReward(data, event, () => 0.99);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyCodexCompletionReward(first.data, event, () => 0);
    expect(second).toEqual({ ok: true, data: first.data });
    expect(first.data.inventory.food["fish-snack"]).toBe(9);
  });
});
