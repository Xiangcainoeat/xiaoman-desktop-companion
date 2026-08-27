import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GAME_DEFINITIONS } from "./GamesView";

describe("game launcher", () => {
  it("registers all three local games", () => {
    expect(GAME_DEFINITIONS.map((definition) => definition.id)).toEqual([
      "rock-paper-scissors",
      "fish-catch",
      "bubble-pop",
    ]);
  });
});

describe("GamesView source contract", () => {
  const source = readFileSync(new URL("./GamesView.tsx", import.meta.url), "utf8");

  it("honors the parent switch and isolates game input", () => {
    expect(source).toContain("enabled");
    expect(source).toContain("游戏模式已关闭");
    expect(source).toContain("GameShell");
    expect(source).toContain("onPointerDown");
    expect(source).toContain("stopPropagation");
    expect(source).not.toContain("bridge.feedFood");
    expect(source).not.toContain("bridge.updateSettings");
  });

  it("claims game ownership before entering a game and blocks desktop bubble conflicts", () => {
    expect(source).toContain("startGameSession");
    expect(source).toContain("desktopInteractionActive");
    expect(source).toContain("startingId");
    expect(source).toContain("setSelectedId");
  });
});
