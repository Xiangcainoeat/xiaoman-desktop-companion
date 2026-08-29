import { describe, expect, it } from "vitest";
import {
  BUNDLED_PET_PACK_ID,
  PET_ASSET_IDS,
  createBundledPetPackRuntime,
  findPetPackAsset,
  resolvePetAssetUrl,
} from "./runtime";

describe("bundled Pet Pack runtime", () => {
  it("exposes stable assets for the Codex and enhanced profiles", () => {
    const runtime = createBundledPetPackRuntime();

    expect(runtime.id).toBe(BUNDLED_PET_PACK_ID);
    expect(PET_ASSET_IDS).toEqual(expect.arrayContaining([
      "codex-pet",
      "codex-spritesheet",
      "native-look-atlas",
      "enhanced-look-atlas",
      "idle-actions",
      "sleeping-actions",
      "care-actions",
      "avatar",
      "tray",
    ]));
    expect(findPetPackAsset(runtime, "enhanced-look-atlas")?.url).toBe("./pet/look-96.webp");
    expect(findPetPackAsset(runtime, "native-look-atlas")?.url).toBe("./pet/native/look-16.webp");
  });

  it("uses the requested fallback when an optional custom asset is absent", () => {
    const runtime = {
      ...createBundledPetPackRuntime(),
      id: "custom",
      assets: createBundledPetPackRuntime().assets.filter((asset) => asset.id !== "care-actions"),
    };

    expect(resolvePetAssetUrl(runtime, "care-actions", "./pet/care-actions-30.webp"))
      .toBe("./pet/care-actions-30.webp");
    expect(resolvePetAssetUrl(runtime, "avatar", "./pet/avatar.png"))
      .toBe("./pet/avatar.png");
  });
});
