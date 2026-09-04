import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");
const bridgeSource = readFileSync(path.resolve(process.cwd(), "src/bridge.ts"), "utf8");
const preloadSource = readFileSync(path.resolve(process.cwd(), "electron/preload.ts"), "utf8");

describe("article game window contract", () => {
  it("exposes one trusted fit operation and restores the normal center size", () => {
    expect(mainSource).toContain('ipcMain.handle("article-game:fit"');
    expect(mainSource).toContain("assertTrustedInvoke(event)");
    expect(mainSource).toContain("articleGameWindowLayout");
    expect(mainSource).toContain("NORMAL_CENTER_WINDOW_SIZE");
    expect(bridgeSource).toContain("fitArticleGameWindow");
    expect(bridgeSource).toContain("restoreGameWindow");
    expect(preloadSource).toContain('ipcRenderer.invoke("article-game:fit"');
    expect(preloadSource).toContain('ipcRenderer.invoke("article-game:restore"');
    expect(mainSource).toContain('ipcMain.handle("article-game:restore"');
  });

  it("keeps fit bounds at or above the requested intrinsic surface", () => {
    expect(mainSource).toContain("Math.max(layout.width");
    expect(mainSource).toContain("Math.max(layout.height + layout.chromeHeight");
    expect(mainSource).toContain("layout.contentWidth");
    expect(mainSource).toContain("layout.contentHeight");
    expect(mainSource).toContain("setContentSize");
    expect(mainSource).toContain("screen.getDisplayMatching");
  });

  it("hides the desktop pet while an article game owns the center window", () => {
    expect(mainSource).toContain("let overlaySuppressedForArticleGame = false;");
    expect(mainSource).toContain("function suppressOverlayForArticleGame");
    expect(mainSource).toContain("function restoreOverlayAfterArticleGame");
    expect(mainSource).toMatch(/fitCenterWindowToArticleGame[\s\S]*suppressOverlayForArticleGame\(\);/);
    expect(mainSource).toMatch(/function restoreGameWindow[\s\S]*restoreOverlayAfterArticleGame\(\);/);
    expect(mainSource).toContain("!overlaySuppressedForArticleGame");
  });
});
