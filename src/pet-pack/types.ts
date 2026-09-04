export const PET_PACK_SCHEMA_VERSION = 1 as const;

export const PET_PACK_ENTRY_KINDS = [
  "spritesheet",
  "look-atlas",
  "action-atlas",
  "avatar",
  "tray",
  "metadata",
] as const;

export type PetPackEntryKind = (typeof PET_PACK_ENTRY_KINDS)[number];

export interface PetPackEntry {
  id: string;
  path: string;
  kind: PetPackEntryKind;
  mimeType: string;
  width?: number;
  height?: number;
  frameCount?: number;
  columns?: number;
  rows?: number;
  checksumSha256?: string;
  source?: string;
  promptFile?: string;
  /** Optional assets may fall back to the bundled profile when absent. */
  optional?: boolean;
}

export interface PetPackCompatibility {
  codex?: boolean | Record<string, unknown>;
  desktop?: boolean | Record<string, unknown>;
  [key: string]: unknown;
}

export interface PetPackManifest {
  schemaVersion: typeof PET_PACK_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  spriteVersionNumber: number;
  assetRoot: string;
  entries: PetPackEntry[];
  compatibility: PetPackCompatibility;
  license: string;
}

export interface PetPackValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface PetPackValidationResult {
  ok: boolean;
  errors: PetPackValidationIssue[];
  warnings: PetPackValidationIssue[];
}

export interface PetPackParseResult extends PetPackValidationResult {
  manifest?: PetPackManifest;
}

export interface PetPackManifestValidationOptions {
  requireCodex?: boolean;
}
