import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  safeRelativePath,
  validatePetPackManifest,
  type PetPackManifest,
  type PetPackValidationIssue,
  type PetPackValidationResult,
} from "./manifest";

const CODEX_REQUIRED_PATHS = ["codex/pet.json", "codex/spritesheet.webp"] as const;

function issue(code: string, message: string, entryPath?: string): PetPackValidationIssue {
  return entryPath === undefined ? { code, message } : { code, message, path: entryPath };
}

function isWithinDirectory(directory: string, filePath: string): boolean {
  const relative = path.relative(directory, filePath);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: Buffer) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function checkFile(
  assetDirectory: string,
  relativePath: string,
  checksumSha256?: string,
): Promise<PetPackValidationIssue[]> {
  const safePath = safeRelativePath(relativePath);
  if (safePath === null) {
    return [issue("unsafe-path", "entry path must be a safe relative path", relativePath)];
  }
  const filePath = path.resolve(assetDirectory, ...safePath.split("/"));
  if (!isWithinDirectory(assetDirectory, filePath)) {
    return [issue("unsafe-path", "entry path escapes assetRoot", relativePath)];
  }

  try {
    await access(filePath);
    const info = await stat(filePath);
    if (!info.isFile()) {
      return [issue("not-a-file", "declared asset is not a regular file", relativePath)];
    }
    const resolvedPath = await realpath(filePath);
    const resolvedDirectory = await realpath(assetDirectory);
    if (!isWithinDirectory(resolvedDirectory, resolvedPath)) {
      return [issue("unsafe-file-target", "declared asset resolves outside assetRoot", relativePath)];
    }
    if (checksumSha256 !== undefined) {
      const actualChecksum = await sha256File(filePath);
      if (actualChecksum.toLowerCase() !== checksumSha256.toLowerCase()) {
        return [issue("checksum-mismatch", "file SHA-256 does not match the manifest", relativePath)];
      }
    }
    return [];
  } catch {
    return [issue("missing-file", "declared asset file does not exist", relativePath)];
  }
}

export async function validatePetPackFiles(
  manifest: PetPackManifest,
  rootDir: string,
): Promise<PetPackValidationResult> {
  const manifestResult = validatePetPackManifest(manifest);
  if (!manifestResult.ok) {
    return manifestResult;
  }

  const assetDirectory = path.resolve(rootDir, ...manifest.assetRoot.split("/"));
  const errors: PetPackValidationIssue[] = [];
  const warnings: PetPackValidationIssue[] = [];
  try {
    const info = await stat(assetDirectory);
    if (!info.isDirectory()) {
      return {
        ok: false,
        errors: [issue("invalid-asset-root", "assetRoot does not resolve to a directory", manifest.assetRoot)],
        warnings: [],
      };
    }
  } catch {
    return {
      ok: false,
      errors: [issue("missing-asset-root", "assetRoot directory does not exist", manifest.assetRoot)],
      warnings: [],
    };
  }

  const requireCodex = manifest.compatibility.codex !== undefined && manifest.compatibility.codex !== false;
  const entriesByPath = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  const pathsToCheck = new Set<string>(manifest.entries.map((entry) => entry.path));
  if (requireCodex) {
    CODEX_REQUIRED_PATHS.forEach((requiredPath) => pathsToCheck.add(requiredPath));
  }

  for (const relativePath of pathsToCheck) {
    const entry = entriesByPath.get(relativePath);
    const issues = await checkFile(assetDirectory, relativePath, entry?.checksumSha256);
    for (const current of issues) {
      if (current.code === "missing-file" && entry?.optional) {
        warnings.push(issue("missing-optional-file", "optional asset is absent; the bundled fallback will be used", relativePath));
      } else {
        errors.push(current);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
