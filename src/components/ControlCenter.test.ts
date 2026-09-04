import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const centerSource = readFileSync(new URL("./ControlCenter.tsx", import.meta.url), "utf8");
const quickSource = readFileSync(new URL("./QuickActionsView.tsx", import.meta.url), "utf8");
const bridgeSource = readFileSync(new URL("../bridge.ts", import.meta.url), "utf8");
const typeSource = readFileSync(new URL("../electron.d.ts", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../../electron/preload.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../../electron/main.ts", import.meta.url), "utf8");
const overlaySource = readFileSync(new URL("./Overlay.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const runtimeSource = readFileSync(new URL("../shared/runtime.ts", import.meta.url), "utf8");

describe("direct games navigation", () => {
  it("isolates browser navigation from desktop-only workspaces", () => {
    expect(runtimeSource).toContain('WEB_CENTER_TABS = ["games", "online", "social"]');
    expect(runtimeSource).toContain('DESKTOP_CENTER_TABS');
    expect(centerSource).toContain("runtimeSurface");
    expect(centerSource).toContain("canUseCenterTab");
    expect(appSource).toContain("isDesktopRuntime");
    expect(appSource).toContain('view === "overlay"');
  });

  it("keeps compact navigation labels and Codex actions on one stable line", () => {
    expect(stylesSource).toMatch(/\.sidebar-nav button span\s*\{[\s\S]*white-space:\s*nowrap;/);
    expect(stylesSource).toMatch(/\.task-reply-panel \.section-heading \.secondary-button\s*\{[\s\S]*white-space:\s*nowrap;/);
  });

  it("routes the quick interaction action to the games tab", () => {
    expect(quickSource).toContain('bridge.showCenter("games")');
  });

  it("accepts a center-tab event in the renderer and selects it", () => {
    expect(centerSource).toContain("onCenterTab");
    expect(centerSource).toContain("setTab(canonicalTab)");
    expect(centerSource).toContain("center-page-games");
    expect(centerSource).toContain('tab === "games" ? "is-active" : "is-inactive"');
    expect(centerSource).toContain("contentScrollRef.current?.scrollTo");
    expect(centerSource).toContain('visible={tab === "games"}');
    expect(centerSource).toContain("onWorkspaceChange");
  });

  it("resets the workspace scroll before the next tab paint", () => {
    expect(centerSource).toContain("useLayoutEffect");
    expect(centerSource).toMatch(/useLayoutEffect\(\(\) => \{\s*resetContentScroll\(\);[\s\S]*\}, \[resetContentScroll, tab\]\);/);
  });

  it("gives the games workspace its own scroll boundary so tabs cannot be stranded", () => {
    expect(centerSource).toContain("gamesPageRef");
    expect(centerSource).toContain("gamesPageRef.current?.scrollTo");
    expect(centerSource).toContain('className={`content-scroll ${tab === "games" ? "is-games" : ""}`}');
    expect(stylesSource).toContain(".content-scroll.is-games");
    expect(stylesSource).toContain(".center-page-games.is-active .games-view.is-home");
    expect(stylesSource).toContain(".center-page-games.is-active .games-view.is-game-active");
  });

  it("keeps the center-tab bridge contract aligned across preload and browser mock", () => {
    expect(typeSource).toContain("onCenterTab");
    expect(preloadSource).toContain('onCenterTab:');
    expect(bridgeSource).toContain("onCenterTab:");
  });

  it("keeps legacy social tab messages mapped to the room workspace", () => {
    expect(centerSource).toContain('nextTab === "social" ? "online" : nextTab');
    expect(centerSource).not.toContain('label: "好友与联机"');
    expect(preloadSource).toMatch(/const CENTER_TABS:[\s\S]*?"social"/);
    expect(mainSource).toMatch(/const CENTER_TABS:[\s\S]*?"social"/);
  });

  it("separates single-player and online-room navigation entries", () => {
    expect(centerSource).toContain('label: "单机游戏"');
    expect(centerSource).toContain('label: "联机房间"');
    expect(centerSource).not.toContain('label: "好友与联机"');
    expect(centerSource).toContain('type Tab = CenterTab');
    expect(centerSource).toContain('{ id: "online", label: "联机房间"');
    expect(centerSource).toContain('tab === "online"');
    expect(centerSource).toContain('initialSection="online-games"');
    expect(centerSource).toContain("selectNavigationItem");
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
    expect(mainSource).toContain("let overlayPanelMode: OverlayPanelMode | null = null;");
    expect(mainSource).toContain('"overlay:panel-state"');
    expect(mainSource).toContain("setOverlayPanel");
    expect(mainSource).toContain('"overlay:task-panel-state"');
    expect(preloadSource).toContain("onOverlayPanel");
    expect(typeSource).toContain("onOverlayPanel");
    expect(bridgeSource).toContain("onOverlayPanel");
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

  it("routes every panel movement through the pet-owned overlay boundary", () => {
    expect(mainSource).toContain('ipcMain.on("overlay:move-by"');
    expect(overlaySource).toContain("bridge.moveOverlayBy");
    expect(quickSource).not.toContain("moveQuickWindowBy");
    expect(preloadSource).not.toContain("quick:move-by");
    expect(typeSource).not.toContain("moveQuickWindowBy");
    expect(bridgeSource).not.toContain("moveQuickWindowBy");
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
