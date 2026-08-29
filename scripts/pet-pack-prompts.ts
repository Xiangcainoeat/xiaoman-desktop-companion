import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const DEFAULT_CONCURRENCY = 3;
export const MAX_CONCURRENCY = 6;

export const ACTION_NAMES = [
  "standard",
  "look-atlas",
  "idle-lick",
  "idle-blink",
  "idle-scratch",
  "sleeping",
  "care-feed",
  "care-bath",
  "running-left",
  "running-right",
  "jumping",
  "avatar",
  "tray",
] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

export interface CanvasSpec {
  width: number;
  height: number;
}

export interface ActionTemplate {
  id: ActionName;
  prompt: string;
  negativePrompt: string;
  frameCount: number;
  canvas: CanvasSpec;
  transparentBackground: boolean;
  referenceRoles: string[];
}

export interface ReferenceInput {
  path: string;
  role?: string;
}

export interface ReferenceImageMetadata {
  path: string;
  sha256: string;
  role: string;
}

export interface PetPackProject {
  schemaVersion: 1;
  assetId: string;
  displayName: string;
  references: ReferenceImageMetadata[];
  actions: ActionName[];
}

export interface PetPackJob {
  id: string;
  assetId: string;
  action: ActionName;
  frameIndex: number;
  width: number;
  height: number;
  frameCount: number;
  prompt: string;
  negativePrompt: string;
  references: ReferenceImageMetadata[];
  outputPath: string;
}

export interface JobsManifest {
  schemaVersion: 1;
  assetId: string;
  dryRun: true;
  concurrency: number;
  references: ReferenceImageMetadata[];
  actions: ActionName[];
  jobs: PetPackJob[];
}

const COMMON_PROMPT = "Keep the same canonical pet identity, markings, palette, proportions, face, and material details from the identity references.";
const COMMON_NEGATIVE = "no text, no logo, no watermark, no extra characters, no duplicate pet, no cropped subject, no changed markings, no hidden RGB in transparent pixels";

function template(
  id: ActionName,
  prompt: string,
  frameCount: number,
  canvas: CanvasSpec,
  referenceRoles: string[],
): ActionTemplate {
  return {
    id,
    prompt: `${COMMON_PROMPT} ${prompt} Render every frame as a clean, centered, fully visible sprite on a stable canvas.`,
    negativePrompt: `${COMMON_NEGATIVE}, unstable framing, inconsistent scale, motion blur, detached effects, floor shadow, background clutter.`,
    frameCount,
    canvas,
    transparentBackground: true,
    referenceRoles,
  };
}

const SPRITE_CANVAS = { width: 192, height: 208 };

export const ACTION_TEMPLATES: Readonly<Record<ActionName, ActionTemplate>> = {
  standard: template(
    "standard",
    "Create the complete standard Codex pet atlas: eleven ordered action rows, eight fixed slots per row, with calm idle, directional running, greeting, jumping, failed, waiting, working, review, and sixteen look-direction cells.",
    88,
    { width: 1536, height: 2288 },
    ["identity"],
  ),
  "look-atlas": template(
    "look-atlas",
    "Create a 96-frame full-body look atlas at stable 3.75-degree clockwise direction steps. Keep the feet and body registration consistent while the head, eyes, ears, and body orientation turn as one coherent pose.",
    96,
    SPRITE_CANVAS,
    ["identity", "body"],
  ),
  "idle-lick": template(
    "idle-lick",
    "Create a 30-frame quiet idle licking loop: subtle breathing and a natural tongue or muzzle lick, with the pet planted in place and the first and last frames close for a seamless loop.",
    30,
    SPRITE_CANVAS,
    ["identity"],
  ),
  "idle-blink": template(
    "idle-blink",
    "Create a 30-frame quiet idle blink loop: preserve the resting pose while eyelids close and reopen naturally with tiny breathing motion and no large gesture.",
    30,
    SPRITE_CANVAS,
    ["identity"],
  ),
  "idle-scratch": template(
    "idle-scratch",
    "Create a 30-frame quiet idle scratching loop: a restrained raised-paw scratch that returns to the planted resting pose while preserving the silhouette and identity.",
    30,
    SPRITE_CANVAS,
    ["identity"],
  ),
  sleeping: template(
    "sleeping",
    "Create a 30-frame curled sleeping loop with gentle breathing, closed eyes, stable curled silhouette, and a quiet resting posture.",
    30,
    SPRITE_CANVAS,
    ["identity", "body"],
  ),
  "care-feed": template(
    "care-feed",
    "Create a 30-frame care-feeding loop: the pet notices food, takes small natural bites, and settles contentedly without changing identity or adding an unrequested prop.",
    30,
    SPRITE_CANVAS,
    ["identity", "body"],
  ),
  "care-bath": template(
    "care-bath",
    "Create a 30-frame care-bath loop: the pet performs small readable grooming and washing motions, stays centered, and returns smoothly to its neutral posture.",
    30,
    SPRITE_CANVAS,
    ["identity", "body"],
  ),
  "running-left": template(
    "running-left",
    "Create an 8-frame grounded running loop traveling left. Show leftward movement through alternating body and limb poses only, with no speed lines, dust, trails, or detached effects.",
    8,
    SPRITE_CANVAS,
    ["identity", "body"],
  ),
  "running-right": template(
    "running-right",
    "Create an 8-frame grounded running loop traveling right. Show rightward movement through alternating body and limb poses only, with no speed lines, dust, trails, or detached effects.",
    8,
    SPRITE_CANVAS,
    ["identity", "body"],
  ),
  jumping: template(
    "jumping",
    "Create an 8-frame playful jump loop with anticipation, lift, airborne peak, descent, and settle. Communicate height through the pet pose and position only.",
    8,
    SPRITE_CANVAS,
    ["identity", "body"],
  ),
  avatar: template(
    "avatar",
    "Create one square 128 by 128 profile avatar showing the canonical pet clearly, centered with a readable face and complete silhouette.",
    1,
    { width: 128, height: 128 },
    ["identity"],
  ),
  tray: template(
    "tray",
    "Create one square 32 by 32 menu-bar tray icon with a simple, high-contrast readable crop of the canonical pet.",
    1,
    { width: 32, height: 32 },
    ["identity"],
  ),
};

function isActionName(value: string): value is ActionName {
  return (ACTION_NAMES as readonly string[]).includes(value);
}

function assertAssetId(assetId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(assetId) || assetId.includes("..")) {
    throw new Error(`asset id must be a safe path segment: ${assetId}`);
  }
}

export function getConcurrency(value: string | number | undefined): number {
  if (value === undefined) return DEFAULT_CONCURRENCY;
  const concurrency = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new Error(`concurrency must be an integer from 1 to ${MAX_CONCURRENCY}`);
  }
  return concurrency;
}

export function createReferenceMetadata(references: ReferenceInput[]): ReferenceImageMetadata[] {
  return references.map((reference, index) => {
    if (!reference.path.trim()) throw new Error("reference image path must not be empty");
    const role = reference.role?.trim() || (index === 0 ? "identity" : "supporting");
    if (!role) throw new Error(`reference role is empty for ${reference.path}`);
    return {
      path: reference.path,
      sha256: createHash("sha256").update(readFileSync(reference.path)).digest("hex"),
      role,
    };
  });
}

function stableJobId(job: Omit<PetPackJob, "id">): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([
      job.assetId,
      job.action,
      job.frameIndex,
      job.prompt,
      job.negativePrompt,
      job.references,
      job.outputPath,
    ]))
    .digest("hex")
    .slice(0, 12);
  return `${job.assetId}-${job.action}-${String(job.frameIndex).padStart(3, "0")}-${digest}`;
}

export function buildJobsManifest(options: {
  assetId: string;
  actions?: readonly string[];
  references: ReferenceImageMetadata[];
  concurrency?: string | number;
}): JobsManifest {
  assertAssetId(options.assetId);
  const actions = (options.actions?.length ? options.actions : ACTION_NAMES).map((action) => {
    if (!isActionName(action)) throw new Error(`unknown Pet Pack action: ${action}`);
    return action;
  });
  const concurrency = getConcurrency(options.concurrency);
  const jobs: PetPackJob[] = [];
  for (const action of actions) {
    const definition = ACTION_TEMPLATES[action];
    for (let frameIndex = 0; frameIndex < definition.frameCount; frameIndex += 1) {
      const jobWithoutId = {
        assetId: options.assetId,
        action,
        frameIndex,
        width: definition.canvas.width,
        height: definition.canvas.height,
        frameCount: definition.frameCount,
        prompt: definition.prompt,
        negativePrompt: definition.negativePrompt,
        references: options.references,
        outputPath: `frames/${options.assetId}/${action}-${String(frameIndex).padStart(3, "0")}.png`,
      } satisfies Omit<PetPackJob, "id">;
      jobs.push({ ...jobWithoutId, id: stableJobId(jobWithoutId) });
    }
  }
  return {
    schemaVersion: 1,
    assetId: options.assetId,
    dryRun: true,
    concurrency,
    references: options.references,
    actions,
    jobs,
  };
}

export function renderPromptsMarkdown(
  actions: Readonly<Record<string, ActionTemplate>> = ACTION_TEMPLATES,
): string {
  const sections = Object.entries(actions).map(([name, action]) => [
    `## ${name}`,
    "",
    `- Frames: ${action.frameCount}`,
    `- Canvas: ${action.canvas.width}x${action.canvas.height}`,
    `- Transparent background: ${action.transparentBackground ? "yes" : "no"}`,
    `- Reference roles: ${action.referenceRoles.join(", ")}`,
    "",
    "### Prompt",
    "",
    action.prompt,
    "",
    "### Negative prompt",
    "",
    action.negativePrompt,
  ].join("\n"));
  return `# Pet Pack Prompts\n\n${sections.join("\n\n")}\n`;
}

export function renderPromptsJson(
  actions: Readonly<Record<string, ActionTemplate>> = ACTION_TEMPLATES,
): string {
  return `${JSON.stringify(actions, null, 2)}\n`;
}
