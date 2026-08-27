import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  createDefaultData,
  normalizeCompanionSettings,
  normalizePersistedData,
} from "./domain";

describe("hover jump count persistence", () => {
  it("defaults new data to one hover jump", () => {
    expect(DEFAULT_SETTINGS.hoverJumpCount).toBe(1);
    expect(createDefaultData().settings.hoverJumpCount).toBe(1);
  });

  it("rounds and clamps persisted counts to the inclusive 1..5 range", () => {
    const defaults = createDefaultData();

    expect(normalizeCompanionSettings({ ...defaults.settings, hoverJumpCount: 0 }).hoverJumpCount).toBe(1);
    expect(normalizeCompanionSettings({ ...defaults.settings, hoverJumpCount: 2.6 }).hoverJumpCount).toBe(3);
    expect(normalizeCompanionSettings({ ...defaults.settings, hoverJumpCount: 99 }).hoverJumpCount).toBe(5);
    expect(normalizeCompanionSettings({ ...defaults.settings, hoverJumpCount: "bad" }).hoverJumpCount).toBe(1);
    expect(normalizePersistedData({
      ...defaults,
      version: 1,
      settings: { ...defaults.settings, hoverJumpCount: 4 },
    }).settings.hoverJumpCount).toBe(4);
  });

  it("keeps the mouse-inactivity reset within the half-second to five-second range", () => {
    const defaults = createDefaultData();
    expect(normalizeCompanionSettings({ ...defaults.settings, gazeIdleResetMs: 0 }).gazeIdleResetMs).toBe(500);
    expect(normalizeCompanionSettings({ ...defaults.settings, gazeIdleResetMs: 2_650 }).gazeIdleResetMs).toBe(2_650);
    expect(normalizeCompanionSettings({ ...defaults.settings, gazeIdleResetMs: 99_000 }).gazeIdleResetMs).toBe(5_000);
    expect(normalizeCompanionSettings({ ...defaults.settings, gazeIdleResetMs: "slow" }).gazeIdleResetMs).toBe(
      defaults.settings.gazeIdleResetMs,
    );
  });
});
