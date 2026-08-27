import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/components/PetSprite.tsx", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../public/pet/profile-manifest.json", import.meta.url), "utf8")) as {
  profiles: Record<string, {
    lookAtlas: string;
    lookMetadata: string;
    directionCount: number;
    stepDegrees: number;
  }>;
};

describe("PetSprite look rendering contract", () => {
  it("uses the 96-direction enhanced asset", () => {
    expect(source).toContain('"look-96.json"');
    expect(source).toContain('"look-96.webp"');
  });

  it("keeps the enhanced body stable and renders a head-only look layer", () => {
    const layers = source.match(/className="pet-sprite pet-look-layer"/g) ?? [];
    expect(layers).toHaveLength(1);
    expect(source).toContain('"head-look-96.webp"');
    expect(source).toContain("pet-head-look-layer");
    expect(source).toContain("pet-sprite pet-sprite-base");
    expect(source).toContain("gazeBodyFrameRef");
    expect(source).toContain("Hold the exact action frame visible when gaze starts");
    expect(source).not.toContain("lookBlend");
    expect(source).not.toContain("secondLookIndex");
    expect(source).not.toContain("transition: opacity");
  });

  it("publishes the 96-frame enhanced profile beside the untouched native profile", () => {
    expect(manifest.profiles.enhanced).toMatchObject({
      lookAtlas: "look-96.webp",
      lookMetadata: "look-96.json",
      directionCount: 96,
      stepDegrees: 3.75,
    });
    expect(manifest.profiles.native).toMatchObject({
      lookAtlas: "native/look-16.webp",
      lookMetadata: "native/look-16.json",
      directionCount: 16,
      stepDegrees: 22.5,
    });
  });
});
