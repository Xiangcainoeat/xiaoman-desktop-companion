import type { CompanionSettings, PetMotion } from "./types";

export const HOVER_JUMP_COUNT_MIN = 1;
export const HOVER_JUMP_COUNT_MAX = 5;
export const DEFAULT_HOVER_JUMP_COUNT = 1;
export const HOVER_JUMP_CYCLE_DURATION_MS = 900;

export interface DragState {
  active: boolean;
  moved: boolean;
  x: number;
  y: number;
  horizontal: number;
  pointerId: number | null;
}

export function isPrimaryDragPointer(event: {
  button: number;
  ctrlKey: boolean;
  isPrimary?: boolean;
}): boolean {
  return event.button === 0 && !event.ctrlKey && event.isPrimary !== false;
}

export function resetDragState(_state: DragState): DragState {
  return {
    active: false,
    moved: false,
    x: 0,
    y: 0,
    horizontal: 0,
    pointerId: null,
  };
}

export function releaseDragState(state: DragState): DragState {
  return {
    ...state,
    active: false,
    x: 0,
    y: 0,
    horizontal: 0,
    pointerId: null,
  };
}

export function normalizeHoverJumpCount(
  value: unknown,
  fallback = DEFAULT_HOVER_JUMP_COUNT,
): number {
  const candidate = typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : fallback;
  return Math.max(HOVER_JUMP_COUNT_MIN, Math.min(HOVER_JUMP_COUNT_MAX, candidate));
}

export function hoverJumpDurationMs(count: unknown): number {
  return normalizeHoverJumpCount(count) * HOVER_JUMP_CYCLE_DURATION_MS;
}

export function resolveDragMotion(deltaX: number, thresholdPx = 4): PetMotion | null {
  if (deltaX >= thresholdPx) return "running-right";
  if (deltaX <= -thresholdPx) return "running-left";
  return null;
}

export function chooseIdleMotion(settings: CompanionSettings, randomValue = Math.random()): PetMotion | null {
  if (!settings.idleActionsEnabled) return null;
  const enabled: PetMotion[] = [];
  if (settings.idleLickEnabled) enabled.push("idle-lick");
  if (settings.idleBlinkEnabled) enabled.push("idle-blink");
  if (settings.idleScratchEnabled) enabled.push("idle-scratch");
  if (enabled.length === 0) return null;
  const normalized = Math.max(0, Math.min(0.999999, randomValue));
  return enabled[Math.floor(normalized * enabled.length)];
}

export function randomizedDelayMs(baseSeconds: number, randomValue = Math.random()): number {
  const normalized = Math.max(0, Math.min(1, randomValue));
  const factor = 0.7 + normalized * 0.6;
  return Math.round(Math.max(1, baseSeconds) * 1000 * factor);
}
