import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "../src/styles.css"), "utf8");

describe("compact preferences layout contract", () => {
  it("uses intrinsic sizing for settings columns and sections", () => {
    expect(source).toContain(".settings-view .settings-columns");
    expect(source).toContain("grid-auto-rows: max-content");
    expect(source).toContain(".settings-view .settings-column");
    expect(source).toContain("height: max-content");
    expect(source).toContain("align-self: start");
    expect(source).toContain(".settings-view .settings-section:first-child");
  });
});
