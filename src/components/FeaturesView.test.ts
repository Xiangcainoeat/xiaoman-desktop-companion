import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "FeaturesView.tsx"), "utf8");

describe("FeaturesView ownership contract", () => {
  it("keeps pet behavior controls together", () => {
    for (const label of ["桌宠功能", "注视跟随", "移动与悬停", "待机动作", "生活节奏", "待机词条", "动作预览"]) {
      expect(source).toContain(label);
    }
  });

  it("exposes the requested gaze and inactivity controls", () => {
    expect(source).toContain("gazeRange");
    expect(source).toContain("上半区 180°");
    expect(source).toContain("全向 360°");
    expect(source).toContain('label="鼠标静止多久停止跟随"');
    expect(source).toContain("gazeFrameRate");
  });

  it("keeps feed, jobs, gifts, and quest actions out of the feature form", () => {
    expect(source).not.toContain("feedFood");
    expect(source).not.toContain("startPetJob");
    expect(source).not.toContain("openGiftBox");
    expect(source).not.toContain("claimDailyQuest");
  });
});
