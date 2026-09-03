import { describe, expect, it } from "vitest";
import { ARTICLE_GAME_IDS } from "./registry";
import {
  MOBILE_GAME_CONTROLS,
  mobileProfileKeyCodes,
  resolveGameInputMode,
} from "./mobile-controls";

describe("mobile article-game controls", () => {
  it("defines a mobile presentation for every registered game", () => {
    expect(Object.keys(MOBILE_GAME_CONTROLS).sort()).toEqual([...ARTICLE_GAME_IDS].sort());
  });

  it("uses key codes understood by the shared game bridge", () => {
    for (const profile of Object.values(MOBILE_GAME_CONTROLS)) {
      expect(mobileProfileKeyCodes(profile).every((value) => Number.isInteger(value) && value > 0)).toBe(true);
    }
  });

  it("automatically selects mobile for narrow or coarse-pointer devices", () => {
    expect(resolveGameInputMode("auto", 390, false)).toBe("mobile");
    expect(resolveGameInputMode("auto", 1280, true)).toBe("mobile");
    expect(resolveGameInputMode("auto", 1280, false)).toBe("desktop");
    expect(resolveGameInputMode("desktop", 390, true)).toBe("desktop");
    expect(resolveGameInputMode("mobile", 1440, false)).toBe("mobile");
  });
});
