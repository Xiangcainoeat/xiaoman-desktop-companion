import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  sha256File,
  validatePetPackFiles,
} from "../../src/pet-pack/files";
import type { PetPackManifest } from "../../src/pet-pack/manifest";

function manifest(overrides: Partial<PetPackManifest> = {}): PetPackManifest {
  return {
    schemaVersion: 1,
    id: "xiaoman",
    name: "小满",
    version: "1.0.0",
    spriteVersionNumber: 2,
    assetRoot: "assets",
    entries: [
      {
        id: "codex-manifest",
        path: "codex/pet.json",
        kind: "metadata",
        mimeType: "application/json",
      },
      {
        id: "codex-spritesheet",
        path: "codex/spritesheet.webp",
        kind: "spritesheet",
        mimeType: "image/webp",
        width: 1536,
        height: 2288,
        frameCount: 88,
        columns: 8,
        rows: 11,
      },
      {
        id: "desktop-avatar",
        path: "desktop/avatar.png",
        kind: "avatar",
        mimeType: "image/png",
        width: 128,
        height: 128,
      },
    ],
    compatibility: { codex: true, desktop: true },
    license: "MIT",
    ...overrides,
  };
}

async function writePackFile(rootDir: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(rootDir, "assets", relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

describe("Pet Pack files", () => {
  it("computes a SHA-256 digest with Node's standard library", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "pet-pack-sha-"));
    const filePath = path.join(directory, "payload.txt");
    await writeFile(filePath, "hello pet pack");

    await expect(sha256File(filePath)).resolves.toBe(
      "27a8ccc9df994a0fbb0eacc26978ed86dbba81a42068ad78dee3cb0603b4dbdc",
    );

    await rm(directory, { recursive: true, force: true });
  });

  it("reports missing Codex files and declared desktop files", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "pet-pack-files-"));
    await writePackFile(directory, "codex/pet.json", "{}");

    const result = await validatePetPackFiles(manifest(), directory);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-file", path: "codex/spritesheet.webp" }),
      expect.objectContaining({ code: "missing-file", path: "desktop/avatar.png" }),
    ]));

    await rm(directory, { recursive: true, force: true });
  });

  it("accepts Codex files and optional desktop resources when present", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "pet-pack-files-"));
    await writePackFile(directory, "codex/pet.json", "{}");
    await writePackFile(directory, "codex/spritesheet.webp", "spritesheet");
    await writePackFile(directory, "desktop/avatar.png", "avatar");

    const result = await validatePetPackFiles(manifest({
      entries: manifest().entries.filter((entry) => entry.kind !== "avatar"),
      compatibility: { codex: true },
    }), directory);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);

    await rm(directory, { recursive: true, force: true });
  });

  it("reports a missing optional asset as a warning instead of breaking the pack", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "pet-pack-optional-"));
    await writePackFile(directory, "codex/pet.json", "{}");
    await writePackFile(directory, "codex/spritesheet.webp", "spritesheet");

    const result = await validatePetPackFiles(manifest({
      entries: manifest().entries.map((entry) => entry.id === "desktop-avatar"
        ? { ...entry, optional: true }
        : entry),
      compatibility: { codex: true },
    }), directory);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-optional-file", path: "desktop/avatar.png" }),
    ]));

    await rm(directory, { recursive: true, force: true });
  });

  it("reports a checksum mismatch for a present file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "pet-pack-checksum-"));
    await writePackFile(directory, "codex/pet.json", "{}");
    await writePackFile(directory, "codex/spritesheet.webp", "spritesheet");

    const result = await validatePetPackFiles(manifest({
      entries: manifest().entries.map((entry) => entry.id === "codex-spritesheet"
        ? { ...entry, checksumSha256: "0000000000000000000000000000000000000000000000000000000000000000" }
        : entry),
    }), directory);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "checksum-mismatch", path: "codex/spritesheet.webp" }),
    ]));

    await rm(directory, { recursive: true, force: true });
  });
});
