import { describe, expect, it } from "vitest";
import type { DesktopBubble, DesktopInteractionStatus } from "./types";
import {
  DESKTOP_BUBBLE_MAX_RADIUS,
  DESKTOP_BUBBLE_MAX_HITS,
  DESKTOP_BUBBLE_MIN_RADIUS,
  DESKTOP_SESSION_DURATION_MS,
  advanceDesktopBubble,
  canHitDesktopBubble,
  createDesktopBubble,
} from "./desktop-interaction";

const bounds = { width: 400, height: 300 };

describe("desktop bubble creation", () => {
  it("keeps a bubble fully inside the safe bounds for a deterministic random seed", () => {
    const bubble = createDesktopBubble("bubble-1", bounds, () => 0.99, 1_000);

    expect(bubble.radius).toBe(DESKTOP_BUBBLE_MAX_RADIUS);
    expect(bubble.x - bubble.radius).toBeGreaterThanOrEqual(0);
    expect(bubble.x + bubble.radius).toBeLessThanOrEqual(bounds.width);
    expect(bubble.y - bubble.radius).toBeGreaterThanOrEqual(0);
    expect(bubble.y + bubble.radius).toBeLessThanOrEqual(bounds.height);
    expect(bubble.bornAt).toBe(1_000);
    expect(bubble.expiresAt).toBe(1_000 + DESKTOP_SESSION_DURATION_MS);
  });

  it("uses the documented radius range and initial velocity range", () => {
    const bubble = createDesktopBubble("bubble-2", bounds, () => 0.5, 2_000);

    expect(bubble.radius).toBeGreaterThanOrEqual(DESKTOP_BUBBLE_MIN_RADIUS);
    expect(bubble.radius).toBeLessThanOrEqual(DESKTOP_BUBBLE_MAX_RADIUS);
    expect(Math.abs(bubble.vx)).toBeGreaterThan(0);
    expect(bubble.vy).toBeLessThan(0);
  });
});

describe("desktop bubble motion", () => {
  it("moves the same distance when one second is split into 30Hz or 60Hz steps", () => {
    const bubble = { ...createDesktopBubble("bubble-3", bounds, () => 0.25, 0), x: 200, y: 150, vx: 40, vy: 20 };
    const advanceSteps = (steps: number, elapsedMs: number): DesktopBubble | null => {
      let current: DesktopBubble | null = bubble;
      for (let step = 0; step < steps && current; step += 1) {
        current = advanceDesktopBubble(current, elapsedMs, bounds);
      }
      return current;
    };
    const at30Hz = advanceSteps(30, 1000 / 30);
    const at60Hz = advanceSteps(60, 1000 / 60);

    expect(at30Hz).not.toBeNull();
    expect(at60Hz).not.toBeNull();
    expect(at30Hz!.x).toBeCloseTo(at60Hz!.x, 5);
    expect(at30Hz!.y).toBeCloseTo(at60Hz!.y, 5);
  });

  it("reflects from the safe bounds and recycles an expired bubble", () => {
    const bubble = { ...createDesktopBubble("bubble-4", bounds, () => 0.5, 0), x: 340, y: 150, vx: 40, vy: 0, radius: 40 };

    expect(advanceDesktopBubble(bubble, 1_000, bounds)).toMatchObject({ x: 340, vx: -40 });
    expect(advanceDesktopBubble({ ...bubble, expiresAt: 10 }, 20, bounds)).toBeNull();
  });
});

describe("desktop bubble hit validation", () => {
  const activeStatus: DesktopInteractionStatus = { active: true, sessionId: "session-1", startedAt: 1_000, score: 3 };

  it("accepts a live, new hit and rejects inactive, wrong-session, expired, duplicate, and capped hits", () => {
    expect(canHitDesktopBubble(activeStatus, "session-1", "bubble-1", 1_001, new Set())).toBe(true);
    expect(canHitDesktopBubble({ ...activeStatus, active: false }, "session-1", "bubble-2", 1_001, new Set())).toBe(false);
    expect(canHitDesktopBubble(activeStatus, "session-2", "bubble-2", 1_001, new Set())).toBe(false);
    expect(canHitDesktopBubble(activeStatus, "session-1", "bubble-2", 1_000 + DESKTOP_SESSION_DURATION_MS, new Set())).toBe(false);
    expect(canHitDesktopBubble(activeStatus, "session-1", "bubble-1", 1_001, new Set(["bubble-1"]))).toBe(false);
    expect(canHitDesktopBubble({ ...activeStatus, score: DESKTOP_BUBBLE_MAX_HITS }, "session-1", "bubble-2", 1_001, new Set())).toBe(false);
  });
});
