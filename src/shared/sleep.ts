import type { SleepReason } from "./types";

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
