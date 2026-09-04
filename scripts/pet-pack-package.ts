#!/usr/bin/env node
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import {
  safeRelativePath,
  validatePetPackManifest,
  type PetPackEntry,
  type PetPackManifest,
} from "../src/pet-pack/manifest";
import { sha256File, validatePetPackFiles } from "../src/pet-pack/files";

const execFileAsync = promisify(execFile);
const MAX_ARCHIVE_ENTRIES = 512;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ALLOWED_ASSET_ROOTS = ["assets", "desktop", "codex", "previews", "qa"] as const;

export interface ArchiveEntry {
  path: string;
  size: number;
  isDirectory: boolean;
}

export interface ArchiveLimits {
  maxEntries?: number;
  maxBytes?: number;
}

export interface PackReport {
  id: string;
  name: string;
  outputFile: string;
  manifest: PetPackManifest;
  files: string[];
}

export class PetPackPackageError extends Error {
  readonly code: string;
  readonly errors: string[];

  constructor(code: string, message: string, errors: string[] = []) {
    super(message);
    this.name = "PetPackPackageError";
    this.code = code;
    this.errors = errors;
  }
}

function isWithinDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function findCommand(command: "zip" | "unzip"): Promise<string> {
  const candidates = process.env.PATH?.split(path.delimiter).filter(Boolean).map((entry) => path.join(entry, command)) ?? [];
  candidates.push(`/usr/bin/${command}`, `/bin/${command}`);
  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next system location.
    }
  }
  throw new PetPackPackageError(
    "archive-tool-missing",
    `The system ${command} command is required to work with .xmpet archives. Install ${command} and retry.`,
  );
}

function normalizeArchivePath(entry: string): string {
  return entry.endsWith("/") ? entry.slice(0, -1) : entry;
}

export function inspectArchiveEntries(entries: string[]): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "string" || entry.length === 0) {
      errors.push("archive contains an empty or non-string entry");
      continue;
    }
    const normalized = normalizeArchivePath(entry);
    if (normalized.length === 0 || entry.includes("\\") || entry.includes("\0") || normalized === "__MACOSX" || normalized.startsWith("__MACOSX/")) {
      errors.push(`unsupported archive entry: ${entry}`);
      continue;
    }
    if (normalized.endsWith("/.DS_Store") || normalized === ".DS_Store") {
      errors.push(`unsupported archive entry: ${entry}`);
      continue;
    }
    if (safeRelativePath(normalized) === null) {
      errors.push(`unsafe archive path: ${entry}`);
      continue;
    }
    if (seen.has(normalized)) {
      errors.push(`duplicate archive entry: ${normalized}`);
      continue;
    }
    seen.add(normalized);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

async function listFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const result: string[] = [];
  for (const entry of (await readdir(currentDir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const entryPath = path.join(currentDir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new PetPackPackageError("unsafe-source", `source contains a symbolic link: ${entryPath}`);
    }
    if (entry.isDirectory()) {
      result.push(...await listFiles(rootDir, entryPath));
    } else if (entry.isFile()) {
      result.push(path.relative(rootDir, entryPath).split(path.sep).join("/"));
    } else {
      throw new PetPackPackageError("unsupported-source", `source contains a non-regular file: ${entryPath}`);
    }
  }
  return result;
}

export async function archiveDirectory(sourceDir: string, outputFile: string): Promise<void> {
  const source = path.resolve(sourceDir);
  const output = path.resolve(outputFile);
  const files = (await listFiles(source)).filter((file) => path.resolve(source, ...file.split("/")) !== output);
  if (files.length === 0) {
    throw new PetPackPackageError("empty-archive", `cannot create an archive from an empty directory: ${source}`);
  }
  const inspection = inspectArchiveEntries(files);
  if (!inspection.ok) throw new PetPackPackageError("unsafe-archive", "source contains unsafe archive entries", inspection.errors);
  const zip = await findCommand("zip");
  await mkdir(path.dirname(output), { recursive: true });
  await rm(output, { force: true });
  try {
    await execFileAsync(zip, ["-q", "-X", output, ...files.map((file) => `./${file}`)], { cwd: source, maxBuffer: 1024 * 1024 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PetPackPackageError("archive-failed", `failed to create .xmpet archive: ${detail}`);
  }
}

function parseArchiveListing(output: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(?:\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})\s+\d{2}:\d{2}\s+(.+)$/);
    if (!match) continue;
    const entryPath = match[2].trim();
    entries.push({ path: entryPath, size: Number(match[1]), isDirectory: entryPath.endsWith("/") });
  }
  return entries;
}

export async function listArchiveEntries(archiveFile: string): Promise<ArchiveEntry[]> {
  const unzip = await findCommand("unzip");
  try {
    const { stdout } = await execFileAsync(unzip, ["-l", archiveFile], { maxBuffer: 4 * 1024 * 1024 });
    const entries = parseArchiveListing(stdout);
    if (entries.length === 0) throw new PetPackPackageError("invalid-archive", "archive contains no readable entries");
    return entries;
  } catch (error) {
    if (error instanceof PetPackPackageError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new PetPackPackageError("invalid-archive", `failed to inspect .xmpet archive: ${detail}`);
  }
}

async function verifyExtractedTree(rootDir: string): Promise<void> {
  const root = await realpath(rootDir);
  const files = await listFiles(root);
  for (const relative of files) {
    const candidate = path.resolve(root, ...relative.split("/"));
    if (!isWithinDirectory(root, candidate) || (await lstat(candidate)).isSymbolicLink()) {
      throw new PetPackPackageError("unsafe-archive", `extracted archive contains an unsafe file: ${relative}`);
    }
  }
}

export async function extractArchive(
  archiveFile: string,
  destinationDir: string,
  limits: ArchiveLimits = {},
): Promise<ArchiveEntry[]> {
  const entries = await listArchiveEntries(archiveFile);
  const inspection = inspectArchiveEntries(entries.map((entry) => entry.path));
  if (!inspection.ok) throw new PetPackPackageError("unsafe-archive", "archive contains unsafe entries", inspection.errors);
  const files = entries.filter((entry) => !entry.isDirectory);
  const maxEntries = limits.maxEntries ?? MAX_ARCHIVE_ENTRIES;
  const maxBytes = limits.maxBytes ?? MAX_ARCHIVE_BYTES;
  const totalBytes = files.reduce((total, entry) => total + entry.size, 0);
  if (files.length > maxEntries || totalBytes > maxBytes) {
    throw new PetPackPackageError(
      "archive-limit",
      `archive exceeds limits (${files.length}/${maxEntries} files, ${totalBytes}/${maxBytes} bytes)`,
    );
  }
  const unzip = await findCommand("unzip");
  const destination = path.resolve(destinationDir);
  try {
    if ((await lstat(destination)).isSymbolicLink()) {
      throw new PetPackPackageError("unsafe-archive", "extraction destination must not be a symbolic link");
    }
  } catch (error) {
    if (error instanceof PetPackPackageError) throw error;
  }
  await mkdir(destination, { recursive: true });
  try {
    await execFileAsync(unzip, ["-q", "-o", archiveFile, "-d", destination], { maxBuffer: 1024 * 1024 });
    await verifyExtractedTree(destination);
  } catch (error) {
    if (error instanceof PetPackPackageError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new PetPackPackageError("extract-failed", `failed to extract .xmpet archive: ${detail}`);
  }
  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(value: unknown, key: string): string {
  if (!isRecord(value) || typeof value[key] !== "string" || value[key].trim() === "") {
    throw new PetPackPackageError("invalid-project", `pet-project.json requires ${key}`);
  }
  return value[key] as string;
}

async function readProject(projectDir: string): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await readFile(path.join(projectDir, "pet-project.json"), "utf8")) as unknown;
    if (!isRecord(value) || value.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
    const id = readRequiredString(value, "assetId");
    if (!SAFE_ID.test(id) || id.includes("..")) throw new Error("assetId must be a safe path segment");
    readRequiredString(value, "displayName");
    if (!Array.isArray(value.references) || !Array.isArray(value.actions)) throw new Error("references and actions must be arrays");
    return value;
  } catch (error) {
    if (error instanceof PetPackPackageError) throw error;
    throw new PetPackPackageError("invalid-project", `invalid pet-project.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function copyRuntimeFiles(projectDir: string, stagingDir: string): Promise<string[]> {
  const copied: string[] = [];
  for (const sourceRoot of ALLOWED_ASSET_ROOTS) {
    const sourceDir = path.join(projectDir, sourceRoot);
    try {
      const info = await lstat(sourceDir);
      if (!info.isDirectory()) throw new PetPackPackageError("invalid-project", `${sourceRoot} must be a directory`);
    } catch (error) {
      if (error instanceof PetPackPackageError) throw error;
      continue;
    }
    const sourceFiles = (await listFiles(sourceDir)).filter((relative) => !isForbiddenAuthoringPath(relative));
    const destinationRoot = path.join(stagingDir, "assets", sourceRoot === "assets" ? "" : sourceRoot);
    for (const relative of sourceFiles) {
      const source = path.join(sourceDir, ...relative.split("/"));
      const destination = path.join(destinationRoot, ...relative.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(source, destination);
      copied.push(path.relative(stagingDir, destination).split(path.sep).join("/"));
    }
  }
  return copied;
}

function isForbiddenAuthoringPath(relativePath: string): boolean {
  const parts = relativePath.split("/");
  return parts.some((part) => /^(?:references?|refs)$/i.test(part))
    || parts.some((part) => /^\.env(?:\..*)?$/i.test(part))
    || /(?:^|\/)(?:imagegen-jobs|jobs)\.json$/i.test(relativePath);
}

function mimeTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    ".json": "application/json",
    ".md": "text/markdown",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  } as Record<string, string>)[extension] ?? "application/octet-stream";
}

function kindFor(filePath: string): PetPackEntry["kind"] {
  if (path.extname(filePath).toLowerCase() === ".json") return "metadata";
  const name = path.basename(filePath).toLowerCase();
  if (name.includes("spritesheet")) return "spritesheet";
  if (name.includes("look")) return "look-atlas";
  if (name.includes("action") || name.includes("sleep")) return "action-atlas";
  if (name === "avatar.png") return "avatar";
  if (name === "tray.png") return "tray";
  return "metadata";
}

interface AssetGeometry {
  width?: number;
  height?: number;
  frameCount?: number;
  columns?: number;
  rows?: number;
}

/** Known atlas contracts let a generated pack work before its metadata is opened. */
function geometryFor(filePath: string): AssetGeometry {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  const name = path.basename(normalized);
  if (name === "spritesheet.webp") return { width: 1536, height: 2288, frameCount: 88, columns: 8, rows: 11 };
  if (name === "look-96.webp") return { width: 2304, height: 1664, frameCount: 96, columns: 12, rows: 8 };
  if (name === "look-16.webp") return { width: 1536, height: 416, frameCount: 16, columns: 8, rows: 2 };
  if (name === "idle-actions-30.webp" || name === "idle-actions.webp") {
    return { width: 1920, height: 1872, frameCount: 90, columns: 10, rows: 9 };
  }
  if (name === "sleeping-30.webp" || name === "sleeping.webp") {
    return { width: 1920, height: 624, frameCount: 30, columns: 10, rows: 3 };
  }
  if (name === "care-actions-30.webp" || name === "care-actions.webp") {
    return { width: 1920, height: 1248, frameCount: 60, columns: 10, rows: 6 };
  }
  if (name === "avatar.png" || name === "avatar.webp") return { width: 128, height: 128 };
  if (name === "tray.png" || name === "tray.webp") return { width: 32, height: 32 };
  return {};
}

async function createManifest(project: Record<string, unknown>, stagingDir: string, assetFiles: string[]): Promise<PetPackManifest> {
  const entries: PetPackEntry[] = [];
  const usedIds = new Set<string>();
  for (const [index, archivePath] of assetFiles.sort().entries()) {
    const relativePath = archivePath.slice("assets/".length);
    const filePath = path.join(stagingDir, ...archivePath.split("/"));
    const baseId = relativePath.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "asset";
    let entryId = baseId;
    let suffix = 2;
    while (usedIds.has(entryId)) entryId = `${baseId}-${suffix++}`;
    usedIds.add(entryId);
    entries.push({
      id: entryId || `asset-${index + 1}`,
      path: relativePath,
      kind: kindFor(relativePath),
      mimeType: mimeTypeFor(relativePath),
      checksumSha256: await sha256File(filePath),
      ...geometryFor(relativePath),
    });
  }
  const codexPresent = entries.some((entry) => entry.path === "codex/pet.json") && entries.some((entry) => entry.path === "codex/spritesheet.webp");
  const manifest: PetPackManifest = {
    schemaVersion: 1,
    id: project.assetId as string,
    name: project.displayName as string,
    version: typeof project.version === "string" && project.version.trim() ? project.version : "1.0.0",
    spriteVersionNumber: typeof project.spriteVersionNumber === "number" && Number.isSafeInteger(project.spriteVersionNumber) && project.spriteVersionNumber > 0
      ? project.spriteVersionNumber
      : 2,
    assetRoot: "assets",
    entries,
    compatibility: { desktop: true, codex: codexPresent },
    license: typeof project.license === "string" && project.license.trim() ? project.license : "UNLICENSED",
  };
  const validation = validatePetPackManifest(manifest);
  if (!validation.ok) throw new PetPackPackageError("invalid-project", "generated Pet Pack manifest is invalid", validation.errors.map((error) => error.message));
  return manifest;
}

function sanitizeJobs(value: unknown): unknown {
  if (!isRecord(value)) return {};
  const jobs = Array.isArray(value.jobs) ? value.jobs.filter(isRecord).map((job) => ({
    id: typeof job.id === "string" ? job.id : undefined,
    assetId: typeof job.assetId === "string" ? job.assetId : undefined,
    action: typeof job.action === "string" ? job.action : undefined,
    frameIndex: typeof job.frameIndex === "number" ? job.frameIndex : undefined,
    width: typeof job.width === "number" ? job.width : undefined,
    height: typeof job.height === "number" ? job.height : undefined,
    frameCount: typeof job.frameCount === "number" ? job.frameCount : undefined,
    outputPath: typeof job.outputPath === "string" ? job.outputPath : undefined,
  })) : [];
  return { schemaVersion: value.schemaVersion, assetId: value.assetId, actions: value.actions, jobs };
}

async function copyMetadata(projectDir: string, stagingDir: string): Promise<string[]> {
  const promptsDir = path.join(projectDir, "prompts");
  const result: string[] = [];
  try {
    const promptFiles = await listFiles(promptsDir);
    if (promptFiles.length === 0) throw new Error("prompts directory is empty");
    for (const relative of promptFiles) {
      const destination = path.join(stagingDir, "prompts", ...relative.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(promptsDir, ...relative.split("/")), destination);
      result.push(path.relative(stagingDir, destination).split(path.sep).join("/"));
    }
  } catch {
    throw new PetPackPackageError("invalid-project", "project must contain a prompts directory with generated prompts");
  }
  let jobsFile: string | undefined;
  for (const name of ["jobs.json", "imagegen-jobs.json"] as const) {
    const candidate = path.join(projectDir, name);
    try {
      if ((await stat(candidate)).isFile()) {
        jobsFile = candidate;
        break;
      }
    } catch {
      // Try the alternate generated jobs filename.
    }
  }
  if (!jobsFile) throw new PetPackPackageError("invalid-project", "project must contain jobs.json or imagegen-jobs.json");
  let jobs: unknown;
  try {
    jobs = JSON.parse(await readFile(jobsFile, "utf8"));
  } catch (error) {
    throw new PetPackPackageError("invalid-project", `invalid jobs manifest: ${error instanceof Error ? error.message : String(error)}`);
  }
  const jobsDestination = path.join(stagingDir, "metadata", "jobs.json");
  await mkdir(path.dirname(jobsDestination), { recursive: true });
  await writeFile(jobsDestination, `${JSON.stringify(sanitizeJobs(jobs), null, 2)}\n`, "utf8");
  result.push("metadata/jobs.json");
  return result;
}

export async function packPetProject(projectDir: string, outputFile: string): Promise<PackReport> {
  const projectRoot = path.resolve(projectDir);
  const output = path.resolve(outputFile);
  if (path.extname(output).toLowerCase() !== ".xmpet") {
    throw new PetPackPackageError("invalid-output", "output file must use the .xmpet extension");
  }
  const project = await readProject(projectRoot);
  const actualStaging = await mkdtemp(path.join(os.tmpdir(), "xiaoman-xmpet-stage-"));
  try {
    const assetFiles = await copyRuntimeFiles(projectRoot, actualStaging);
    if (assetFiles.length === 0) throw new PetPackPackageError("invalid-project", "project contains no runtime assets");
    const manifest = await createManifest(project, actualStaging, assetFiles);
    const validation = await validatePetPackFiles(manifest, actualStaging);
    if (!validation.ok) throw new PetPackPackageError("invalid-project", "runtime assets failed validation", validation.errors.map((error) => error.message));
    await writeFile(path.join(actualStaging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const metadataFiles = await copyMetadata(projectRoot, actualStaging);
    await archiveDirectory(actualStaging, output);
    return {
      id: manifest.id,
      name: manifest.name,
      outputFile: output,
      manifest,
      files: [...assetFiles, ...metadataFiles].sort(),
    };
  } finally {
    await rm(actualStaging, { recursive: true, force: true });
  }
}

const invokedScript = process.argv[1] ? path.basename(process.argv[1]) : "";
if (invokedScript === "pet-pack-package.ts" || invokedScript === "pet-pack-package.js") {
  const projectIndex = process.argv.indexOf("--project");
  const outputIndex = process.argv.indexOf("--output");
  const project = projectIndex >= 0 ? process.argv[projectIndex + 1] : undefined;
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  if (!project || !output) {
    process.stderr.write("Usage: pet-pack-package.ts --project <dir> --output <file.xmpet>\n");
    process.exitCode = 1;
  } else {
    packPetProject(project, output).then((report) => {
      process.stdout.write(`Packed ${report.id} to ${report.outputFile}\n`);
    }).catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
