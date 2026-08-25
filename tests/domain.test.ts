import { describe, expect, it } from "vitest";
import {
  STANDARD_ATLAS_FRAME_COUNTS,
  createDefaultData,
  decayStats,
  deriveAmbientState,
  isReminderDue,
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
