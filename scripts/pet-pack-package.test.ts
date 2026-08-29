import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  archiveDirectory,
  extractArchive,
  inspectArchiveEntries,
  listArchiveEntries,
  packPetProject,
} from "./pet-pack-package";

async function temporaryDirectory(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createProject(root: string): Promise<string> {
  const project = path.join(root, "project");
  await mkdir(path.join(project, "assets", "codex"), { recursive: true });
  await mkdir(path.join(project, "prompts"), { recursive: true });
  await mkdir(path.join(project, "references"), { recursive: true });
  writeFileSync(path.join(project, "pet-project.json"), JSON.stringify({
    schemaVersion: 1,
    assetId: "test-cat",
    displayName: "Test Cat",
    references: [{ path: "references/original.png", role: "identity" }],
    actions: ["standard"],
  }));
  writeFileSync(path.join(project, "prompts", "standard.md"), "Keep the identity stable.");
  writeFileSync(path.join(project, "jobs.json"), JSON.stringify({
    schemaVersion: 1,
    jobs: [{ id: "standard-000", outputPath: "frames/standard-000.png" }],
  }));
  writeFileSync(path.join(project, "imagegen-jobs.json"), JSON.stringify({ provider: { apiKey: "secret" } }));
  writeFileSync(path.join(project, ".env.local"), "OPENAI_API_KEY=secret");
  writeFileSync(path.join(project, "references", "original.png"), "reference bytes");
  writeFileSync(path.join(project, "assets", "codex", "pet.json"), "{\"name\":\"Test Cat\"}");
  writeFileSync(path.join(project, "assets", "codex", "spritesheet.webp"), "small test sprite bytes");
  return project;
}

describe("pet-pack-package", () => {
  it("rejects unsafe, duplicate, and unsupported archive entries", () => {
    expect(inspectArchiveEntries(["assets/cat.webp", "assets/cat.webp"])).toMatchObject({ ok: false });
    expect(inspectArchiveEntries(["../outside.txt"])).toMatchObject({ ok: false });
    expect(inspectArchiveEntries(["/absolute.txt"])).toMatchObject({ ok: false });
    expect(inspectArchiveEntries(["__MACOSX/._manifest.json"])).toMatchObject({ ok: false });
    expect(inspectArchiveEntries(["manifest.json", "assets/cat.webp"])).toEqual({ ok: true });
  });

  it("packs a project, excludes references and API configuration, and round-trips", async () => {
    const root = await temporaryDirectory("xiaoman-pet-pack-package-");
    try {
      const project = await createProject(root);
      const packageFile = path.join(root, "test-cat.xmpet");

      const report = await packPetProject(project, packageFile);
      expect(report.id).toBe("test-cat");
      expect(report.files).toContain("assets/codex/pet.json");
      expect(report.files).toContain("prompts/standard.md");
      expect(report.files).not.toContain("references/original.png");

      const entries = await listArchiveEntries(packageFile);
      expect(entries.map((entry) => entry.path)).toContain("manifest.json");
      expect(entries.map((entry) => entry.path)).toContain("assets/codex/spritesheet.webp");
      expect(entries.map((entry) => entry.path)).not.toContain("references/original.png");
      expect(entries.map((entry) => entry.path)).not.toContain(".env.local");
      expect(entries.map((entry) => entry.path)).not.toContain("imagegen-jobs.json");

      const extracted = path.join(root, "extracted");
      await extractArchive(packageFile, extracted);
      const manifest = JSON.parse(await readFile(path.join(extracted, "manifest.json"), "utf8")) as {
        entries: Array<{ path: string; checksumSha256?: string }>;
      };
      expect(manifest.entries.map((entry) => entry.path)).toContain("codex/spritesheet.webp");
      expect(manifest.entries.every((entry) => entry.checksumSha256?.length === 64)).toBe(true);
      expect(readFileSync(path.join(extracted, "assets", "codex", "pet.json"), "utf8")).toContain("Test Cat");
      expect(existsSync(path.join(extracted, "references"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports a clear failure when the project manifest or required files are invalid", async () => {
    const root = await temporaryDirectory("xiaoman-pet-pack-invalid-");
    try {
      const project = await createProject(root);
      writeFileSync(path.join(project, "pet-project.json"), JSON.stringify({ schemaVersion: 1, assetId: "../escape" }));
      await expect(packPetProject(project, path.join(root, "invalid.xmpet"))).rejects.toMatchObject({
        code: "invalid-project",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies JSON metadata separately from image atlases", async () => {
    const root = await temporaryDirectory("xiaoman-pet-pack-metadata-");
    try {
      const project = await createProject(root);
      const packageFile = path.join(root, "metadata.xmpet");
      const report = await packPetProject(project, packageFile);
      expect(report.manifest.entries.find((entry) => entry.path === "codex/pet.json")?.kind).toBe("metadata");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
