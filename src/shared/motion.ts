import type { CompanionSettings, PetMotion } from "./types";

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
