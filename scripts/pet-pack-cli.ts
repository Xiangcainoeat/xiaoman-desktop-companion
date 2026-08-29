#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import {
  ACTION_NAMES,
  ACTION_TEMPLATES,
  buildJobsManifest,
  createReferenceMetadata,
  getConcurrency,
  renderPromptsJson,
  renderPromptsMarkdown,
  type ActionName,
  type JobsManifest,
  type PetPackProject,
  type ReferenceInput,
} from "./pet-pack-prompts";
import {
  extractArchive,
  listArchiveEntries,
  packPetProject,
  PetPackPackageError,
} from "./pet-pack-package";
import { PetPackService } from "../electron/pet-pack-service";
import { parsePetPackManifest } from "../src/pet-pack/manifest";
import { validatePetPackFiles } from "../src/pet-pack/files";
import {
  OpenAICompatibleImageProvider,
  runGenerationPlan,
  type GenerationReport,
  type ImageApiFetch,
} from "./pet-pack-generator";

export interface InitOptions {
  workspace: string;
  name: string;
  assetId?: string;
  references: ReferenceInput[];
  actions?: readonly ActionName[];
}

export interface PromptsOptions {
  project: string;
  actions?: readonly ActionName[];
}

export interface GenerateOptions {
  project: string;
  concurrency?: string | number;
  actions?: readonly ActionName[];
  dryRun?: boolean;
  execute?: boolean;
  provider?: string;
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  outputRoot?: string;
  overwrite?: boolean;
  fetchImpl?: ImageApiFetch;
}

export interface ValidateOptions {
  packageFile: string;
}

export interface PackOptions {
  project: string;
  output: string;
}

export interface InstallOptions {
  packageFile: string;
  userData?: string;
  activate?: boolean;
}

export interface GenerateResult {
  dryRun: boolean;
  apiKeyRequired: boolean;
  concurrency: number;
  manifestPath: string;
  manifest: JobsManifest;
  report?: GenerationReport;
}

export interface ValidateResult {
  packageFile: string;
  entries: number;
  bytes: number;
  manifestId: string;
  warnings: string[];
}

const TEMPLATE_ROOT = resolve(__dirname, "../templates/pet-pack");

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function projectFile(workspace: string): string {
  return join(workspace, "pet-project.json");
}

function readProject(workspace: string): PetPackProject {
  const project = JSON.parse(readFileSync(projectFile(workspace), "utf8")) as PetPackProject;
  if (project.schemaVersion !== 1 || !project.assetId || !Array.isArray(project.references)) {
    throw new Error(`invalid Pet Pack project: ${projectFile(workspace)}`);
  }
  return project;
}

function selectedActions(project: PetPackProject, actions?: readonly ActionName[]): ActionName[] {
  const selected = actions?.length ? [...actions] : project.actions?.length ? project.actions : [...ACTION_NAMES];
  for (const action of selected) {
    if (!(action in ACTION_TEMPLATES)) throw new Error(`unknown Pet Pack action: ${action}`);
  }
  return selected;
}

export async function init(options: InitOptions): Promise<PetPackProject> {
  if (!options.name.trim()) throw new Error("name is required");
  if (options.references.length === 0) throw new Error("at least one reference image is required");
  const workspace = resolve(options.workspace);
  const assetId = options.assetId || options.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pet";
  mkdirSync(workspace, { recursive: true });
  cpSync(TEMPLATE_ROOT, workspace, { recursive: true });
  const project: PetPackProject = {
    schemaVersion: 1,
    assetId,
    displayName: options.name.trim(),
    references: createReferenceMetadata(options.references),
    actions: options.actions?.length ? [...options.actions] : [...ACTION_NAMES],
  };
  writeJson(projectFile(workspace), project);
  return project;
}

export async function prompts(options: PromptsOptions): Promise<{
  markdownPath: string;
  jsonPath: string;
  actions: ActionName[];
}> {
  const workspace = resolve(options.project);
  const project = readProject(workspace);
  const actions = selectedActions(project, options.actions);
  const actionMap = Object.fromEntries(actions.map((action) => [action, ACTION_TEMPLATES[action]]));
  const outputDirectory = join(workspace, "prompts");
  mkdirSync(outputDirectory, { recursive: true });
  const markdownPath = join(outputDirectory, "pet-pack.md");
  const jsonPath = join(outputDirectory, "pet-pack.json");
  writeFileSync(markdownPath, renderPromptsMarkdown(actionMap), "utf8");
  writeFileSync(jsonPath, renderPromptsJson(actionMap), "utf8");
  return { markdownPath, jsonPath, actions };
}

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const workspace = resolve(options.project);
  const project = readProject(workspace);
  const concurrency = getConcurrency(options.concurrency);
  if (options.execute && options.dryRun) throw new Error("--execute and --dry-run cannot be used together");
  const providerName = options.provider || "openai-compatible";
  if (providerName !== "openai-compatible") throw new Error(`unknown image provider: ${providerName}`);
  const actions = selectedActions(project, options.actions);
  const manifest = buildJobsManifest({
    assetId: project.assetId,
    actions,
    references: project.references,
    concurrency,
  });
  const manifestPath = join(workspace, "jobs.json");
  writeJson(manifestPath, manifest);
  if (!options.execute) {
    return { dryRun: true, apiKeyRequired: false, concurrency, manifestPath, manifest };
  }

  const apiKey = options.apiKey || process.env.PET_IMAGE_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("--execute requires PET_IMAGE_API_KEY (or OPENAI_API_KEY); the key is read from the environment only");
  }
  const endpoint = options.apiUrl
    || process.env.PET_IMAGE_API_URL
    || process.env.OPENAI_BASE_URL
    || "https://api.openai.com/v1/images/generations";
  const model = options.model || process.env.PET_IMAGE_MODEL || "gpt-image-1";
  const provider = new OpenAICompatibleImageProvider({
    endpoint,
    apiKey,
    model,
    projectDir: workspace,
    fetchImpl: options.fetchImpl,
  });
  const report = await runGenerationPlan(manifest, provider, {
    projectDir: workspace,
    outputRoot: options.outputRoot,
    concurrency,
    overwrite: options.overwrite,
  });
  writeJson(join(workspace, "generation-report.json"), report);
  return { dryRun: false, apiKeyRequired: false, concurrency, manifestPath, manifest, report };
}

export async function validate(options: ValidateOptions): Promise<ValidateResult> {
  const packageFile = resolve(options.packageFile);
  const entries = await listArchiveEntries(packageFile);
  const temporary = mkdtempSync(join(tmpdir(), "xiaoman-pet-pack-validate-"));
  try {
    await extractArchive(packageFile, temporary);
    const manifestEntries = entries
      .filter((entry) => !entry.isDirectory)
      .map((entry) => entry.path)
      .filter((entryPath) => entryPath === "manifest.json" || entryPath === "pet-pack.json");
    if (manifestEntries.length !== 1) {
      throw new PetPackPackageError(
        "invalid-package",
        "archive must contain exactly one root manifest.json or pet-pack.json",
      );
    }
    const manifestPath = join(temporary, manifestEntries[0]);
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
    } catch (error) {
      throw new PetPackPackageError(
        "invalid-package",
        `cannot parse ${manifestEntries[0]}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const parsed = parsePetPackManifest(value);
    if (!parsed.ok || !parsed.manifest) {
      throw new PetPackPackageError(
        "invalid-package",
        "Pet Pack manifest failed schema validation",
        parsed.errors.map((error) => error.message),
      );
    }
    const files = await validatePetPackFiles(parsed.manifest, temporary);
    if (!files.ok) {
      throw new PetPackPackageError(
        "invalid-package",
        "Pet Pack files failed validation",
        files.errors.map((error) => error.message),
      );
    }
    return {
      packageFile,
      entries: entries.filter((entry) => !entry.isDirectory).length,
      bytes: entries.reduce((total, entry) => total + (entry.isDirectory ? 0 : entry.size), 0),
      manifestId: parsed.manifest.id,
      warnings: files.warnings.map((warning) => warning.message),
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export async function pack(options: PackOptions) {
  return packPetProject(options.project, options.output);
}

export async function install(options: InstallOptions) {
  const userData = resolve(options.userData || join(process.env.HOME || ".", "Library", "Application Support", "小满桌面伴侣"));
  const service = new PetPackService(userData);
  const summary = await service.importPackage(options.packageFile);
  if (options.activate) await service.setActive(summary.id);
  return summary;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export interface ParsedCli {
  command: "init" | "prompts" | "generate" | "validate" | "pack" | "install" | "help";
  options: Record<string, unknown>;
}

export function parseCliArgs(args: string[]): ParsedCli {
  const command = args[0] || "help";
  if (command === "help" || command === "--help" || command === "-h") return { command: "help", options: {} };
  if (command !== "init" && command !== "prompts" && command !== "generate" && command !== "validate" && command !== "pack" && command !== "install") {
    throw new Error(`unknown command: ${command}`);
  }
  const options: Record<string, unknown> = { references: [], roles: [] };
  const references = options.references as string[];
  const roles = options.roles as string[];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project" || arg === "--workspace" || arg === "--name" || arg === "--asset-id" || arg === "--concurrency" || arg === "--package" || arg === "--output" || arg === "--user-data" || arg === "--provider" || arg === "--api-url" || arg === "--model" || arg === "--output-root") {
      const key = ({
        "--asset-id": "assetId",
        "--user-data": "userData",
        "--package": "packageFile",
        "--api-url": "apiUrl",
        "--output-root": "outputRoot",
      } as Record<string, string>)[arg] || arg.slice(2);
      options[key] = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--refs") {
      let next = index + 1;
      while (next < args.length && !args[next].startsWith("--")) references.push(args[next++]);
      if (next === index + 1) throw new Error("--refs requires at least one path");
      index = next - 1;
    } else if (arg === "--ref") {
      references.push(requireValue(args, index, arg));
      index += 1;
    } else if (arg === "--ref-role") {
      roles.push(requireValue(args, index, arg));
      index += 1;
    } else if (arg === "--actions") {
      options.actions = requireValue(args, index, arg).split(",").filter(Boolean);
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--execute") {
      options.execute = true;
    } else if (arg === "--overwrite") {
      options.overwrite = true;
    } else if (arg === "--activate") {
      options.activate = true;
    } else if (arg === "--help" || arg === "-h") {
      return { command: "help", options: {} };
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return { command: command as ParsedCli["command"], options };
}

export function usage(): string {
  return [
    "Usage:",
    "  node scripts/pet-pack-cli.ts init --workspace <dir> --name <name> --refs <image> [image ...]",
    "  node scripts/pet-pack-cli.ts prompts --project <dir>",
    "  node scripts/pet-pack-cli.ts generate --project <dir> [--concurrency <1-6>] [--dry-run]",
    "  PET_IMAGE_API_KEY=... node scripts/pet-pack-cli.ts generate --project <dir> --execute [--provider openai-compatible]",
    "  node scripts/pet-pack-cli.ts validate --package <file.xmpet>",
    "  node scripts/pet-pack-cli.ts pack --project <dir> --output <file.xmpet>",
    "  node scripts/pet-pack-cli.ts install --package <file.xmpet> [--user-data <dir>] [--activate]",
    "",
    "Options:",
    "  --ref <image>       Add one reference image; may be repeated",
    "  --ref-role <role>   Role for the corresponding reference, default identity/supporting",
    "  --actions <a,b>     Limit prompts or jobs to comma-separated action ids",
    "  --concurrency <n>   Default 3, hard maximum 6",
    "  --execute           Call the configured image API; dry-run is the default",
    "  --provider <name>   Currently openai-compatible",
    "  --api-url <url>     Base URL or /images/generations endpoint",
    "  --model <name>      Default gpt-image-1",
    "  --output-root <dir> Write generated frames below this directory",
    "  --overwrite         Regenerate files that already exist",
    "",
    "Environment:",
    "  PET_IMAGE_API_KEY   Required for --execute (OPENAI_API_KEY is accepted)",
    "  PET_IMAGE_API_URL   Optional API base URL",
    "  PET_IMAGE_MODEL     Optional model name",
  ].join("\n");
}

export async function runCli(args: string[] = process.argv.slice(2)): Promise<void> {
  const parsed = parseCliArgs(args);
  if (parsed.command === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const options = parsed.options;
  const references = (options.references as string[]).map((path, index) => ({
    path,
    role: (options.roles as string[])[index],
  }));
  const actions = options.actions as ActionName[] | undefined;
  if (parsed.command === "init") {
    const workspace = String(options.workspace || options.project || "pet-pack-workspace");
    const name = String(options.name || options.assetId || "Pet Pack");
    const project = await init({ workspace, name, assetId: options.assetId as string | undefined, references, actions });
    process.stdout.write(`Initialized ${project.assetId} at ${resolve(workspace)}\n`);
  } else if (parsed.command === "prompts") {
    const project = String(options.project || ".");
    const result = await prompts({ project, actions });
    process.stdout.write(`Wrote ${result.markdownPath}\nWrote ${result.jsonPath}\n`);
  } else if (parsed.command === "generate") {
    const project = String(options.project || ".");
    const result = await generate({
      project,
      actions,
      concurrency: options.concurrency as string | undefined,
      dryRun: options.dryRun as boolean | undefined,
      execute: options.execute as boolean | undefined,
      provider: options.provider as string | undefined,
      apiUrl: options.apiUrl as string | undefined,
      model: options.model as string | undefined,
      outputRoot: options.outputRoot as string | undefined,
      overwrite: options.overwrite as boolean | undefined,
    });
    if (result.dryRun) {
      process.stdout.write(`Dry-run manifest: ${result.manifestPath}\nJobs: ${result.manifest.jobs.length}\nConcurrency: ${result.concurrency}\n`);
    } else {
      process.stdout.write(`Generated frames for ${result.manifest.assetId}\nJobs: ${result.manifest.jobs.length}\nCompleted: ${result.report?.completed ?? 0}\nSkipped: ${result.report?.skipped ?? 0}\nFailed: ${result.report?.failed ?? 0}\nConcurrency: ${result.concurrency}\n`);
    }
  } else if (parsed.command === "validate") {
    const result = await validate({ packageFile: String(options.packageFile || options.project || "") });
    process.stdout.write(`Valid .xmpet: ${result.packageFile}\nEntries: ${result.entries}\nBytes: ${result.bytes}\n`);
  } else if (parsed.command === "pack") {
    const result = await pack({ project: String(options.project || "."), output: String(options.output || "pet.xmpet") });
    process.stdout.write(`Packed ${result.id} to ${result.outputFile}\n`);
  } else {
    const result = await install({
      packageFile: String(options.packageFile || options.project || ""),
      userData: options.userData as string | undefined,
      activate: options.activate as boolean | undefined,
    });
    process.stdout.write(`Installed ${result.id}${options.activate ? " and activated" : ""}\n`);
  }
}

const invokedScript = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedScript === resolve(__filename)) {
  runCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
    process.exitCode = 1;
  });
}
