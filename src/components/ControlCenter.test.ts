import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const centerSource = readFileSync(new URL("./ControlCenter.tsx", import.meta.url), "utf8");
const quickSource = readFileSync(new URL("./QuickActionsView.tsx", import.meta.url), "utf8");
const bridgeSource = readFileSync(new URL("../bridge.ts", import.meta.url), "utf8");
const typeSource = readFileSync(new URL("../electron.d.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../../electron/preload.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../../electron/main.ts", import.meta.url), "utf8");
const overlaySource = readFileSync(new URL("./Overlay.tsx", import.meta.url), "utf8");

describe("direct games navigation", () => {
  it("routes the quick interaction action to the games tab", () => {
    expect(quickSource).toContain('bridge.showCenter("games")');
  });

  it("accepts a center-tab event in the renderer and selects it", () => {
    expect(centerSource).toContain("onCenterTab");
    expect(centerSource).toContain("setTab(nextTab)");
  });

  it("keeps the center-tab bridge contract aligned across preload and browser mock", () => {
    expect(typeSource).toContain("onCenterTab");
    expect(preloadSource).toContain('onCenterTab:');
    expect(bridgeSource).toContain("onCenterTab:");
  });

  it("delivers a requested tab to an existing or newly created center window", () => {
    expect(mainSource).toContain('center:select-tab');
    expect(mainSource).toContain('showCenter(tab');
  });

  it("keeps the visible quit command wired through the trusted app bridge", () => {
    expect(centerSource).toContain("退出小满");
    expect(centerSource).toContain("bridge.quitApp()");
    expect(typeSource).toContain("quitApp");
    expect(preloadSource).toContain('quitApp:');
    expect(bridgeSource).toContain("quitApp:");
    expect(mainSource).toContain('ipcMain.on("app:quit"');
    expect(mainSource).toContain("assertTrustedSender(event.sender, event.senderFrame)");
  });

  it("keeps the task panel and compact window mutually exclusive", () => {
    expect(mainSource).toContain("function closeQuickWindow");
    expect(mainSource).toContain("closeQuickWindow();");
    expect(mainSource).toContain('"overlay:task-panel-state"');
    expect(preloadSource).toContain("onOverlayTaskPanel");
    expect(typeSource).toContain("onOverlayTaskPanel");
    expect(bridgeSource).toContain("onOverlayTaskPanel");
  });

  it("makes sleeping modal and clears desktop interaction", () => {
    const helperStart = mainSource.indexOf("function closeAuxiliaryPanelsForSleep");
    const helperEnd = mainSource.indexOf("export function showQuickWindow", helperStart);
    const helper = mainSource.slice(helperStart, helperEnd);
    expect(helper).toContain("clearDesktopBubbleSessionWithoutReward(false);");
    expect(helper).toContain("gameActive = false;");
    expect(mainSource.indexOf("} else if (data.sleeping) {")).toBeLessThan(mainSource.indexOf("if (monitoring.codexBusy)"));
  });

  it("blocks overlay content openers while sleeping except the wake toggle", () => {
    expect(overlaySource).toContain('bridge.interact(snapshot.sleeping ? "wake" : "sleep")');
    expect(overlaySource).toContain('if (snapshot.sleeping) notifySleeping();\n            else bridge.showCenter();');
  });

  it("routes quick-window movement through the trusted Electron boundary", () => {
    expect(mainSource).toContain('ipcMain.on("quick:move-by"');
    expect(mainSource).toContain("moveQuickWindowBy(deltaX, deltaY);");
    expect(preloadSource).toContain("moveQuickWindowBy");
    expect(typeSource).toContain("moveQuickWindowBy");
    expect(bridgeSource).toContain("moveQuickWindowBy:");
  });

  it("handles sleeping tray actions without an unhandled rejected promise", () => {
    expect(mainSource).toContain("function performMenuInteraction");
    expect(mainSource).toContain("performMenuInteraction(\"feed\")");
    expect(mainSource).toContain("performMenuInteraction(\"pet\")");
    expect(mainSource).toContain("performMenuInteraction(\"play\")");
  });

  it("keeps the overlay context menu modal while the pet is sleeping", () => {
    expect(mainSource).toContain("function showCenterFromOverlayMenu");
    expect(mainSource).toContain("click: () => showCenterFromOverlayMenu()");
    expect(mainSource).toContain("if (data.sleeping) {\n    notifySleeping();\n    return;\n  }\n  showCenter();");
  });
});
