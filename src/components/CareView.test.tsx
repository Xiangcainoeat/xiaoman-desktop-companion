import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FoodId } from "../shared/types";

const source = readFileSync(new URL("./CareView.tsx", import.meta.url), "utf8");

describe("CareView source contract", () => {
  it("presents the complete Chinese local-care surface", () => {
    for (const label of [
      "照顾小满",
      "等级",
      "经验",
      "清洁度",
      "饱食度",
      "精力",
      "好感度",
      "食物库存",
      "礼包",
      "洗澡",
      "打工",
      "每日任务",
      "领取奖励",
    ]) {
      expect(source).toContain(label);
    }
  });

  it("keeps zero-inventory food controls disabled", () => {
    expect(source).toContain("disabled={quantity <= 0}");
    expect(source).toContain("quantity <= 0 ? \"已用完\" : \"喂食\"");
    expect(source).toContain("const FOOD_LABELS: Record<FoodId, string>");
  });

  it("wires every care interaction to the typed bridge", () => {
    for (const method of [
      "bridge.feedFood(foodId)",
      "bridge.openGiftBox()",
      "bridge.bathePet()",
      "bridge.startPetJob(jobId)",
      "bridge.cancelPetJob()",
      "bridge.claimDailyQuest(quest.id)",
    ]) {
      expect(source).toContain(method);
    }
    expect(source).toContain("onClick={() => void runAction");
    expect(source).toContain("aria-live=\"polite\"");
    expect(source).not.toContain("setSnapshot");
    expect(source).not.toContain("inventory.food[foodId] - 1");
  });
});

describe("CareView contract types", () => {
  it("keeps food identifiers aligned with the shared bridge type", () => {
    const foodIds: FoodId[] = ["fish-snack", "milk", "tuna-bites", "salmon"];
    expect(foodIds).toHaveLength(4);
  });
});
