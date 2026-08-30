import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "PetStudioLauncher.tsx"), "utf8");

describe("PetStudioLauncher contract", () => {
  it("offers a native Codex generation entry and a compact reference checklist", () => {
    expect(source).toContain("一键生成自己的宠物");
    expect(source).toContain("startPetStudio");
    expect(source).toContain("十张素材建议");
    expect(source).toContain("details");
    expect(source).toContain("installCommand");
  });
});
