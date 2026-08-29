import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { archiveDirectory } from "../scripts/pet-pack-package";
import { PetPackService } from "./pet-pack-service";

async function temporaryDirectory(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createPackage(root: string, id: string, valid = true): Promise<string> {
  const source = path.join(root, `${id}-source`);
  await mkdir(path.join(source, "assets", "codex"), { recursive: true });
  writeFileSync(path.join(source, "assets", "codex", "pet.json"), JSON.stringify({ id }));
  writeFileSync(path.join(source, "assets", "codex", "spritesheet.webp"), `${id}-sprite`);
  writeFileSync(path.join(source, "manifest.json"), JSON.stringify({
    schemaVersion: 1,
    id,
    name: id,
    version: "1.0.0",
    spriteVersionNumber: 2,
    assetRoot: "assets",
    entries: [
      { id: "codex-pet", path: "codex/pet.json", kind: "metadata", mimeType: "application/json" },
      {
        id: "codex-spritesheet",
        path: "codex/spritesheet.webp",
        kind: "spritesheet",
        mimeType: "image/webp",
        ...(valid ? {} : { checksumSha256: "0".repeat(64) }),
      },
    ],
    compatibility: { codex: true },
    license: "UNLICENSED",
  }));
  const packageFile = path.join(root, `${id}-${valid ? "valid" : "invalid"}.xmpet`);
  await archiveDirectory(source, packageFile);
  return packageFile;
}

describe("PetPackService", () => {
  it("imports, lists, activates, and removes a validated package", async () => {
    const root = await temporaryDirectory("xiaoman-pet-service-");
    try {
      const packageFile = await createPackage(root, "blue-cat");
      const service = new PetPackService(path.join(root, "user-data"));

      const imported = await service.importPackage(packageFile);
      expect(imported.id).toBe("blue-cat");
      expect((await service.listInstalled()).map((summary) => summary.id)).toEqual(["blue-cat"]);
      expect(await service.getActive()).toBeNull();

      const active = await service.setActive("blue-cat");
      expect(active.active).toBe(true);
      expect((await service.getActive())?.id).toBe("blue-cat");
      await service.remove("blue-cat");
      expect(await service.getActive()).toBeNull();
      expect(await service.listInstalled()).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts pet-pack.json as the alternate root name for the same manifest schema", async () => {
    const root = await temporaryDirectory("xiaoman-pet-service-manifest-alias-");
    try {
      const packageFile = await createPackage(root, "alias-cat");
      const source = path.join(root, "alias-cat-source");
      await rm(path.join(source, "manifest.json"));
      writeFileSync(path.join(source, "pet-pack.json"), JSON.stringify({
        schemaVersion: 1,
        id: "alias-cat",
        name: "alias-cat",
        version: "1.0.0",
        spriteVersionNumber: 2,
        assetRoot: "assets",
        entries: [
          { id: "codex-pet", path: "codex/pet.json", kind: "metadata", mimeType: "application/json" },
          { id: "codex-spritesheet", path: "codex/spritesheet.webp", kind: "spritesheet", mimeType: "image/webp" },
        ],
        compatibility: { codex: true },
        license: "UNLICENSED",
      }));
      await archiveDirectory(source, packageFile);
      const service = new PetPackService(path.join(root, "user-data"));
      expect((await service.importPackage(packageFile)).id).toBe("alias-cat");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a checksum failure without changing the active package", async () => {
    const root = await temporaryDirectory("xiaoman-pet-service-rollback-");
    try {
      const goodPackage = await createPackage(root, "stable-cat");
      const badPackage = await createPackage(root, "stable-cat", false);
      const service = new PetPackService(path.join(root, "user-data"));
      await service.importPackage(goodPackage);
      await service.setActive("stable-cat");

      await expect(service.importPackage(badPackage)).rejects.toMatchObject({ code: "invalid-package" });
      expect((await service.getActive())?.id).toBe("stable-cat");
      expect(await readFile(path.join(root, "user-data", "pets", "stable-cat", "assets", "codex", "pet.json"), "utf8"))
        .toContain("stable-cat");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("enforces archive entry and byte limits before extraction", async () => {
    const root = await temporaryDirectory("xiaoman-pet-service-limits-");
    try {
      const packageFile = await createPackage(root, "limited-cat");
      const service = new PetPackService(path.join(root, "user-data"));
      await expect(service.importPackage(packageFile, { maxEntries: 1 })).rejects.toMatchObject({ code: "archive-limit" });
      await expect(service.importPackage(packageFile, { maxBytes: 1 })).rejects.toMatchObject({ code: "archive-limit" });
      expect(existsSync(path.join(root, "user-data", "pets", "limited-cat"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exports only Codex's two files and backs up an existing target", async () => {
    const root = await temporaryDirectory("xiaoman-pet-service-codex-");
    try {
      const packageFile = await createPackage(root, "codex-cat");
      const service = new PetPackService(path.join(root, "user-data"));
      await service.importPackage(packageFile);
      await service.setActive("codex-cat");

      const codexHome = path.join(root, "codex-home");
      const target = path.join(codexHome, "pets", "codex-cat");
      await mkdir(target, { recursive: true });
      writeFileSync(path.join(target, "old.txt"), "old");
      const result = await service.exportCodex("codex-cat", codexHome);

      expect(result.files.sort()).toEqual(["pet.json", "spritesheet.webp"]);
      expect(readdirSync(target).sort()).toEqual(["pet.json", "spritesheet.webp"]);
      expect(existsSync(path.join(target, "old.txt"))).toBe(false);
      expect(result.backupPath).toBeTruthy();
      if (!result.backupPath) throw new Error("expected an existing Codex target to be backed up");
      expect(existsSync(path.join(result.backupPath, "old.txt"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
