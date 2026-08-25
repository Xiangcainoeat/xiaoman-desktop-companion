import { describe, expect, it } from "vitest";
import {
  interpolateLookDirection,
  resolveGazeSmoothingMs,
  resolveGazeTarget,
  shouldTrackCursor,
  smoothAngle,
} from "../src/shared/gaze";

describe("gaze geometry", () => {
  it("clamps lower targets to the horizon in upper-180 mode", () => {
    expect(resolveGazeTarget(135, "upper-180")).toBe(90);
    expect(resolveGazeTarget(180, "upper-180")).toBe(270);
    expect(resolveGazeTarget(225, "upper-180")).toBe(270);
    expect(resolveGazeTarget(45, "upper-180")).toBe(45);
    expect(resolveGazeTarget(180, "full-360")).toBe(180);
  });

  it("interpolates across the 0/360 seam without reversing", () => {
    expect(interpolateLookDirection(359, 16)).toMatchObject({ first: 15, second: 0 });
    expect(interpolateLookDirection(1, 16)).toMatchObject({ first: 0, second: 1 });
    expect(interpolateLookDirection(180, 16)).toEqual({ first: 8, second: 9, blend: 0 });
  });

  it("uses shortest-path delta-time smoothing", () => {
    const next = smoothAngle(350, 10, 100, 300);
    expect(next).toBeGreaterThan(350);
    expect(next).toBeLessThan(370);
    expect(smoothAngle(10, 350, 100, 300)).toBeLessThan(10);
  });

  it("lets lower tracking settle before the idle reset and returns promptly", () => {
    expect(resolveGazeSmoothingMs(900, 1400, "tracking")).toBe(900);
    expect(resolveGazeSmoothingMs(900, 1400, "lower-tracking")).toBe(400);
    expect(resolveGazeSmoothingMs(900, 1400, "returning")).toBe(360);
    expect(resolveGazeSmoothingMs(240, 1400, "lower-tracking")).toBe(240);
  });
});

describe("gaze activity", () => {
  it("uses hysteresis and stops after cursor inactivity", () => {
    const base = { now: 2_000, lastMovedAt: 1_000, idleResetMs: 1_400, deadzonePx: 54 };
    expect(shouldTrackCursor({ ...base, distance: 70, wasLooking: false })).toBe(true);
    expect(shouldTrackCursor({ ...base, distance: 58, wasLooking: true })).toBe(true);
    expect(shouldTrackCursor({ ...base, distance: 50, wasLooking: true })).toBe(false);
    expect(shouldTrackCursor({ ...base, now: 2_500, distance: 100, wasLooking: true })).toBe(false);
  });
});
