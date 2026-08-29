import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./PetSprite.tsx", import.meta.url), "utf8");

describe("PetSprite natural care playback contract", () => {
  it("marks care and sleep playback as natural and maps to a bounded source sequence", () => {
    expect(source).toContain('playback: "natural"');
    expect(source).toContain("frameSequence:");
    expect(source).toContain("atlasFrames:");
    expect(source).toContain("naturalMotion:");
  });

  it("keeps manual sleep on its curled atlas instead of settling to standing idle", () => {
    expect(source).toContain('state !== "sleeping"');
  });

  it("routes feeding and bathing through the native-colored base atlases", () => {
    expect(source).toContain("const NATURAL_FEED_BASE_SPEC");
    expect(source).toMatch(/NATURAL_FEED_BASE_SPEC(?:: PetAnimationSpec)? = \{\n  atlas: "idle"/);
    expect(source).toContain("const NATURAL_BATH_BASE_SPEC");
    expect(source).toMatch(/NATURAL_BATH_BASE_SPEC(?:: PetAnimationSpec)? = \{\n  atlas: "standard"/);
    expect(source).toContain("buildClosedFrameSequence(30, NATURAL_ACTION_PLAYBACK_FRAMES)");
  });
});
