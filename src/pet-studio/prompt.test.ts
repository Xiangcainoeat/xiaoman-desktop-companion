import { describe, expect, it } from "vitest";
import {
  PET_STUDIO_GITHUB_PATH,
  PET_STUDIO_INSTALL_COMMAND,
  PET_STUDIO_REFERENCE_IMAGES,
  buildPetStudioPrompt,
} from "./prompt";

describe("Xiaoman Pet Studio prompt contract", () => {
  it("points at the public skill and uses the official GitHub installer", () => {
    expect(PET_STUDIO_GITHUB_PATH).toBe("skills/xiaoman-pet-studio");
    expect(PET_STUDIO_INSTALL_COMMAND).toContain("install-skill-from-github.py");
    expect(PET_STUDIO_INSTALL_COMMAND).toContain("Xiangcainoeat/xiaoman-desktop-companion");
    expect(PET_STUDIO_INSTALL_COMMAND).toContain(PET_STUDIO_GITHUB_PATH);
  });

  it("requires ten distinct reference views and the validated output contract", () => {
    expect(PET_STUDIO_REFERENCE_IMAGES).toHaveLength(10);
    const prompt = buildPetStudioPrompt();
    for (const reference of PET_STUDIO_REFERENCE_IMAGES) {
      expect(prompt).toContain(reference.title);
    }
    expect(prompt).toContain("spriteVersionNumber: 2");
    expect(prompt).toContain("9 个标准动作行");
    expect(prompt).toContain("16 个注视方向");
    expect(prompt).toContain(".xmpet");
  });

  it("checks image generation and bundled processing capabilities before generation", () => {
    const prompt = buildPetStudioPrompt({ petName: "测试宠物" });
    expect(prompt).toContain("$imagegen");
    expect(prompt).toContain("$relay-imagegen");
    expect(prompt).toContain("load_workspace_dependencies");
    expect(prompt).toContain("不要用占位图");
    expect(prompt).toContain("测试宠物");
  });
});
