import { randomUUID } from "node:crypto";
import { access, cp, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  extractArchive,
  inspectArchiveEntries,
  listArchiveEntries,
  type ArchiveLimits,
  type PetPackPackageError,
} from "../scripts/pet-pack-package";
import {
  parsePetPackManifest,
  safeRelativePath,
  type PetPackManifest,
  type PetPackValidationIssue,
} from "../src/pet-pack/manifest";
import { validatePetPackFiles } from "../src/pet-pack/files";
import {
  createPetPackRuntimeFromEntries,
} from "../src/pet-pack/runtime";
import type { PetPackRuntime } from "../src/shared/types";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CODEX_FILES = ["pet.json", "spritesheet.webp"] as const;
const ACTIVE_FILE = "active-pet-pack.json";

export interface PetPackSummary {
  id: string;
  name: string;
  version: string;
  spriteVersionNumber: number;
  rootDir: string;
  files: string[];
  active: boolean;
  hasCodex: boolean;
  hasDesktop: boolean;
  warnings: string[];
}

export interface ImportOptions extends ArchiveLimits {}

export interface CodexExportResult {
  path: string;
  files: string[];
  backupPath?: string;
}

export class PetPackServiceError extends Error {
  readonly code: string;
  readonly errors: PetPackValidationIssue[];

  constructor(code: string, message: string, errors: PetPackValidationIssue[] = []) {
    super(message);
    this.name = "PetPackServiceError";
    this.code = code;
    this.errors = errors;
  }
}

function issue(code: string, message: string, entryPath?: string): PetPackValidationIssue {
  return entryPath === undefined ? { code, message } : { code, message, path: entryPath };
}

function safeId(id: string): void {
  if (!SAFE_ID.test(id) || id.includes("..")) throw new PetPackServiceError("invalid-id", `pet id is not a safe path segment: ${id}`);
}

function isWithinDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function atomicJsonWrite(filePath: string, value: unknown): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

function packageManifestPath(rootDir: string): string {
  return path.join(rootDir, "manifest.json");
}

async function readManifest(rootDir: string): Promise<PetPackManifest> {
  const manifestPath = packageManifestPath(rootDir);
  try {
    const value = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    const parsed = parsePetPackManifest(value);
    if (!parsed.ok || !parsed.manifest) {
      throw new PetPackServiceError("invalid-package", "Pet Pack manifest failed schema validation", parsed.errors);
    }
    safeId(parsed.manifest.id);
    return parsed.manifest;
  } catch (error) {
    if (error instanceof PetPackServiceError) throw error;
    throw new PetPackServiceError("invalid-package", `cannot read manifest.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function validatePackage(rootDir: string): Promise<PetPackManifest> {
  const manifest = await readManifest(rootDir);
  const validation = await validatePetPackFiles(manifest, rootDir);
  if (!validation.ok) throw new PetPackServiceError("invalid-package", "Pet Pack files failed validation", validation.errors);
  return manifest;
}

async function packageFiles(rootDir: string, manifest: PetPackManifest): Promise<string[]> {
  const assetRoot = path.resolve(rootDir, ...manifest.assetRoot.split("/"));
  const files: string[] = [];
  for (const entry of manifest.entries) {
    const safePath = safeRelativePath(entry.path);
    if (!safePath) throw new PetPackServiceError("invalid-package", `unsafe manifest path: ${entry.path}`);
    const filePath = path.resolve(assetRoot, ...safePath.split("/"));
    if (!isWithinDirectory(assetRoot, filePath)) throw new PetPackServiceError("invalid-package", `manifest path escapes assetRoot: ${entry.path}`);
    files.push(path.relative(rootDir, filePath).split(path.sep).join("/"));
  }
  return files.sort();
}

async function summaryFor(rootDir: string, activeId: string | null): Promise<PetPackSummary> {
  const manifest = await validatePackage(rootDir);
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    spriteVersionNumber: manifest.spriteVersionNumber,
    rootDir,
    files: await packageFiles(rootDir, manifest),
    active: activeId === manifest.id,
    hasCodex: manifest.compatibility.codex !== undefined && manifest.compatibility.codex !== false,
    hasDesktop: manifest.compatibility.desktop !== undefined && manifest.compatibility.desktop !== false,
    warnings: [],
  };
}

export class PetPackService {
  private readonly userDataPath: string;
  private readonly bundledRoot?: string;

  constructor(userDataPath: string, bundledRoot?: string) {
    this.userDataPath = path.resolve(userDataPath);
    this.bundledRoot = bundledRoot ? path.resolve(bundledRoot) : undefined;
  }

  private get petsPath(): string {
    return path.join(this.userDataPath, "pets");
  }

  private get activePath(): string {
    return path.join(this.userDataPath, ACTIVE_FILE);
  }

  private async readActiveId(): Promise<string | null> {
    try {
      const value = JSON.parse(await readFile(this.activePath, "utf8")) as { id?: unknown };
      if (typeof value.id !== "string") return null;
      safeId(value.id);
      return value.id;
    } catch {
      return null;
    }
  }

  async importPackage(packageFile: string, options: ImportOptions = {}): Promise<PetPackSummary> {
    await mkdir(this.petsPath, { recursive: true });
    let archiveEntries;
    try {
      archiveEntries = await listArchiveEntries(packageFile);
      const inspection = inspectArchiveEntries(archiveEntries.map((entry) => entry.path));
      if (!inspection.ok) throw new PetPackServiceError("unsafe-archive", "archive contains unsafe entries", inspection.errors.map((message) => issue("unsafe-path", message)));
      const manifestEntries = archiveEntries.filter((entry) => !entry.isDirectory).map((entry) => entry.path).filter((entry) => entry === "manifest.json" || entry === "pet-pack.json");
      if (manifestEntries.length !== 1) {
        throw new PetPackServiceError("invalid-package", "archive must contain exactly one root manifest.json or pet-pack.json");
      }
      for (const entry of archiveEntries) {
        if (/^(?:references?|refs)(?:\/|$)/i.test(entry.path) || /(?:^|\/)(?:\.env(?:\..*)?|imagegen-jobs\.json)$/i.test(entry.path)) {
          throw new PetPackServiceError("unsafe-archive", `archive contains forbidden authoring data: ${entry.path}`);
        }
      }
    } catch (error) {
      if (error instanceof PetPackServiceError) throw error;
      const packageError = error as PetPackPackageError;
      throw new PetPackServiceError(packageError.code || "invalid-archive", packageError.message);
    }

    const temporary = path.join(this.userDataPath, `.pet-pack-import-${randomUUID()}`);
    await mkdir(temporary, { recursive: true });
    try {
      await extractArchive(packageFile, temporary, options);
      if (await pathExists(path.join(temporary, "pet-pack.json"))) {
        await rename(path.join(temporary, "pet-pack.json"), path.join(temporary, "manifest.json"));
      }
      const manifest = await validatePackage(temporary);
      const destination = path.join(this.petsPath, manifest.id);
      safeId(manifest.id);
      const backup = path.join(this.petsPath, `.${manifest.id}.backup-${Date.now()}-${randomUUID()}`);
      const hadExisting = await pathExists(destination);
      if (hadExisting) await rename(destination, backup);
      try {
        await rename(temporary, destination);
      } catch (error) {
        if (hadExisting) await rename(backup, destination).catch(() => undefined);
        throw new PetPackServiceError("install-failed", `cannot atomically install ${manifest.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (hadExisting) await rm(backup, { recursive: true, force: true });
      return summaryFor(destination, await this.readActiveId());
    } catch (error) {
      if (error instanceof PetPackServiceError) throw error;
      const packageError = error as { code?: string; message?: string; errors?: string[] };
      throw new PetPackServiceError(
        packageError.code || "invalid-package",
        packageError.message || "failed to import Pet Pack",
        (packageError.errors || []).map((message) => issue("invalid-package", message)),
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async listInstalled(): Promise<PetPackSummary[]> {
    const activeId = await this.readActiveId();
    let entries;
    try {
      entries = await readdir(this.petsPath, { withFileTypes: true });
    } catch {
      return [];
    }
    const summaries: PetPackSummary[] = [];
    for (const entry of entries.filter((candidate) => candidate.isDirectory() && !candidate.name.startsWith("."))) {
      try {
        summaries.push(await summaryFor(path.join(this.petsPath, entry.name), activeId));
      } catch {
        // Invalid packages are intentionally hidden from runtime consumers.
      }
    }
    return summaries.sort((a, b) => a.id.localeCompare(b.id));
  }

  async getActive(): Promise<PetPackSummary | null> {
    const activeId = await this.readActiveId();
    if (!activeId) return null;
    try {
      return await summaryFor(path.join(this.petsPath, activeId), activeId);
    } catch {
      return null;
    }
  }

  async getManifest(id: string): Promise<PetPackManifest> {
    safeId(id);
    return validatePackage(path.join(this.petsPath, id));
  }

  /** Return renderer-safe file URLs for the selected installed pack. */
  async getRuntime(id: string): Promise<PetPackRuntime> {
    const rootDir = path.join(this.petsPath, id);
    const manifest = await this.getManifest(id);
    return createPetPackRuntimeFromEntries(
      manifest.id,
      manifest.entries,
      (entry) => pathToFileURL(path.resolve(rootDir, manifest.assetRoot, ...entry.path.split("/"))).toString(),
    );
  }

  async setActive(id: string): Promise<PetPackSummary> {
    safeId(id);
    const destination = path.join(this.petsPath, id);
    const summary = await summaryFor(destination, id);
    await mkdir(this.userDataPath, { recursive: true });
    await atomicJsonWrite(this.activePath, { id });
    return { ...summary, active: true };
  }

  async clearActive(): Promise<void> {
    await rm(this.activePath, { force: true });
  }

  async remove(id: string): Promise<void> {
    safeId(id);
    const destination = path.join(this.petsPath, id);
    if (!(await pathExists(destination))) throw new PetPackServiceError("not-found", `installed Pet Pack not found: ${id}`);
    await rm(destination, { recursive: true, force: true });
    if ((await this.readActiveId()) === id) await rm(this.activePath, { force: true });
  }

  async exportCodex(id: string, codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex")): Promise<CodexExportResult> {
    safeId(id);
    const sourceRoot = path.join(this.petsPath, id);
    const manifest = await validatePackage(sourceRoot);
    const assetRoot = path.resolve(sourceRoot, ...manifest.assetRoot.split("/"));
    const sourceDirectory = path.join(assetRoot, "codex");
    const target = path.join(path.resolve(codexHome), "pets", id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const backup = `${target}.backup-${Date.now()}-${randomUUID()}`;
    await mkdir(path.dirname(target), { recursive: true });
    await mkdir(temporary, { recursive: true });
    try {
      for (const file of CODEX_FILES) {
        const source = path.resolve(sourceDirectory, file);
        if (!isWithinDirectory(assetRoot, source) || !(await pathExists(source)) || !(await lstat(source)).isFile()) {
          throw new PetPackServiceError("invalid-package", `Codex export source is missing: codex/${file}`);
        }
        await cp(source, path.join(temporary, file));
      }
      let backupPath: string | undefined;
      if (await pathExists(target)) {
        await rename(target, backup);
        backupPath = backup;
      }
      try {
        await rename(temporary, target);
      } catch (error) {
        if (backupPath) await rename(backupPath, target).catch(() => undefined);
        throw new PetPackServiceError("export-failed", `cannot install Codex files: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { path: target, files: [...CODEX_FILES], backupPath };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

export { ACTIVE_FILE };
