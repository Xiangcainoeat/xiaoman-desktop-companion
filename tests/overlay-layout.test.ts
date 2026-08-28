import { describe, expect, it } from "vitest";
import { overlayDimensions, persistedOverlayPosition } from "../src/shared/overlay-layout";

describe("desktop overlay layout", () => {
  it("expands leftward for quick Codex replies while preserving the pet area", () => {
    expect(overlayDimensions(240, false)).toEqual({ width: 320, height: 360 });
    expect(overlayDimensions(240, true)).toEqual({ width: 676, height: 430 });
  });

  it("stores the collapsed lower-right anchor while the task panel is expanded", () => {
    expect(persistedOverlayPosition({ x: 100, y: 200, width: 676, height: 430 }, 240)).toEqual({
      x: 456,
      y: 270,
    });
  });

  it("scales safely for the supported pet size range", () => {
    expect(overlayDimensions(150, false)).toEqual({ width: 260, height: 320 });
    expect(overlayDimensions(340, true)).toEqual({ width: 776, height: 468 });
  });

  it("keeps Codex, care, and interaction on the same expanded host geometry", () => {
    const modes = ["codex", "care", "interaction"] as const;
    const dimensions = modes.map((mode) => overlayDimensions(240, mode));
    expect(dimensions).toEqual([
      { width: 676, height: 430 },
      { width: 676, height: 430 },
      { width: 676, height: 430 },
    ]);
  });
});
