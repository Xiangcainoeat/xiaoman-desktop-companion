import { describe, expect, it } from "vitest";
import {
  canOpenAuxiliaryPanel,
  isSleepAllowedInteraction,
  shouldAutoSleep,
  shouldAutoWake,
} from "../src/shared/sleep";

describe("sleep predicates", () => {
  const base = { enabled: true, idleSeconds: 900, afterMinutes: 15, codexBusy: false, reminderActive: false, jobActive: false, gameActive: false, sleeping: false, manualSleep: false };

  it("sleeps only after the configured idle threshold without blockers", () => {
    expect(shouldAutoSleep(base)).toBe(true);
    expect(shouldAutoSleep({ ...base, idleSeconds: 899 })).toBe(false);
    expect(shouldAutoSleep({ ...base, codexBusy: true })).toBe(false);
    expect(shouldAutoSleep({ ...base, manualSleep: true })).toBe(false);
  });

  it("wakes inactivity sleep on activity but preserves manual sleep", () => {
    expect(shouldAutoWake({ sleepReason: "inactivity", hasUserActivity: true, explicitWake: false })).toBe(true);
    expect(shouldAutoWake({ sleepReason: "manual", hasUserActivity: true, explicitWake: false })).toBe(false);
    expect(shouldAutoWake({ sleepReason: "manual", hasUserActivity: false, explicitWake: true })).toBe(true);
  });

  it("allows only sleep and wake controls while manually sleeping", () => {
    expect(isSleepAllowedInteraction("sleep")).toBe(true);
    expect(isSleepAllowedInteraction("wake")).toBe(true);
    expect(isSleepAllowedInteraction("feed")).toBe(false);
    expect(isSleepAllowedInteraction("pet")).toBe(false);
    expect(isSleepAllowedInteraction("play")).toBe(false);
    expect(isSleepAllowedInteraction("celebrate")).toBe(false);
  });

  it("closes the auxiliary panel request while sleeping", () => {
    expect(canOpenAuxiliaryPanel(false)).toBe(true);
    expect(canOpenAuxiliaryPanel(true)).toBe(false);
  });
});
