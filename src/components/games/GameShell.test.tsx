import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createGameLifecycle, normalizeGameScore } from "../GameShell";
import type { AppSnapshot, GameId } from "../../shared/types";

function fakeBridge() {
  return {
    setGameActive: vi.fn(),
    completeGame: vi.fn<(gameId: GameId, score: number) => Promise<AppSnapshot>>().mockResolvedValue({} as AppSnapshot),
  };
}

describe("game lifecycle", () => {
  it("normalizes renderer scores before they reach the bridge", () => {
    expect(normalizeGameScore(-1)).toBe(0);
    expect(normalizeGameScore(42.6)).toBe(43);
    expect(normalizeGameScore(101)).toBe(100);
    expect(normalizeGameScore(Number.NaN)).toBe(0);
  });

  it("activates once and releases once during cleanup", () => {
    const api = fakeBridge();
    const lifecycle = createGameLifecycle("fish-catch", api);

    lifecycle.start();
    lifecycle.start();
    lifecycle.dispose();
    lifecycle.dispose();

    expect(api.setGameActive.mock.calls).toEqual([[true], [false]]);
    expect(api.completeGame).not.toHaveBeenCalled();
  });

  it("submits a successful result once and always releases the game", async () => {
    const api = fakeBridge();
    const lifecycle = createGameLifecycle("bubble-pop", api);
    lifecycle.start();

    await expect(lifecycle.finish(72.4)).resolves.toBe(true);
    await expect(lifecycle.finish(11)).resolves.toBe(false);
    lifecycle.dispose();

    expect(api.completeGame).toHaveBeenCalledTimes(1);
    expect(api.completeGame).toHaveBeenCalledWith("bubble-pop", 72);
    expect(api.setGameActive.mock.calls).toEqual([[true], [false]]);
  });

  it("does not submit a result after cancellation", async () => {
    const api = fakeBridge();
    const lifecycle = createGameLifecycle("rock-paper-scissors", api);
    lifecycle.start();
    lifecycle.cancel();

    await expect(lifecycle.finish(100)).resolves.toBe(false);
    expect(api.completeGame).not.toHaveBeenCalled();
    expect(api.setGameActive.mock.calls).toEqual([[true], [false]]);
  });

  it("leaves the global game flag untouched when a disabled session never starts", () => {
    const api = fakeBridge();
    const lifecycle = createGameLifecycle("fish-catch", api);

    lifecycle.dispose();

    expect(api.setGameActive).not.toHaveBeenCalled();
    expect(api.completeGame).not.toHaveBeenCalled();
  });

  it("releases the active flag even when settlement rejects", async () => {
    const api = fakeBridge();
    api.completeGame.mockRejectedValueOnce(new Error("游戏模式已关闭"));
    const lifecycle = createGameLifecycle("fish-catch", api);
    lifecycle.start();

    await expect(lifecycle.finish(50)).rejects.toThrow("游戏模式已关闭");
    expect(api.completeGame).toHaveBeenCalledTimes(1);
    expect(api.setGameActive.mock.calls).toEqual([[true], [false]]);
  });
});

describe("GameShell source contract", () => {
  const source = readFileSync(new URL("../GameShell.tsx", import.meta.url), "utf8");

  it("owns activation, cleanup, completion, and pointer isolation", () => {
    expect(source).toContain("setGameActive(true)");
    expect(source).toContain("setGameActive(false)");
    expect(source).toContain("completeGame(gameId");
    expect(source).toContain("onPointerDown");
    expect(source).toContain("onMouseDown");
  });
});
