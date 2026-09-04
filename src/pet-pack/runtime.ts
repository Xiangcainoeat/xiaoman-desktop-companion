import type { PetPackAssetInfo, PetPackRuntime } from "../shared/types";
import type { PetPackEntry } from "./types";

/** The immutable profile shipped inside the desktop application. */
export const BUNDLED_PET_PACK_ID = "xiaoman-bundled";

/** Stable IDs used by the renderer and by the authoring manifest. */
export const PET_ASSET_IDS = [
  "codex-pet",
  "codex-spritesheet",
  "native-look-atlas",
  "native-look-metadata",
  "enhanced-pet",
  "enhanced-spritesheet",
  "enhanced-look-atlas",
  "enhanced-look-metadata",
  "idle-actions",
  "idle-actions-metadata",
  "sleeping-actions",
  "sleeping-actions-metadata",
  "care-actions",
  "care-actions-metadata",
  "avatar",
  "tray",
] as const;

export type PetAssetId = (typeof PET_ASSET_IDS)[number];

interface BundledAssetDefinition extends Omit<PetPackAssetInfo, "url"> {
  url: string;
}

const BUNDLED_ASSETS: readonly BundledAssetDefinition[] = [
  { id: "codex-pet", kind: "metadata", path: "native/pet.json", url: "./pet/native/pet.json" },
  {
    id: "codex-spritesheet",
    kind: "spritesheet",
    path: "native/spritesheet.webp",
    url: "./pet/native/spritesheet.webp",
    width: 1536,
    height: 2288,
    frameCount: 88,
    columns: 8,
    rows: 11,
  },
  {
    id: "native-look-atlas",
    kind: "look-atlas",
    path: "native/look-16.webp",
    url: "./pet/native/look-16.webp",
    width: 1536,
    height: 416,
    frameCount: 16,
    columns: 8,
    rows: 2,
  },
  {
    id: "native-look-metadata",
    kind: "metadata",
    path: "native/look-16.json",
    url: "./pet/native/look-16.json",
  },
  { id: "enhanced-pet", kind: "metadata", path: "pet.json", url: "./pet/pet.json" },
  {
    id: "enhanced-spritesheet",
    kind: "spritesheet",
    path: "spritesheet.webp",
    url: "./pet/spritesheet.webp",
    width: 1536,
    height: 2288,
    frameCount: 88,
    columns: 8,
    rows: 11,
  },
  {
    id: "enhanced-look-atlas",
    kind: "look-atlas",
    path: "look-96.webp",
    url: "./pet/look-96.webp",
    width: 2304,
    height: 1664,
    frameCount: 96,
    columns: 12,
    rows: 8,
  },
  {
    id: "enhanced-look-metadata",
    kind: "metadata",
    path: "look-96.json",
    url: "./pet/look-96.json",
    frameCount: 96,
    columns: 12,
    rows: 8,
  },
  {
    id: "idle-actions",
    kind: "action-atlas",
    path: "idle-actions-30.webp",
    url: "./pet/idle-actions-30.webp",
    width: 1920,
    height: 1872,
    frameCount: 30,
    columns: 10,
    rows: 9,
  },
  { id: "idle-actions-metadata", kind: "metadata", path: "idle-actions-30.json", url: "./pet/idle-actions-30.json" },
  {
    id: "sleeping-actions",
    kind: "action-atlas",
    path: "sleeping-30.webp",
    url: "./pet/sleeping-30.webp",
    width: 1920,
    height: 624,
    frameCount: 30,
    columns: 10,
    rows: 3,
  },
  { id: "sleeping-actions-metadata", kind: "metadata", path: "sleeping-30.json", url: "./pet/sleeping-30.json" },
  {
    id: "care-actions",
    kind: "action-atlas",
    path: "care-actions-30.webp",
    url: "./pet/care-actions-30.webp",
    width: 1920,
    height: 1248,
    frameCount: 30,
    columns: 10,
    rows: 6,
  },
  { id: "care-actions-metadata", kind: "metadata", path: "care-actions-30.json", url: "./pet/care-actions-30.json" },
  { id: "avatar", kind: "avatar", path: "avatar.png", url: "./pet/avatar.png", width: 128, height: 128 },
  { id: "tray", kind: "tray", path: "tray.png", url: "./pet/tray.png", width: 32, height: 32 },
];

/**
 * Convert authoring-friendly paths into the stable IDs consumed by the app.
 * Custom packs may use either the canonical ID or a descriptive filename; the
 * path mapping keeps older/generated packs interoperable without aliases in
 * every renderer component.
 */
export function canonicalPetAssetId(entry: Pick<PetPackEntry, "id" | "path">): string {
  if ((PET_ASSET_IDS as readonly string[]).includes(entry.id)) return entry.id;
  const normalized = entry.path.replaceAll("\\", "/").toLowerCase();
  const name = normalized.split("/").pop() ?? normalized;
  if (normalized === "codex/pet.json" || name === "pet.json" && normalized.startsWith("codex/")) return "codex-pet";
  if (normalized === "codex/spritesheet.webp" || name === "spritesheet.webp" && normalized.startsWith("codex/")) return "codex-spritesheet";
  if (name === "pet.json" && !normalized.startsWith("codex/")) return "enhanced-pet";
  if (name === "spritesheet.webp" && !normalized.startsWith("codex/")) return "enhanced-spritesheet";
  if (normalized.includes("native") && normalized.includes("look") && normalized.endsWith(".webp")) return "native-look-atlas";
  if (normalized.includes("native") && normalized.includes("look") && normalized.endsWith(".json")) return "native-look-metadata";
  if (name === "look-96.webp" || name === "look.webp" && !normalized.includes("native")) return "enhanced-look-atlas";
  if (name === "look-96.json" || name === "look.json" && !normalized.includes("native")) return "enhanced-look-metadata";
  if (name.includes("idle") && name.endsWith(".webp")) return "idle-actions";
  if (name.includes("idle") && name.endsWith(".json")) return "idle-actions-metadata";
  if (name.includes("sleep") && name.endsWith(".webp")) return "sleeping-actions";
  if (name.includes("sleep") && name.endsWith(".json")) return "sleeping-actions-metadata";
  if ((name.includes("care") || name.includes("bath") || name.includes("feed")) && name.endsWith(".webp")) return "care-actions";
  if ((name.includes("care") || name.includes("bath") || name.includes("feed")) && name.endsWith(".json")) return "care-actions-metadata";
  if (name === "avatar.png" || name === "avatar.webp") return "avatar";
  if (name === "tray.png" || name === "tray.webp") return "tray";
  return entry.id;
}

export function createPetPackRuntimeFromEntries(
  id: string,
  entries: readonly PetPackEntry[],
  resolveUrl: (entry: PetPackEntry) => string,
  warnings: string[] = [],
): PetPackRuntime {
  const assets: PetPackAssetInfo[] = entries.map((entry) => ({
    id: canonicalPetAssetId(entry),
    kind: entry.kind,
    path: entry.path,
    url: resolveUrl(entry),
    ...(entry.width === undefined ? {} : { width: entry.width }),
    ...(entry.height === undefined ? {} : { height: entry.height }),
    ...(entry.frameCount === undefined ? {} : { frameCount: entry.frameCount }),
    ...(entry.columns === undefined ? {} : { columns: entry.columns }),
    ...(entry.rows === undefined ? {} : { rows: entry.rows }),
    ...(entry.optional === undefined ? {} : { optional: entry.optional }),
  }));
  const duplicateIds = new Set<string>();
  const deduplicated = assets.filter((asset) => {
    if (duplicateIds.has(asset.id)) return false;
    duplicateIds.add(asset.id);
    return true;
  });
  return { id, assets: deduplicated, warnings: [...warnings] };
}

export function createBundledPetPackRuntime(): PetPackRuntime {
  return {
    id: BUNDLED_PET_PACK_ID,
    assets: BUNDLED_ASSETS.map((asset) => ({ ...asset })),
    warnings: [],
  };
}

export function findPetPackAsset(
  runtime: PetPackRuntime,
  assetId: string,
): PetPackAssetInfo | undefined {
  return runtime.assets.find((asset) => asset.id === assetId);
}

export function resolvePetAssetUrl(
  runtime: PetPackRuntime | null | undefined,
  assetId: string,
  fallbackUrl: string,
): string {
  return findPetPackAsset(runtime ?? createBundledPetPackRuntime(), assetId)?.url ?? fallbackUrl;
}
