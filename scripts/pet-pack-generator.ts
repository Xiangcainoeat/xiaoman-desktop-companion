import { randomUUID } from "node:crypto";
import { readFile, rename, stat, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  getConcurrency,
  type JobsManifest,
  type PetPackJob,
  type ReferenceImageMetadata,
} from "./pet-pack-prompts";
import { safeRelativePath } from "../src/pet-pack/manifest";

const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

export interface ImageApiResponse {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ImageApiRequestInit {
  method: "POST" | "GET";
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}

export type ImageApiFetch = (url: string, init: ImageApiRequestInit) => Promise<ImageApiResponse>;

export interface ImageGenerationInput {
  job: PetPackJob;
  projectDir: string;
  references: readonly ReferenceImageMetadata[];
}

export interface ImageGenerationProvider {
  generate(input: ImageGenerationInput): Promise<Uint8Array>;
}

export interface OpenAICompatibleImageProviderOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  projectDir: string;
  fetchImpl?: ImageApiFetch;
  timeoutMs?: number;
  includeReferences?: boolean;
}

export interface GenerationFailure {
  jobId: string;
  outputPath: string;
  message: string;
}

export interface GenerationReport {
  attempted: number;
  completed: number;
  skipped: number;
  failed: number;
  maxActive: number;
  failures: GenerationFailure[];
}

export interface GenerationRunOptions {
  projectDir: string;
  outputRoot?: string;
  concurrency?: string | number;
  overwrite?: boolean;
}

export class ImageGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageGenerationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function imageMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  } as Record<string, string>)[extension] ?? "application/octet-stream";
}

function defaultFetch(url: string, init: ImageApiRequestInit): Promise<ImageApiResponse> {
  return fetch(url, init as RequestInit) as Promise<ImageApiResponse>;
}

function normalizedEndpoint(value: string): string {
  const endpoint = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new ImageGenerationError("image API URL must be an http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ImageGenerationError("image API URL must use http or https");
  }
  return endpoint.replace(/\/$/, "").endsWith("/images/generations")
    ? endpoint.replace(/\/$/, "")
    : `${endpoint.replace(/\/$/, "")}/images/generations`;
}

function readBase64(value: string): Uint8Array {
  const match = value.match(/^data:[^;]+;base64,(.+)$/s);
  const encoded = match ? match[1] : value;
  try {
    const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
    if (bytes.length === 0) throw new Error("empty image");
    return bytes;
  } catch {
    throw new ImageGenerationError("image API returned invalid base64 image data");
  }
}

async function responseBytes(response: ImageApiResponse): Promise<Uint8Array> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new ImageGenerationError("image API returned an empty image");
  if (bytes.length > MAX_RESPONSE_BYTES) throw new ImageGenerationError("image API response is too large");
  return bytes;
}

function imageCandidate(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const data = payload.data;
  if (Array.isArray(data) && data.length > 0 && isRecord(data[0])) {
    for (const key of ["b64_json", "base64", "image"] as const) {
      if (typeof data[0][key] === "string") return data[0][key] as string;
    }
    if (typeof data[0].url === "string") return data[0].url as string;
  }
  for (const key of ["image", "b64_json", "base64"] as const) {
    if (typeof payload[key] === "string") return payload[key] as string;
  }
  if (Array.isArray(payload.images) && typeof payload.images[0] === "string") return payload.images[0] as string;
  return null;
}

async function readReference(projectDir: string, reference: ReferenceImageMetadata): Promise<{
  role: string;
  mimeType: string;
  data: string;
}> {
  const filePath = path.resolve(projectDir, reference.path);
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    throw new ImageGenerationError(`reference image is not readable: ${reference.path}`);
  }
  if (bytes.length === 0) throw new ImageGenerationError(`reference image is empty: ${reference.path}`);
  if (bytes.length > MAX_REFERENCE_BYTES) throw new ImageGenerationError(`reference image is too large: ${reference.path}`);
  return {
    role: reference.role,
    mimeType: imageMimeType(filePath),
    data: bytes.toString("base64"),
  };
}

export class OpenAICompatibleImageProvider implements ImageGenerationProvider {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly projectDir: string;
  private readonly fetchImpl: ImageApiFetch;
  private readonly timeoutMs: number;
  private readonly includeReferences: boolean;

  constructor(options: OpenAICompatibleImageProviderOptions) {
    if (!options.apiKey.trim()) throw new ImageGenerationError("an image API key is required for --execute");
    if (!options.model.trim()) throw new ImageGenerationError("image API model must not be empty");
    this.endpoint = normalizedEndpoint(options.endpoint);
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.projectDir = path.resolve(options.projectDir);
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 120_000, 600_000));
    this.includeReferences = options.includeReferences ?? true;
  }

  async generate(input: ImageGenerationInput): Promise<Uint8Array> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const references = this.includeReferences
        ? await Promise.all(input.references.map((reference) => readReference(this.projectDir, reference)))
        : [];
      const body: Record<string, unknown> = {
        model: this.model,
        prompt: `${input.job.prompt}\nThis is frame ${input.job.frameIndex + 1} of ${input.job.frameCount}; preserve the same camera, scale, and registration as every other frame.`,
        negative_prompt: input.job.negativePrompt,
        size: `${input.job.width}x${input.job.height}`,
        n: 1,
        response_format: "b64_json",
      };
      if (references.length > 0) body.reference_images = references.map((reference) => ({
        role: reference.role,
        mimeType: reference.mimeType,
        data: `data:${reference.mimeType};base64,${reference.data}`,
      }));

      let response: ImageApiResponse;
      try {
        response = await this.fetchImpl(this.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json, image/*",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) throw new ImageGenerationError("image API request timed out");
        throw new ImageGenerationError(`image API request failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (!response.ok) {
        throw new ImageGenerationError(`image API returned HTTP ${response.status}`);
      }
      const contentType = response.headers?.get("content-type")?.toLowerCase() ?? "";
      if (contentType.startsWith("image/")) return responseBytes(response);
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ImageGenerationError("image API returned neither an image nor valid JSON");
      }
      const candidate = imageCandidate(payload);
      if (!candidate) throw new ImageGenerationError("image API response did not contain an image");
      if (candidate.startsWith("data:")) return readBase64(candidate);
      if (/^https?:\/\//i.test(candidate)) {
        const imageResponse = await this.fetchImpl(candidate, {
          method: "GET",
          headers: { Accept: "image/*" },
          signal: controller.signal,
        });
        if (!imageResponse.ok) throw new ImageGenerationError("image API image URL could not be downloaded");
        return responseBytes(imageResponse);
      }
      return readBase64(candidate);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isWithinDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function outputPath(outputRoot: string, relativePath: string): string {
  const safe = safeRelativePath(relativePath);
  if (!safe) throw new ImageGenerationError(`job output path is unsafe: ${relativePath}`);
  const resolvedRoot = path.resolve(outputRoot);
  const resolved = path.resolve(resolvedRoot, ...safe.split("/"));
  if (!isWithinDirectory(resolvedRoot, resolved)) throw new ImageGenerationError(`job output path escapes output root: ${relativePath}`);
  return resolved;
}

async function existsAsFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function writeAtomic(filePath: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Run frame jobs with a hard concurrency ceiling and no partial target files. */
export async function runGenerationPlan(
  plan: JobsManifest,
  provider: ImageGenerationProvider,
  options: GenerationRunOptions,
): Promise<GenerationReport> {
  const concurrency = getConcurrency(options.concurrency ?? plan.concurrency);
  const outputRoot = path.resolve(options.outputRoot ?? options.projectDir);
  const results: Array<"completed" | "skipped" | GenerationFailure | undefined> = new Array(plan.jobs.length);
  let cursor = 0;
  let active = 0;
  let maxActive = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= plan.jobs.length) return;
      const job = plan.jobs[index];
      const target = outputPath(outputRoot, job.outputPath);
      if (!options.overwrite && await existsAsFile(target)) {
        results[index] = "skipped";
        continue;
      }
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        const bytes = await provider.generate({ job, projectDir: options.projectDir, references: job.references });
        if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
          throw new ImageGenerationError("provider returned an empty image");
        }
        await writeAtomic(target, bytes);
        results[index] = "completed";
      } catch (error) {
        results[index] = {
          jobId: job.id,
          outputPath: job.outputPath,
          message: error instanceof Error ? error.message : String(error),
        };
      } finally {
        active -= 1;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, plan.jobs.length) }, () => worker()));
  const failures = results.filter((result): result is GenerationFailure => typeof result === "object");
  return {
    attempted: results.filter((result) => result !== "skipped" && result !== undefined).length,
    completed: results.filter((result) => result === "completed").length,
    skipped: results.filter((result) => result === "skipped").length,
    failed: failures.length,
    maxActive,
    failures,
  };
}
