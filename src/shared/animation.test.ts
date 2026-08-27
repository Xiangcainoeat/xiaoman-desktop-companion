import { describe, expect, it } from "vitest";
import { advanceAnimationClock, advanceFrameByDelta, type AnimationClock, type AnimationSpec } from "./animation";

const spec: AnimationSpec = { frames: 10, fps: 10 };

describe("advanceFrameByDelta", () => {
  it("advances the same number of frames for equal elapsed time at 30Hz and 60Hz", () => {
    const advance = (steps: number, elapsedMs: number) => {
      let clock: AnimationClock = { frame: 0, remainderMs: 0 };
      for (let index = 0; index < steps; index += 1) {
        clock = advanceFrameByDelta(clock, elapsedMs, spec).clock;
      }
      return clock;
    };

    const at30Hz = advance(30, 1000 / 30);
    const at60Hz = advance(60, 1000 / 60);
    expect(at30Hz.frame).toBe(at60Hz.frame);
    expect(at30Hz.remainderMs).toBeCloseTo(at60Hz.remainderMs, 10);
  });

  it("limits a long frame to 250ms and reports a loop", () => {
    const result = advanceFrameByDelta({ frame: 8, remainderMs: 0 }, 1_000, spec);

    expect(result.clock.frame).toBe(0);
    expect(result.frameChanged).toBe(true);
    expect(result.looped).toBe(true);
  });

  it("reports a loop when a full cycle lands on the same frame", () => {
    const result = advanceFrameByDelta({ frame: 0, remainderMs: 0 }, 250, { frames: 10, fps: 40 });

    expect(result.clock.frame).toBe(0);
    expect(result.frameChanged).toBe(false);
    expect(result.looped).toBe(true);
  });

  it("keeps the legacy clock contract unchanged", () => {
    expect(advanceAnimationClock({ frame: 9, remainderMs: 0 }, 100, 10, 10)).toEqual({
      frame: 0,
      remainderMs: 0,
    });
  });
});
