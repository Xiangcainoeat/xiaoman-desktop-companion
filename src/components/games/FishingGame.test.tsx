import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FISHING_DURATION_MS,
  fishingScore,
  randomTargetPosition,
} from "./FishingGame";

describe("fishing game rules", () => {
  it("uses a twenty-second local session", () => {
    expect(FISHING_DURATION_MS).toBe(20_000);
  });

  it("keeps targets inside the playable stage", () => {
    const position = randomTargetPosition(() => 0);
    expect(position.left).toBeGreaterThanOrEqual(12);
    expect(position.top).toBeGreaterThanOrEqual(15);

    const farPosition = randomTargetPosition(() => 1);
    expect(farPosition.left).toBeLessThanOrEqual(88);
    expect(farPosition.top).toBeLessThanOrEqual(85);
  });

  it("turns hits into a bounded percentage score", () => {
    expect(fishingScore(0)).toBe(0);
    expect(fishingScore(3)).toBe(30);
    expect(fishingScore(11)).toBe(100);
    expect(fishingScore(-4)).toBe(0);
  });
});

describe("FishingGame source contract", () => {
  const source = readFileSync(new URL("./FishingGame.tsx", import.meta.url), "utf8");

  it("finishes through the session and cleans its timer", () => {
    expect(source).toContain("session.finish");
    expect(source).toContain("clearInterval");
    expect(source).toContain("stopPropagation");
    expect(source).toContain("aria-label");
    expect(source).toContain("./game/fish-target.png");
    expect(source).not.toContain("feedFood");
  });
});
