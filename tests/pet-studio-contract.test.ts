import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const files = {
  types: readFileSync(resolve(root, "src/shared/types.ts"), "utf8"),
  contract: readFileSync(resolve(root, "src/electron.d.ts"), "utf8"),
  preload: readFileSync(resolve(root, "electron/preload.ts"), "utf8"),
  bridge: readFileSync(resolve(root, "src/bridge.ts"), "utf8"),
  main: readFileSync(resolve(root, "electron/main.ts"), "utf8"),
};

describe("pet studio native bridge contract", () => {
  it("exposes one result type and one trusted start method end to end", () => {
    expect(files.types).toContain("PetStudioStartResult");
    expect(files.contract).toContain("startPetStudio");
    expect(files.preload).toContain('ipcRenderer.invoke("pet-studio:start"');
    expect(files.bridge).toContain("startPetStudio");
    expect(files.main).toContain('ipcMain.handle("pet-studio:start"');
  });
});
