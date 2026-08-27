import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
});
