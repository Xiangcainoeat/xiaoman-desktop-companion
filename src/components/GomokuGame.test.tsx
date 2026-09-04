import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./GomokuGame.tsx", import.meta.url), "utf8");

describe("native Gomoku workspace", () => {
  it("keeps the board and game controls accessible", () => {
    for (const label of ["五子棋棋盘", "人机对战", "本机双人", "提示", "悔棋", "玩法与快捷键"]) {
      expect(source).toContain(label);
    }
    expect(source).toContain('role="grid"');
    expect(source).toContain('role="gridcell"');
    expect(source).toContain("GOMOKU_SIZE");
  });

  it("supports the same basic desktop controls as the game shell", () => {
    expect(source).toContain('event.key.toLowerCase() === "p"');
    expect(source).toContain('event.key.toLowerCase() === "r"');
    expect(source).toContain('event.key.toLowerCase() === "h"');
    expect(source).toContain("onToggleMute");
    expect(source).toContain("onTogglePause");
  });
});
