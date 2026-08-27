import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUBBLE_COUNT,
  BUBBLE_DURATION_MS,
  bubbleScore,
  createBubble,
} from "./BubbleGame";

describe("bubble game rules", () => {
  it("uses five targets and a twenty-second session", () => {
    expect(BUBBLE_COUNT).toBe(5);
    expect(BUBBLE_DURATION_MS).toBe(20_000);
  });

  it("creates bounded, positively scored targets", () => {
    const bubble = createBubble(7, () => 0);
    expect(bubble.id).toBe(7);
    expect(bubble.left).toBeGreaterThanOrEqual(8);
    expect(bubble.top).toBeGreaterThanOrEqual(10);
    expect(bubble.points).toBeGreaterThan(0);

    expect(bubbleScore(0)).toBe(0);
    expect(bubbleScore(20)).toBe(100);
    expect(bubbleScore(-2)).toBe(0);
  });
});

describe("BubbleGame source contract", () => {
  const source = readFileSync(new URL("./BubbleGame.tsx", import.meta.url), "utf8");

  it("keeps input local and settles exactly through the shell", () => {
    expect(source).toContain("session.finish");
    expect(source).toContain("clearInterval");
    expect(source).toContain("stopPropagation");
    expect(source).toContain("aria-label");
    expect(source).toContain("./game/bubble-target.png");
    expect(source).not.toContain("openGiftBox");
  });
});
