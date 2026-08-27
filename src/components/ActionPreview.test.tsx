import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ActionPreviewPlayback } from "./ActionPreview";

globalThis.window = {} as Window & typeof globalThis;
const {
  finishActionPreview,
  previewSpriteForPlayback,
  startActionPreview,
} = await import("./ActionPreview");

const source = readFileSync(new URL("./ActionPreview.tsx", import.meta.url), "utf8");

describe("ActionPreview renderer contract", () => {
  it("uses production PetSprite and exposes every requested action", () => {
    expect(source).toContain("PetSprite");
    for (const action of [
      "idle",
      "idle-lick",
      "idle-blink",
      "idle-scratch",
      "running-left",
      "running-right",
      "jumping",
      "care-bath",
      "care-feed",
      "sleeping",
    ]) {
      expect(source).toContain(`id: "${action}"`);
    }
  });

  it("plays one cycle and clears its timer without mutating bridge state", () => {
    expect(source).toContain("setTimeout");
    expect(source).toContain("clearTimeout");
    expect(source).toContain("onClose");
    expect(source).not.toContain("bridge.");
    expect(source).toContain("settings");
  });

  it("uses each playback cycle as the production PetSprite identity", () => {
    expect(source).toContain("key={playback.cycle}");
  });

  it("returns special actions to explicit idle after a cycle and restarts replacements", () => {
    const initial: ActionPreviewPlayback = {
      selectedAction: "idle",
      playingAction: null,
      cycle: 0,
    };

    for (const action of ["sleeping", "care-bath", "care-feed"] as const) {
      const playing = startActionPreview(initial, action);
      expect(previewSpriteForPlayback(playing)).toMatchObject({
        state: action === "care-bath" ? "bathing" : action === "care-feed" ? "eating" : "sleeping",
      });

      const finished = finishActionPreview(playing);
      expect(finished).toEqual({ selectedAction: "idle", playingAction: null, cycle: 1 });
      expect(previewSpriteForPlayback(finished)).toEqual({ state: "idle", motion: null });
    }

    const first = startActionPreview(initial, "sleeping");
    const replacement = startActionPreview(first, "care-feed");
    expect(replacement).toEqual({ selectedAction: "care-feed", playingAction: "care-feed", cycle: 2 });
    expect(startActionPreview(replacement, "care-feed").cycle).toBe(3);
  });
});
