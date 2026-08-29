import { describe, expect, it } from "vitest";
import { chooseIdleMotion, randomizedDelayMs, resolveDragMotion } from "../src/shared/motion";
import { DEFAULT_SETTINGS } from "../src/shared/domain";

describe("native-style transient motion", () => {
  it("uses the native four-pixel horizontal drag threshold", () => {
    expect(resolveDragMotion(3.99)).toBeNull();
    expect(resolveDragMotion(4)).toBe("running-right");
    expect(resolveDragMotion(-4)).toBe("running-left");
    expect(resolveDragMotion(0)).toBeNull();
  });

  it("selects only enabled idle actions", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      idleLickEnabled: false,
      idleBlinkEnabled: true,
      idleScratchEnabled: false,
    };
    expect(chooseIdleMotion(settings, 0)).toBe("idle-blink");
    expect(chooseIdleMotion({ ...settings, idleBlinkEnabled: false }, 0)).toBeNull();
  });

  it("keeps randomized delays inside a stable range", () => {
    expect(randomizedDelayMs(20, 0)).toBe(14_000);
    expect(randomizedDelayMs(20, 1)).toBe(26_000);
  });
});
