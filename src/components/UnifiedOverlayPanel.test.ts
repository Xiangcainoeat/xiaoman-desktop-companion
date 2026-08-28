import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const overlaySource = readFileSync(new URL("./Overlay.tsx", import.meta.url), "utf8");
const quickSource = readFileSync(new URL("./QuickActionsView.tsx", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../../electron/main.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../../electron/preload.ts", import.meta.url), "utf8");
const typeSource = readFileSync(new URL("../electron.d.ts", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("unified overlay panel contract", () => {
  it("renders care and interaction inside the same Overlay host as Codex tasks", () => {
    expect(overlaySource).toContain("QuickActionsView");
    expect(overlaySource).toContain("panelMode");
    expect(overlaySource).toContain("has-auxiliary-panel");
    expect(overlaySource).toContain('panelMode === "codex"');
    expect(overlaySource).toContain('panelMode === "care"');
    expect(overlaySource).toContain('panelMode === "interaction"');
    expect(quickSource).toContain("onClose");
    expect(quickSource).toContain("embedded");
  });

  it("uses one main-process panel mode and removes the independent quick BrowserWindow", () => {
    expect(mainSource).toContain("overlayPanelMode");
    expect(mainSource).toContain('"overlay:panel-state"');
    expect(mainSource).toContain("setOverlayPanel");
    expect(mainSource).not.toContain("function createQuickWindow");
    expect(mainSource).not.toContain("quickWindow: BrowserWindow");
    expect(preloadSource).toContain("onOverlayPanel");
    expect(typeSource).toContain("onOverlayPanel");
  });

  it("keeps pet drag on the shared Overlay host and removes header drag IPC", () => {
    expect(overlaySource).toContain("bridge.moveOverlayBy");
    expect(quickSource).not.toContain("moveQuickWindowBy");
    expect(quickSource).not.toContain("setPointerCapture");
    expect(stylesSource).toContain(".overlay-quick-panel");
    expect(stylesSource).toContain("-webkit-app-region: no-drag;");
    expect(stylesSource).toContain(".overlay-root.has-auxiliary-panel .overlay-pet-hitbox");
  });
});
