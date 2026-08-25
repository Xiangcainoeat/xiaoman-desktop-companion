import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultData } from "../src/shared/domain";
import { CompanionStore } from "./store";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("CompanionStore recovery", () => {
  it("backs up malformed data before returning defaults", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "xiaoman-store-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "xiaoman-data.json");
    writeFileSync(filePath, "{not-json", "utf8");

    const store = new CompanionStore(directory);
    const loaded = store.load();
    const backup = readdirSync(directory).find((name) => name.startsWith("xiaoman-data.json.invalid-"));

    expect(loaded.version).toBe(2);
    expect(backup).toBeTruthy();
    expect(readFileSync(path.join(directory, backup!), "utf8")).toBe("{not-json");
  });

  it("backs up unsupported future versions", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "xiaoman-store-"));
    temporaryDirectories.push(directory);
    writeFileSync(path.join(directory, "xiaoman-data.json"), JSON.stringify({ version: 99 }), "utf8");

    const store = new CompanionStore(directory);
    expect(store.load()).toMatchObject({ version: 2 });
    expect(readdirSync(directory).some((name) => name.endsWith(".bak"))).toBe(true);
  });

  it("writes a valid owner-only replacement after recovery", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "xiaoman-store-"));
    temporaryDirectories.push(directory);
    const store = new CompanionStore(directory);
    const data = createDefaultData(100);
    store.save(data);
    expect(JSON.parse(readFileSync(path.join(directory, "xiaoman-data.json"), "utf8"))).toMatchObject({ version: 2 });
  });
});
