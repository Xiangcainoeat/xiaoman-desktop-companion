import { describe, expect, it } from "vitest";
import { applyBath, applyFeed, completePetJob, grantCodexCompletionReward, openGiftBox, startPetJob } from "../src/shared/care";
import { createDefaultData, normalizePersistedData } from "../src/shared/domain";

describe("care operations", () => {
  it("feeds using the requested food effect and consumes one item", () => {
    const base = createDefaultData(100);
    const data = { ...base, inventory: { ...base.inventory, food: { ...base.inventory.food, milk: 1 } } };
    const result = applyFeed(data, "milk", 200);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.inventory.food.milk).toBe(0);
      expect(result.data.stats.fullness).toBe(88);
      expect(result.data.stats.energy).toBe(89);
      expect(result.data.stats.affection).toBe(44);
      expect(result.data.stats.meals).toBe(1);
    }
  });

  it("does not mutate or reward an empty food slot", () => {
    const data = createDefaultData();
    const before = JSON.stringify(data);
    const result = applyFeed(data, "salmon", 100);
    expect(result).toEqual({ ok: false, message: "三文鱼片吃完啦" });
    expect(JSON.stringify(data)).toBe(before);
  });

  it("bathing raises cleanliness and costs one energy", () => {
    const result = applyBath({ ...createDefaultData(), stats: { ...createDefaultData().stats, cleanliness: 70 } }, 100);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.stats).toMatchObject({ cleanliness: 100, energy: 83, affection: 44, interactions: 1 });
  });

  it("starts and completes a job with a fixed reward", () => {
    const started = startPetJob(createDefaultData(1000), "desk-organizer", 1000);
    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.data.stats.energy).toBe(80);
      const before = completePetJob(started.data, 1000 + 10 * 60_000 - 1);
      expect(before).toEqual({ ok: false, message: "打工还没完成" });
      const completed = completePetJob(started.data, 1000 + 10 * 60_000 + 1);
      expect(completed.ok).toBe(true);
      if (completed.ok) expect(completed.data.inventory.food["fish-snack"]).toBe(9);
    }
  });

  it("ignores an inflated persisted job reward and grants only the canonical reward", () => {
    const base = createDefaultData(1000);
    const normalized = normalizePersistedData({
      ...base,
      version: 3,
      activeJob: {
        id: "desk-organizer",
        startedAt: 1000,
        completesAt: 1001,
        reward: { food: { salmon: 9999 }, giftBoxes: 9999, experience: 999999 },
      },
    });

    const completed = completePetJob(normalized, 1002);
    expect(completed.ok).toBe(true);
    if (completed.ok) {
      expect(completed.data.inventory.food).toEqual({ "fish-snack": 9, milk: 0, "tuna-bites": 0, salmon: 0 });
      expect(completed.data.inventory.giftBoxes).toBe(1);
      expect(completed.data.stats.experience).toBe(8);
    }
  });

  it("opens gifts at deterministic weight boundaries", () => {
    const data = createDefaultData();
    for (const [random, food] of [[0, "fish-snack"], [0.45, "milk"], [0.75, "tuna-bites"], [0.95, "salmon"]] as const) {
      const cleanInventory = { food: { "fish-snack": 0, milk: 0, "tuna-bites": 0, salmon: 0 }, giftBoxes: 1 };
      const result = openGiftBox({ ...data, inventory: cleanInventory }, () => random);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.inventory.food[food]).toBe(1);
    }
  });

  it("makes Codex rewards idempotent and keeps only the newest 120 keys", () => {
    let data = createDefaultData();
    for (let i = 0; i < 121; i++) {
      const result = grantCodexCompletionReward(data, `key-${i}`, () => 0.99, i);
      expect(result.ok).toBe(true);
      if (result.ok) data = result.data;
    }
    expect(data.codexRewardLedger).toHaveLength(120);
    expect(data.codexRewardLedger[0]).toBe("key-1");
    const duplicate = grantCodexCompletionReward(data, "key-120", () => 0, 999);
    expect(duplicate).toEqual({ ok: true, data });
  });
});
