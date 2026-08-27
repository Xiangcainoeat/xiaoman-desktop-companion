import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const centerSource = readFileSync(new URL("./ControlCenter.tsx", import.meta.url), "utf8");
const quickSource = readFileSync(new URL("./QuickActionsView.tsx", import.meta.url), "utf8");
const bridgeSource = readFileSync(new URL("../bridge.ts", import.meta.url), "utf8");
const typeSource = readFileSync(new URL("../electron.d.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../../electron/preload.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../../electron/main.ts", import.meta.url), "utf8");

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
});
