import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./SpritePlayer.tsx", import.meta.url), "utf8");

describe("SpritePlayer renderer contract", () => {
  it("renders one current sprite and advances with rAF elapsed time", () => {
    expect(source).toContain("requestAnimationFrame");
    expect(source).toContain("advanceFrameByDelta");
    expect(source).toContain("backgroundPosition");
    expect(source).toContain("<div");
    expect(source).not.toContain("map(");
  });

  it("supports pausing and one-shot completion without repeating the callback", () => {
    expect(source).toContain("paused");
    expect(source).toContain("onComplete");
    expect(source).toContain("onLoop");
    expect(source).toContain("completedRef");
  });
});
