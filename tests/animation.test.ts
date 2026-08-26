import { describe, expect, it } from "vitest";
import { advanceAnimationClock, atlasFramePosition } from "../src/shared/animation";

describe("animation clock", () => {
  it("advances one 30 fps animation through 30 frames in one second", () => {
    let clock = { frame: 0, remainderMs: 0 };

    for (let tick = 0; tick < 30; tick += 1) {
      clock = advanceAnimationClock(clock, 1000 / 30, 30, 30);
    }

    expect(clock.frame).toBe(0);
    expect(clock.remainderMs).toBeLessThan(1);
  });

  it("advances only logical frames when called at 60 Hz for a 30 fps animation", () => {
    let clock = { frame: 0, remainderMs: 0 };
    let changedFrames = 0;

    for (let tick = 0; tick < 60; tick += 1) {
      const next = advanceAnimationClock(clock, 1000 / 60, 30, 30);
      if (next.frame !== clock.frame) changedFrames += 1;
      clock = next;
    }

    expect(changedFrames).toBe(30);
    expect(clock.frame).toBe(0);
    expect(clock.remainderMs).toBeLessThan(1);
  });

  it("caps a large elapsed time so a suspended tab cannot skip the animation", () => {
    expect(advanceAnimationClock({ frame: 0, remainderMs: 0 }, 10_000, 30, 30)).toEqual({
      frame: 7,
      remainderMs: 0.5,
    });
  });

  it("ignores negative elapsed time", () => {
    expect(advanceAnimationClock({ frame: 4, remainderMs: 0.25 }, -100, 30, 30)).toEqual({
      frame: 4,
      remainderMs: 0.25,
    });
  });
});

describe("atlas frame positions", () => {
  it("keeps a 30-frame idle action inside its 10-column row block", () => {
    expect(atlasFramePosition({ row: 6, frames: 30, columns: 10 }, 29)).toEqual({ column: 9, row: 8 });
  });

  it("uses the explicit column count for the standard atlas", () => {
    expect(atlasFramePosition({ row: 7, frames: 8, columns: 8 }, 7)).toEqual({ column: 7, row: 7 });
  });

  it("rejects frames outside the animation range", () => {
    expect(() => atlasFramePosition({ row: 0, frames: 30, columns: 10 }, 30)).toThrow(
      "Animation frame must be an integer between 0 and 29",
    );
  });
});
