import type { GazeRange } from "./types";

export interface LookInterpolation {
  first: number;
  second: number;
  blend: number;
}

export interface CursorTrackingInput {
  now: number;
  lastMovedAt: number;
  idleResetMs: number;
  distance: number;
  deadzonePx: number;
  wasLooking: boolean;
}

export type GazeSmoothingPhase = "tracking" | "lower-tracking" | "returning";

export function normalizeAngle(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function shortestAngleDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

export function resolveGazeTarget(angle: number, range: GazeRange): number {
  const normalized = normalizeAngle(angle);
  if (range === "full-360") return normalized;
  if (normalized > 90 && normalized < 180) return 90;
  if (normalized >= 180 && normalized < 270) return 270;
  return normalized;
}

export function interpolateLookDirection(angle: number, directionCount = 16): LookInterpolation {
  if (!Number.isInteger(directionCount) || directionCount <= 0) {
    throw new RangeError("Look direction count must be a positive integer");
  }
  const step = 360 / directionCount;
  const position = normalizeAngle(angle) / step;
  const first = Math.floor(position) % directionCount;
  const blend = position - Math.floor(position);
  return { first, second: (first + 1) % directionCount, blend };
}

export function selectLookDirection(
  angle: number,
  directionCount = 16,
  previousIndex?: number,
  hysteresisDegrees = 0,
): number {
  if (!Number.isInteger(directionCount) || directionCount <= 0) {
    throw new RangeError("Look direction count must be a positive integer");
  }
  if (!Number.isFinite(hysteresisDegrees) || hysteresisDegrees < 0) {
    throw new RangeError("Look direction hysteresis must be a non-negative number");
  }

  const step = 360 / directionCount;
  const normalized = normalizeAngle(angle);
  if (
    previousIndex !== undefined
    && Number.isInteger(previousIndex)
    && previousIndex >= 0
    && previousIndex < directionCount
  ) {
    const previousAngle = previousIndex * step;
    if (Math.abs(shortestAngleDelta(previousAngle, normalized)) <= step / 2 + hysteresisDegrees) {
      return previousIndex;
    }
  }

  return Math.round(normalized / step) % directionCount;
}

export function smoothAngle(current: number, target: number, elapsedMs: number, smoothingMs: number): number {
  const elapsed = Math.max(0, elapsedMs);
  const timeConstant = Math.max(1, smoothingMs);
  const alpha = 1 - Math.exp(-elapsed / timeConstant);
  return current + shortestAngleDelta(current, target) * alpha;
}

export function resolveGazeSmoothingMs(
  configuredMs: number,
  idleResetMs: number,
  phase: GazeSmoothingPhase,
): number {
  const configured = Math.max(1, configuredMs);
  if (phase === "lower-tracking") return Math.min(configured, Math.max(1, idleResetMs) / 3.5);
  if (phase === "returning") return Math.min(configured, 360);
  return configured;
}

export function shouldTrackCursor(input: CursorTrackingInput): boolean {
  if (input.lastMovedAt <= 0 || input.now - input.lastMovedAt >= input.idleResetMs) return false;
  const threshold = input.deadzonePx + (input.wasLooking ? 0 : 12);
  return input.distance > threshold;
}
