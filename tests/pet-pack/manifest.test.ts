import { describe, expect, it } from "vitest";
import {
  parsePetPackManifest,
  safeRelativePath,
  validatePetPackManifest,
  type PetPackManifest,
} from "../../src/pet-pack/manifest";

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
        source: "codex",
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
        source: "codex",
      },
      {
        id: "desktop-avatar",
        path: "desktop/avatar.png",
        kind: "avatar",
        mimeType: "image/png",
        width: 128,
        height: 128,
        source: "desktop",
      },
    ],
    compatibility: { codex: true, desktop: true },
    license: "MIT",
    ...overrides,
  };
}

describe("Pet Pack manifest contract", () => {
  it("parses and accepts a valid schema version 1 manifest", () => {
    const result = parsePetPackManifest(manifest());

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.manifest).toEqual(manifest());
  });

  it("rejects absolute and traversal paths", () => {
    expect(safeRelativePath("../outside/pet.json")).toBeNull();
    expect(safeRelativePath("/tmp/pet.json")).toBeNull();
    expect(safeRelativePath("C:\\tmp\\pet.json")).toBeNull();

    const result = validatePetPackManifest(manifest({
      assetRoot: "../outside",
      entries: [
        ...manifest().entries,
        {
          id: "unsafe",
          path: "../../secret.webp",
          kind: "metadata",
          mimeType: "application/octet-stream",
        },
      ],
    }));

    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "unsafe-path",
    ]));
  });

  it("rejects duplicate entry ids and paths", () => {
    const base = manifest();
    const result = validatePetPackManifest(manifest({
      entries: [
        ...base.entries,
        { ...base.entries[0], path: "codex/other.json" },
        { ...base.entries[1], id: "another-id" },
      ],
    }));

    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "duplicate-entry-id",
      "duplicate-entry-path",
    ]));
  });

  it("rejects invalid hashes and impossible geometry", () => {
    const base = manifest();
    const result = validatePetPackManifest(manifest({
      entries: [
        {
          ...base.entries[0],
          checksumSha256: "not-a-sha256",
        },
        {
          ...base.entries[1],
          width: 0,
          height: 2287,
          frameCount: 0,
          columns: 0,
          rows: 12,
        },
        base.entries[2],
      ],
    }));

    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining([
      "invalid-sha256",
      "invalid-dimension",
      "invalid-frame-count",
      "invalid-grid",
    ]));
  });

  it("requires both Codex compatibility entries when Codex support is declared", () => {
    const base = manifest();
    const result = validatePetPackManifest(manifest({
      entries: base.entries.filter((entry) => entry.path !== "codex/spritesheet.webp"),
    }));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-codex-entry", path: "codex/spritesheet.webp" }),
    ]));
  });

  it("returns a structured parse error for malformed input", () => {
    const result = parsePetPackManifest({ schemaVersion: 2 });

    expect(result.ok).toBe(false);
    expect(result.manifest).toBeUndefined();
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid-schema-version" }),
    ]));
  });

  it("accepts optional assets and rejects a non-boolean optional flag", () => {
    const accepted = validatePetPackManifest(manifest({
      entries: manifest().entries.map((entry) => entry.id === "desktop-avatar"
        ? { ...entry, optional: true }
        : entry),
    }));
    expect(accepted.ok).toBe(true);

    const rejected = validatePetPackManifest(manifest({
      entries: manifest().entries.map((entry) => entry.id === "desktop-avatar"
        ? { ...entry, optional: "yes" as unknown as boolean }
        : entry),
    }));
    expect(rejected.ok).toBe(false);
    expect(rejected.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid-optional" }),
    ]));
  });
});
