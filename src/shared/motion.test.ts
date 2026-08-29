import { describe, expect, it } from "vitest";
import {
  hoverJumpDurationMs,
  isPrimaryDragPointer,
  releaseDragState,
  resetDragState,
  type DragState,
} from "./motion";

describe("pointer drag policy", () => {
  it("arms only for an unmodified primary-button pointer", () => {
    expect(isPrimaryDragPointer({ button: 0, ctrlKey: false, isPrimary: true })).toBe(true);
    expect(isPrimaryDragPointer({ button: 0, ctrlKey: false, isPrimary: false })).toBe(false);
    expect(isPrimaryDragPointer({ button: 1, ctrlKey: false, isPrimary: true })).toBe(false);
    expect(isPrimaryDragPointer({ button: 2, ctrlKey: false, isPrimary: true })).toBe(false);
    expect(isPrimaryDragPointer({ button: 0, ctrlKey: true, isPrimary: true })).toBe(false);
  });

  it("clears every drag field when an interaction is interrupted", () => {
    const armed: DragState = {
      active: true,
      moved: true,
      x: 120,
      y: 80,
      horizontal: -14,
      pointerId: 9,
    };

    expect(resetDragState(armed)).toEqual({
      active: false,
      moved: false,
      x: 0,
      y: 0,
      horizontal: 0,
      pointerId: null,
    });
  });

  it("keeps moved set after a normal release so click suppression still works", () => {
    const armed: DragState = {
      active: true,
      moved: true,
      x: 120,
      y: 80,
      horizontal: 14,
      pointerId: 9,
    };

    expect(releaseDragState(armed)).toEqual({
      active: false,
      moved: true,
      x: 0,
      y: 0,
      horizontal: 0,
      pointerId: null,
    });
  });
});

describe("hover jump timing", () => {
  it("allocates one complete host cycle per configured jump", () => {
    expect([1, 2, 3, 4, 5].map(hoverJumpDurationMs)).toEqual([
      806,
      1613,
      2419,
      3226,
      4032,
    ]);
  });
});
