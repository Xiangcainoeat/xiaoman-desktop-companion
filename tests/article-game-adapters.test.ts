import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const gamesRoot = path.join(process.cwd(), "public", "article-games");
const readGame = (id: string, file: string) => readFileSync(path.join(gamesRoot, id, file), "utf8");

describe("article game adapters", () => {
  it("loads the shared keyboard bridge in every local game", () => {
    for (const id of [
      "pacman",
      "react-tetris",
      "battle-city",
      "star-battle",
      "space-invaders",
      "snake",
      "super-mario-bros",
      "2048",
      "xiangqi-h5",
    ]) {
      expect(readGame(id, "index.html"), id).toContain("../xiaoman-frame-adapter.js");
    }
  });

  it("lets the host silence an inactive embedded game", () => {
    const adapter = readFileSync(path.join(gamesRoot, "xiaoman-frame-adapter.js"), "utf8");
    const view = readFileSync(path.join(process.cwd(), "src", "components", "ArticleGameView.tsx"), "utf8");
    expect(adapter).toContain("xiaoman-game-visibility");
    expect(adapter).toContain("HTMLMediaElement.prototype.play");
    expect(adapter).toContain("data-xiaoman-game-active");
    expect(view).toContain("channel: \"xiaoman-game-visibility\"");
    expect(view).toContain("active");
    expect(view).toContain('channel: "xiaoman-game-audio"');
    expect(view).toContain("visibilitychange");
    expect(view).toContain("window.addEventListener(\"blur\"");
    expect(view).toContain("const handleBlur = () => setWindowActive(false)");
    expect(view).toContain("windowActive");
    expect(view).toContain("if (!gameActive || definition.availability !== \"offline\") return;");
    expect(view).toContain("onToggleMute");
    expect(view).toContain('title={muted ? "取消静音" : "静音"}');
    expect(view).toContain("fitArticleGameWindow");
    expect(view).toContain("onLayoutSettled");
    expect(view).toContain("onLayoutSettled?.()");
    expect(view).toContain("overflow: \"hidden\"");
    expect(view).toContain("article-game-side-help");
    expect(view).toContain("按键说明");
    expect(view).toContain("preventScroll: true");
    expect(view).not.toContain("contentWindow?.focus()");
  });

  it("keeps chess on its board and control surface without document scrolling", () => {
    const html = readGame("xiangqi-h5", "index.html");
    expect(html).toContain('data-xiaoman-intrinsic-width="523"');
    expect(html).toContain('data-xiaoman-intrinsic-height="580"');
    expect(html).toContain("overflow: hidden");
    expect(html).toContain("#chess");
    expect(html).toContain('id="playBtn"');
    expect(html).not.toContain("background:url(../img/init_bg.png)");
  });

  it("only enables Mario's drawn touchpad for an explicit touch or mobile signal", () => {
    const html = readGame("super-mario-bros", "index.html");
    const input = readGame("super-mario-bros", "src/input.js");
    const main = readGame("super-mario-bros", "main.js");
    expect(input).toContain("isTouchOrMobileSignal");
    expect(input).toContain("drawTouchpad === true && this.isTouchOrMobileSignal()");
    expect(main).toContain("drawTouchpad: \"auto\"");
    expect(main).not.toContain("drawTouchpad: true");
    expect(input).toContain("case 90");
    expect(input).toContain("case 88");
    expect(main).toContain("viewportBottom: this.input.isTouchOrMobileSignal() ? 156 : 0");
    expect(input).toContain("drawKeyboardHint: false");
    expect(html).toContain("@media (hover: hover) and (pointer: fine)");
    expect(html).toContain("#xiaoman-mario-keymap");
    expect(html).toContain('id="xiaoman-mario-keymap"');
    expect(html).toContain("←/→ 移动");
    expect(html).toContain("Z 跳跃");
    expect(html).toContain("X 奔跑");
  });

  it("removes Tetris chrome deterministically while preserving the play surface", () => {
    const html = readGame("react-tetris", "index.html");
    const app = readGame("react-tetris", "app-1.0.1.js");
    expect(html).toContain("cleanupTetrisUpstreamChrome");
    expect(html).toContain("data-xiaoman-tetris-cleanup");
    expect(html).toContain("overflow: hidden");
    expect(html).toContain('[data-xiaoman-tetris-role="guide"]');
    expect(html).toContain('[data-xiaoman-tetris-role="qr"]');
    expect(html).toContain('[data-xiaoman-tetris-role="rail"]');
    expect(app).toContain('guide:"_2iIk"');
    expect(app).toContain('next:"_');
    expect(app).toContain("keydown");
  });

  it("handles host audio mute and visibility without requiring game audio", () => {
    const adapter = readFileSync(path.join(gamesRoot, "xiaoman-frame-adapter.js"), "utf8");
    expect(adapter).toContain('data.channel === "xiaoman-game-audio"');
    expect(adapter).toContain("setGameMuted");
    expect(adapter).toContain("__xiaomanAudioContext");
    expect(adapter).toContain("masterGain");
    expect(adapter).toContain("context.suspend");
    expect(adapter).toContain("context.resume");
    expect(adapter).toContain("xiaoman-game-visibility");
  });

  it("removes upstream Tetris guides instead of leaving QR and side rails in the play area", () => {
    const html = readGame("react-tetris", "index.html");
    expect(html).toContain("xiaoman-tetris-cleanup");
    expect(html).toContain("display: none");
  });

  it("removes Tetris touch controls and declares keyboard-only input", () => {
    const html = readGame("react-tetris", "index.html");
    const app = readGame("react-tetris", "app-1.0.1.js");
    expect(html).toContain('[data-xiaoman-tetris-role="controls"]');
    expect(html).toContain('data-xiaoman-tetris-input="keyboard-only"');
    expect(html).toContain('querySelectorAll(".J9SA")');
    expect(html).toContain("#root .J9SA");
    expect(html).toMatch(/data-xiaoman-tetris-role="controls"[\s\S]*display:\s*none/);
    expect(app).toContain("keydown");
  });

  it("crops Battle City to its native SVG play surface", () => {
    const html = readGame("battle-city", "index.html");
    expect(html).toContain("width: 768px; height: 720px; margin: 0; overflow: hidden");
    expect(html).toContain("width: 768px; height: 720px; flex: 0 0 768px");
    expect(html).toContain("svg { width: 768px; height: 720px; }");
    expect(html).not.toContain("padding: 20px");
  });

  it("keeps Pacman on its complete native canvas instead of scrolling past page chrome", () => {
    const html = readGame("pacman", "index.html");
    expect(html).toContain("html, body { width: 960px; height: 640px; overflow: hidden; }");
    expect(html).toContain(".game-title,");
    expect(html).toContain(".mod-panel canvas { display: block; width: 960px; height: 640px; }");
    expect(html).toContain(".mod-panel .ft { display: none; }");
  });

  it("keeps Star Battle at its native surface without an inner document scroll", () => {
    const css = readGame("star-battle", "css/style.css");
    expect(css).toContain("width: 960px;");
    expect(css).toContain("height: 480px;");
    expect(css).toContain("overflow: hidden;");
    expect(css).toContain("footer{");
    expect(css).toContain("footer{\n    display: none;\n    flex: 0 0 auto;");
  });

  it("turns snake wall contact into a terminal state rather than a wraparound", () => {
    const source = readGame("snake", "jscript.js");
    expect(source).toContain("isSnakeHeadOutOfBounds");
    expect(source).toContain("gameOver");
    expect(source).not.toContain("currentSnakeHeadPosition = currentSnakeHeadPosition + GAME_PIXEL_COUNT");
    expect(source).not.toContain("currentSnakeHeadPosition = currentSnakeHeadPosition - SQUARE_OF_GAME_PIXEL_COUNT");
  });

  it("keeps the compact 2048 surface in Chinese", () => {
    const html = readGame("2048", "index.html");
    const css = readGame("2048", "style/main.css");
    expect(html).toContain("游戏说明");
    expect(html).toContain("move-up-button");
    expect(html).not.toContain("This site is the official version");
    expect(css).toContain('content: "得分"');
    expect(css).toContain('content: "最高"');
    expect(css).toContain("@media screen and (max-width: 700px)");
    expect(css).toContain("width: 760px;");
    expect(css).toContain("height: 640px;");
    expect(css).toContain("overflow: hidden;");
    expect(html).toContain('aria-label="按键说明"');
  });

  it("keeps the 2048 title, score labels, and values in separate layout areas", () => {
    const html = readGame("2048", "index.html");
    const css = readGame("2048", "style/main.css");
    expect(html).toContain('class="title-block"');
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) auto;");
    expect(css).toContain(".heading:after");
    expect(css).toContain("padding: 22px 12px 4px;");
    expect(css).toContain(".score-container:after");
  });

  it("provides a compact hidden keyboard disclosure for other local games", () => {
    const view = readFileSync(path.join(process.cwd(), "src", "components", "ArticleGameView.tsx"), "utf8");
    const styles = readFileSync(path.join(process.cwd(), "src", "styles.css"), "utf8");
    expect(view).toContain("article-game-key-help");
    expect(view).toContain('aria-label="按键说明"');
    expect(styles).toContain(".article-game-key-help-popover");
  });

  it("uses the online wording for international chess", () => {
    const source = readFileSync(path.join(process.cwd(), "src", "components", "ArticleGameView.tsx"), "utf8");
    expect(source).toContain("用系统浏览器打开官方棋盘");
    expect(source).not.toContain("伪装成本地离线包");
  });
});
