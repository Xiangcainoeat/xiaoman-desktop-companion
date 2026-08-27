import { describe, expect, it } from "vitest";
import {
  STANDARD_ATLAS_FRAME_COUNTS,
  createDefaultData,
  decayStats,
  deriveAmbientState,
  isReminderDue,
  normalizeIdlePhrases,
  normalizePersistedData,
} from "../src/shared/domain";
import type { Reminder } from "../src/shared/types";

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "test",
    title: "喝水",
    message: "起来活动一下",
    time: "15:30",
    repeat: "daily",
    date: null,
    days: [],
    enabled: true,
    sound: "chime",
    lastTriggeredKey: null,
    ...overrides,
  };
}

describe("pet stat decay", () => {
  it("decays fullness and energy while awake", () => {
    const data = createDefaultData(0);
    const next = decayStats(data.stats, false, 60 * 60_000);
    expect(next.fullness).toBeLessThan(data.stats.fullness);
    expect(next.energy).toBeLessThan(data.stats.energy);
    expect(next.lastUpdatedAt).toBe(60 * 60_000);
  });

  it("restores energy while sleeping", () => {
    const data = createDefaultData(0);
    const next = decayStats({ ...data.stats, energy: 20 }, true, 70 * 60_000);
    expect(next.energy).toBe(30);
  });
});

describe("ambient state priority", () => {
  const stats = createDefaultData().stats;

  it("keeps Codex work above pet needs and app state", () => {
    expect(deriveAmbientState({ ...stats, fullness: 5 }, false, true, "happy")).toBe("working");
  });

  it("surfaces sleeping and hunger before app state", () => {
    expect(deriveAmbientState(stats, true, false, "focused")).toBe("sleeping");
    expect(deriveAmbientState({ ...stats, fullness: 20 }, false, false, "focused")).toBe("hungry");
  });
});

describe("standard sprite atlas", () => {
  it("stops each animation before transparent tail cells", () => {
    expect(STANDARD_ATLAS_FRAME_COUNTS).toEqual([7, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]);
    expect(STANDARD_ATLAS_FRAME_COUNTS.every((count) => count >= 4 && count <= 8)).toBe(true);
  });
});

describe("version 2 persistence migration", () => {
  it("defaults animation playback to 30 Hz for new and legacy data", () => {
    const defaults = createDefaultData();
    expect(defaults.settings.animationFrameRate).toBe(30);

    const legacySettings = { ...defaults.settings } as Record<string, unknown>;
    delete legacySettings.animationFrameRate;
    const migrated = normalizePersistedData({
      ...defaults,
      version: 1,
      settings: legacySettings,
    });
    expect(migrated.settings.animationFrameRate).toBe(30);
  });

  it("keeps 60 Hz and rejects unsupported animation playback rates", () => {
    const data = createDefaultData();
    expect(normalizePersistedData({
      ...data,
      settings: { ...data.settings, animationFrameRate: 60 },
    }).settings.animationFrameRate).toBe(60);
    expect(normalizePersistedData({
      ...data,
      settings: { ...data.settings, animationFrameRate: 24 },
    }).settings.animationFrameRate).toBe(30);
  });

  it("preserves version 1 values and adds new defaults", () => {
    const old = createDefaultData(100);
    const migrated = normalizePersistedData({
      ...old,
      version: 1,
      stats: { ...old.stats, affection: 88 },
      settings: { ...old.settings, gazeEnabled: false } as typeof old.settings,
      idlePhrases: undefined,
    });
    expect(migrated.version).toBe(3);
    expect(migrated.stats.affection).toBe(88);
    expect(migrated.settings.gazeEnabled).toBe(false);
    expect(migrated.settings.gazeRange).toBe("full-360");
    expect(migrated.idlePhrases.length).toBeGreaterThan(0);
  });

  it("sanitizes, deduplicates, and bounds idle phrases", () => {
    expect(normalizeIdlePhrases(["  hello  ", "hello", "", 42, "x".repeat(120)])).toEqual([
      "hello",
      "x".repeat(80),
    ]);
  });

  it("preserves an intentionally empty idle phrase list", () => {
    expect(normalizeIdlePhrases([])).toEqual([]);
    expect(normalizePersistedData({ ...createDefaultData(), idlePhrases: [] }).idlePhrases).toEqual([]);
  });

  it("normalizes malformed nested values instead of trusting JSON shape", () => {
    const normalized = normalizePersistedData({
      ...createDefaultData(),
      settings: { petSize: "bad", gazeFrameRate: 0, volume: 9 },
      stats: { fullness: 999 },
      reminders: [null],
      appRules: [null],
      idlePhrases: [],
    });
    expect(normalized.settings.petSize).toBe(240);
    expect(normalized.settings.gazeFrameRate).toBe(60);
    expect(normalized.settings.volume).toBe(1);
    expect(normalized.stats.fullness).toBe(100);
    expect(normalized.reminders).toEqual([]);
    expect(normalized.appRules).toEqual([]);
  });

  it("accepts v2 data and adds the v3 care defaults", () => {
    const migrated = normalizePersistedData({
      ...createDefaultData(100),
      version: 2,
      stats: { ...createDefaultData(100).stats, fullness: 61 },
    });
    expect(migrated.version).toBe(3);
    expect(migrated.stats.fullness).toBe(61);
    expect(migrated.stats.cleanliness).toBe(78);
    expect(migrated.stats.experience).toBe(0);
    expect(migrated.stats.level).toBe(1);
    expect(migrated.inventory.food["fish-snack"]).toBe(8);
    expect(migrated.inventory.giftBoxes).toBe(1);
    expect(migrated.activeJob).toBeNull();
    expect(migrated.sleepReason).toBeNull();
    expect(migrated.codexRewardLedger).toEqual([]);
    expect(migrated.dailyQuests).toHaveLength(5);
  });

  it("accepts v3 data and normalizes malformed care fields", () => {
    const normalized = normalizePersistedData({
      ...createDefaultData(),
      version: 3,
      stats: { ...createDefaultData().stats, cleanliness: 999, experience: "bad", level: -2 },
      inventory: { food: { "fish-snack": 100000, milk: "bad" }, giftBoxes: -4 },
      dailyQuests: "bad",
      codexRewardLedger: ["a", 2, "a"],
    });
    expect(normalized.stats.cleanliness).toBe(100);
    expect(normalized.stats.experience).toBe(0);
    expect(normalized.stats.level).toBe(1);
    expect(normalized.inventory.food["fish-snack"]).toBe(9999);
    expect(normalized.inventory.food.milk).toBe(0);
    expect(normalized.inventory.giftBoxes).toBe(0);
    expect(normalized.dailyQuests).toHaveLength(5);
    expect(normalized.codexRewardLedger).toEqual(["a"]);
  });

  it("rejects versions newer than v3", () => {
    expect(() => normalizePersistedData({ version: 4 })).toThrow("Unsupported companion data version");
  });
});

describe("reminder schedule", () => {
  const monday = new Date(2026, 7, 24, 15, 30, 18);

  it("fires once per matching minute", () => {
    const first = isReminderDue(reminder(), monday);
    expect(first.due).toBe(true);
    expect(isReminderDue(reminder({ lastTriggeredKey: first.key }), monday).due).toBe(false);
  });

  it("supports weekday, weekly, and one-time schedules", () => {
    expect(isReminderDue(reminder({ repeat: "weekdays" }), monday).due).toBe(true);
    expect(isReminderDue(reminder({ repeat: "weekly", days: [1] }), monday).due).toBe(true);
    expect(isReminderDue(reminder({ repeat: "weekly", days: [2] }), monday).due).toBe(false);
    expect(isReminderDue(reminder({ repeat: "once", date: "2026-08-24" }), monday).due).toBe(true);
  });
});
