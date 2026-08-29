import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PET_ASSET_IDS } from "../../src/pet-pack/runtime";

interface AssetManifestEntry {
  id: string;
  kind: string;
  sourcePath: string;
  packagePath: string;
  required: boolean;
  width?: number;
  height?: number;
  frameCount?: number;
  columns?: number;
  rows?: number;
}

interface AssetManifest {
  schemaVersion: number;
  replacementRoot: string;
  entries: AssetManifestEntry[];
}

const root = path.resolve(process.cwd());
const manifest = JSON.parse(readFileSync(path.join(root, "public/pet/asset-manifest.json"), "utf8")) as AssetManifest;

describe("public pet asset manifest", () => {
  it("lists every renderer asset exactly once", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.replacementRoot).toBe("public/pet");
    expect(manifest.entries.map((entry) => entry.id)).toEqual([...PET_ASSET_IDS]);
    expect(new Set(manifest.entries.map((entry) => entry.id)).size).toBe(manifest.entries.length);
  });

  it("points every required asset at a checked-in source and safe package path", () => {
    for (const entry of manifest.entries) {
      expect(entry.required).toBe(true);
      expect(existsSync(path.join(root, entry.sourcePath))).toBe(true);
      expect(entry.packagePath.startsWith("assets/")).toBe(true);
      expect(entry.packagePath.includes("../")).toBe(false);
      if (entry.frameCount !== undefined) {
        expect(entry.columns).toBeGreaterThan(0);
        expect(entry.rows).toBeGreaterThan(0);
        expect(entry.frameCount).toBeLessThanOrEqual((entry.columns ?? 0) * (entry.rows ?? 0));
      }
      if (entry.width !== undefined || entry.height !== undefined) {
        expect(entry.width).toBeGreaterThan(0);
        expect(entry.height).toBeGreaterThan(0);
      }
    }
  });
});
