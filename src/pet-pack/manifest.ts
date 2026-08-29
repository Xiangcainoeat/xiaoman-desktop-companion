import {
  PET_PACK_ENTRY_KINDS,
  PET_PACK_SCHEMA_VERSION,
  type PetPackEntry,
  type PetPackManifest,
  type PetPackManifestValidationOptions,
  type PetPackParseResult,
  type PetPackValidationIssue,
  type PetPackValidationResult,
} from "./types";

export type {
  PetPackCompatibility,
  PetPackEntry,
  PetPackEntryKind,
  PetPackManifest,
  PetPackManifestValidationOptions,
  PetPackParseResult,
  PetPackValidationIssue,
  PetPackValidationResult,
} from "./types";

const SHA256_PATTERN = /^[a-f\d]{64}$/i;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MIME_TYPE_PATTERN = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;

function issue(
  code: string,
  message: string,
  path?: string,
): PetPackValidationIssue {
  return path === undefined ? { code, message } : { code, message, path };
}

function result(
  errors: PetPackValidationIssue[],
  warnings: PetPackValidationIssue[] = [],
): PetPackValidationResult {
  return { ok: errors.length === 0, errors, warnings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isCodexDeclared(manifest: Record<string, unknown>): boolean {
  const compatibility = manifest.compatibility;
  if (!isRecord(compatibility) || compatibility.codex === undefined) {
    return false;
  }
  return compatibility.codex !== false;
}

export function safeRelativePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    return null;
  }
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")) {
    return null;
  }

  const parts = value.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === ".." || part.includes("\\"))) {
    return null;
  }
  return value;
}

function validateEntry(
  value: unknown,
  index: number,
  ids: Set<string>,
  paths: Set<string>,
): PetPackValidationIssue[] {
  const errors: PetPackValidationIssue[] = [];
  const entryPath = `entries[${index}]`;
  if (!isRecord(value)) {
    return [issue("invalid-entry", `${entryPath} must be an object`, entryPath)];
  }

  if (!isNonEmptyString(value.id) || !ID_PATTERN.test(value.id)) {
    errors.push(issue("invalid-entry-id", `${entryPath}.id must be a stable identifier`, `${entryPath}.id`));
  } else if (ids.has(value.id)) {
    errors.push(issue("duplicate-entry-id", `duplicate entry id: ${value.id}`, `${entryPath}.id`));
  } else {
    ids.add(value.id);
  }

  const safePath = safeRelativePath(value.path);
  if (safePath === null) {
    errors.push(issue("unsafe-path", `${entryPath}.path must be a safe relative path`, `${entryPath}.path`));
  } else if (paths.has(safePath)) {
    errors.push(issue("duplicate-entry-path", `duplicate entry path: ${safePath}`, `${entryPath}.path`));
  } else {
    paths.add(safePath);
  }

  if (!PET_PACK_ENTRY_KINDS.includes(value.kind as PetPackEntry["kind"])) {
    errors.push(issue("invalid-entry-kind", `${entryPath}.kind is not supported`, `${entryPath}.kind`));
  }
  if (!isNonEmptyString(value.mimeType) || !MIME_TYPE_PATTERN.test(value.mimeType)) {
    errors.push(issue("invalid-mime-type", `${entryPath}.mimeType must be a MIME type`, `${entryPath}.mimeType`));
  }

  for (const field of ["width", "height"] as const) {
    if (value[field] !== undefined && !isPositiveInteger(value[field])) {
      errors.push(issue("invalid-dimension", `${entryPath}.${field} must be a positive integer`, `${entryPath}.${field}`));
    }
  }
  if (value.frameCount !== undefined && !isPositiveInteger(value.frameCount)) {
    errors.push(issue("invalid-frame-count", `${entryPath}.frameCount must be a positive integer`, `${entryPath}.frameCount`));
  }
  for (const field of ["columns", "rows"] as const) {
    if (value[field] !== undefined && !isPositiveInteger(value[field])) {
      errors.push(issue("invalid-grid", `${entryPath}.${field} must be a positive integer`, `${entryPath}.${field}`));
    }
  }
  if (isPositiveInteger(value.frameCount) && isPositiveInteger(value.columns) && isPositiveInteger(value.rows)
    && value.frameCount > value.columns * value.rows) {
    errors.push(issue("invalid-frame-grid", `${entryPath}.frameCount exceeds its grid`, `${entryPath}.frameCount`));
  }

  if (value.checksumSha256 !== undefined
    && (typeof value.checksumSha256 !== "string" || !SHA256_PATTERN.test(value.checksumSha256))) {
    errors.push(issue("invalid-sha256", `${entryPath}.checksumSha256 must be 64 hexadecimal characters`, `${entryPath}.checksumSha256`));
  }
  for (const field of ["source", "promptFile"] as const) {
    if (value[field] !== undefined && !isNonEmptyString(value[field])) {
      errors.push(issue("invalid-entry-field", `${entryPath}.${field} must be a non-empty string`, `${entryPath}.${field}`));
    }
  }
  if (value.promptFile !== undefined && safeRelativePath(value.promptFile) === null) {
    errors.push(issue("unsafe-path", `${entryPath}.promptFile must be a safe relative path`, `${entryPath}.promptFile`));
  }
  if (value.optional !== undefined && typeof value.optional !== "boolean") {
    errors.push(issue("invalid-optional", `${entryPath}.optional must be a boolean`, `${entryPath}.optional`));
  }
  return errors;
}

export function validatePetPackManifest(
  value: unknown,
  options: PetPackManifestValidationOptions = {},
): PetPackValidationResult {
  const errors: PetPackValidationIssue[] = [];
  if (!isRecord(value)) {
    return result([issue("invalid-manifest", "manifest must be an object")]);
  }

  if (value.schemaVersion !== PET_PACK_SCHEMA_VERSION) {
    errors.push(issue("invalid-schema-version", "schemaVersion must be 1", "schemaVersion"));
  }
  for (const field of ["id", "name", "version", "assetRoot", "license"] as const) {
    if (!isNonEmptyString(value[field])) {
      errors.push(issue("missing-field", `${field} must be a non-empty string`, field));
    }
  }
  if (isNonEmptyString(value.id) && !ID_PATTERN.test(value.id)) {
    errors.push(issue("invalid-id", "id contains unsupported characters", "id"));
  }
  if (!isPositiveInteger(value.spriteVersionNumber)) {
    errors.push(issue("invalid-sprite-version", "spriteVersionNumber must be a positive integer", "spriteVersionNumber"));
  }
  if (safeRelativePath(value.assetRoot) === null) {
    errors.push(issue("unsafe-path", "assetRoot must be a safe relative path", "assetRoot"));
  }
  if (!Array.isArray(value.entries) || value.entries.length === 0) {
    errors.push(issue("invalid-entries", "entries must be a non-empty array", "entries"));
  }
  if (!isRecord(value.compatibility)) {
    errors.push(issue("invalid-compatibility", "compatibility must be an object", "compatibility"));
  }

  const ids = new Set<string>();
  const paths = new Set<string>();
  if (Array.isArray(value.entries)) {
    value.entries.forEach((entry, index) => {
      errors.push(...validateEntry(entry, index, ids, paths));
    });
  }

  const requireCodex = options.requireCodex ?? isCodexDeclared(value);
  if (requireCodex && Array.isArray(value.entries)) {
    const entryPaths = new Set(value.entries
      .filter(isRecord)
      .map((entry) => entry.path)
      .filter((entryPath): entryPath is string => typeof entryPath === "string"));
    for (const requiredPath of ["codex/pet.json", "codex/spritesheet.webp"] as const) {
      if (!entryPaths.has(requiredPath)) {
        errors.push(issue("missing-codex-entry", `Codex compatibility requires ${requiredPath}`, requiredPath));
      }
    }
  }

  return result(errors);
}

export function parsePetPackManifest(value: unknown): PetPackParseResult {
  const validation = validatePetPackManifest(value);
  if (!validation.ok) {
    return validation;
  }
  return { ...validation, manifest: value as PetPackManifest };
}
