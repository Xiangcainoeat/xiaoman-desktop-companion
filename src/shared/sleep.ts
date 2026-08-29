import type { InteractionAction, SleepReason } from "./types";

export const SLEEPING_NOTICE = "小满睡着了";

export interface AutoSleepInput {
  enabled: boolean;
  idleSeconds: number;
  afterMinutes: number;
  codexBusy: boolean;
  reminderActive: boolean;
  jobActive: boolean;
  gameActive: boolean;
  sleeping: boolean;
  manualSleep: boolean;
}

export interface AutoWakeInput {
  sleepReason: SleepReason;
  hasUserActivity: boolean;
  explicitWake: boolean;
}

export function shouldAutoSleep(input: AutoSleepInput): boolean {
  return input.enabled && !input.sleeping && !input.manualSleep && input.idleSeconds >= input.afterMinutes * 60
    && !input.codexBusy && !input.reminderActive && !input.jobActive && !input.gameActive;
}

export function shouldAutoWake(input: AutoWakeInput): boolean {
  return input.explicitWake || (input.sleepReason === "inactivity" && input.hasUserActivity);
}

/** Manual sleep is a modal pet state: only the explicit sleep toggle remains available. */
export function isSleepAllowedInteraction(action: InteractionAction): boolean {
  return action === "sleep" || action === "wake";
}

export function canOpenAuxiliaryPanel(sleeping: boolean): boolean {
  return !sleeping;
}
