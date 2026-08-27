import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(process.cwd(), "electron/preload.ts"), "utf8");

describe("sandbox preload dependency boundary", () => {
  it("does not load a relative runtime module from a sandboxed preload", () => {
    expect(source).not.toMatch(/import\s+\{[^}]*MAX_OVERLAY_HIT_REGIONS[^}]*\}\s+from\s+["']\.\.\/src\/shared\/types["']/s);
    expect(source).toContain("const MAX_OVERLAY_HIT_REGIONS = 64;");
  });
});
