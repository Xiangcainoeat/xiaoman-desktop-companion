import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  SpritePlayer,
  createSpritePlayerController,
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
