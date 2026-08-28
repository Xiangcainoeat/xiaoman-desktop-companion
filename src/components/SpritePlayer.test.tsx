import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  SpritePlayer,
  buildClosedFrameSequence,
  createSpritePlayerController,
  naturalPresentationAt,
  resolveSpriteAtlasFrame,
  type SpritePlayerController,
} from "./SpritePlayer";

const spec = { row: 0, frames: 120, fps: 60, columns: 12 } as const;

function runAtCadence(controller: SpritePlayerController, frameRate: 30 | 60): number {
  let updates = 0;
  controller.tick(0);
  for (let tick = 1; tick <= frameRate; tick += 1) {
    const time = (tick * 1000) / frameRate;
    if (controller.tick(time).presentationChanged) updates += 1;
  }
  return updates;
}

describe("SpritePlayer behavior", () => {
  it("builds a closed, bounded frame sequence for natural action loops", () => {
    const sequence = buildClosedFrameSequence(15, 30);

    expect(sequence).toHaveLength(30);
    expect(sequence[0]).toBe(sequence.at(-1));
    expect(Math.min(...sequence)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...sequence)).toBeLessThan(15);
    expect(sequence).toContain(14);
  });

  it("maps logical playback frames to atlas frames without blending", () => {
    const spec = {
      row: 3,
      frames: 4,
      fps: 4,
      atlasFrames: 30,
      columns: 10,
      frameSequence: [0, 1, 2, 1],
    } as const;

    expect(resolveSpriteAtlasFrame(spec, 2)).toBe(2);
    expect(resolveSpriteAtlasFrame(spec, 3)).toBe(1);
  });

  it("rejects a frame map that could point outside the physical atlas", () => {
    expect(() => resolveSpriteAtlasFrame({
      frames: 2,
      fps: 4,
      atlasFrames: 3,
      frameSequence: [0, 3],
    }, 1)).toThrow("Atlas frame");
  });

  it("starts and ends the natural motion arc at rest", () => {
    const profile = { amplitudeY: 1, rotationDeg: 0.4, periodMs: 1_000 };

    expect(naturalPresentationAt(profile, 0)).toEqual({
      translateX: 0,
      translateY: 0,
      rotate: 0,
      scale: 1,
    });
    expect(naturalPresentationAt(profile, 1_000)).toEqual({
      translateX: 0,
      translateY: 0,
      rotate: 0,
      scale: 1,
    });
  });

  it("updates natural presentation between discrete atlas frame changes", () => {
    const controller = createSpritePlayerController(
      {
        frames: 30,
        fps: 5,
        playback: "natural",
        naturalMotion: { amplitudeY: 1, periodMs: 1_600 },
      },
      60,
    );

    controller.tick(0);
    const first = controller.presentation();
    const tick = controller.tick(1000 / 60);

    expect(tick.frame).toBe(0);
    expect(tick.presentationChanged).toBe(true);
    expect(controller.presentation()).not.toEqual(first);
    expect(Math.abs(controller.presentation().translateY)).toBeLessThanOrEqual(1);

    controller.replaceSpec({ frames: 2, fps: 2 });
    expect(controller.presentation()).toEqual({
      translateX: 0,
      translateY: 0,
      rotate: 0,
      scale: 1,
    });
  });

  it("renders exactly one current sprite DOM node", () => {
    const markup = renderToStaticMarkup(
      <SpritePlayer
        spec={{ row: 2, frames: 4, fps: 4, columns: 4 }}
        frameRate={30}
        className="pet-sprite"
        style={{ width: 24, height: 24, backgroundImage: "url(sprite.webp)" }}
      />,
    );

    expect((markup.match(/pet-sprite/g) ?? [])).toHaveLength(1);
    expect((markup.match(/<div/g) ?? [])).toHaveLength(1);
  });

  it("keeps logical elapsed-time progression equal at 30Hz and 60Hz", () => {
    const at30Hz = createSpritePlayerController(spec, 30);
    const at60Hz = createSpritePlayerController(spec, 60);

    const updates30 = runAtCadence(at30Hz, 30);
    const updates60 = runAtCadence(at60Hz, 60);

    expect(at30Hz.state().clock.frame).toBe(at60Hz.state().clock.frame);
    expect(at30Hz.state().clock.remainderMs).toBeCloseTo(at60Hz.state().clock.remainderMs, 8);
    expect(updates30).toBeGreaterThan(0);
    expect(updates60).toBeGreaterThan(updates30);
  });

  it("calls one-shot completion once and holds the last frame", () => {
    const onComplete = vi.fn();
    const controller = createSpritePlayerController(
      { row: 0, frames: 3, fps: 10, columns: 3, loop: false },
      60,
      { onComplete },
    );

    controller.tick(0);
    controller.tick(100);
    controller.tick(200);
    const completed = controller.tick(300);
    controller.tick(900);

    expect(completed.frame).toBe(2);
    expect(controller.state().frame).toBe(2);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("resets to frame zero when paused and when a replacement spec starts", () => {
    const controller = createSpritePlayerController(
      { row: 0, frames: 8, fps: 8, columns: 8 },
      30,
    );

    controller.tick(0);
    controller.tick(250);
    expect(controller.state().frame).toBeGreaterThan(0);

    controller.setPaused(true);
    expect(controller.state().frame).toBe(0);
    controller.replaceSpec({ row: 3, frames: 6, fps: 6, columns: 6 });
    expect(controller.state().frame).toBe(0);
    expect(renderToStaticMarkup(
      <SpritePlayer spec={{ row: 3, frames: 6, fps: 6, columns: 6 }} frameRate={60} />,
    ).match(/<div/g)).toHaveLength(1);
  });
});
