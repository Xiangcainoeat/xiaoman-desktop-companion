import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "../src/styles.css"), "utf8");

describe("compact preferences layout contract", () => {
  it("uses a direct intrinsic two-column grid for settings sections", () => {
    expect(source).toContain(".settings-view .settings-columns");
    expect(source).toContain("grid-auto-rows: max-content");
    expect(source).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(source).toContain(".settings-view .settings-columns > .settings-section");
    expect(source).toContain("@media (max-width: 760px)");
  });
});
