import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARTICLE_GAME_DEFINITIONS, ARTICLE_GAME_IDS } from "../article-games/registry";

describe("game launcher", () => {
  it("exposes the ten article projects plus the retained H5 xiangqi repository", () => {
    expect(ARTICLE_GAME_DEFINITIONS.map((definition) => definition.id)).toEqual(ARTICLE_GAME_IDS);
    expect(ARTICLE_GAME_IDS).toHaveLength(11);
    expect(ARTICLE_GAME_DEFINITIONS.filter((definition) => definition.availability === "offline")).toHaveLength(10);
    expect(ARTICLE_GAME_DEFINITIONS.find((definition) => definition.id === "xiangqi-h5")?.sourceUrl)
      .toBe("https://github.com/itlwei/Chess");
  });
});

describe("GamesView source contract", () => {
  const source = readFileSync(new URL("./GamesView.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  it("keeps the parent switch and desktop interaction guard", () => {
    expect(source).toContain("gameEnabled");
    expect(source).toContain("游戏模式已关闭");
    expect(source).toContain("desktopInteractionActive");
    expect(source).toContain("disabled={desktopInteractionActive}");
    expect(source).toContain("stopPropagation");
  });

  it("renders the article-game catalog and persistent workspace tabs", () => {
    expect(source).toContain("ARTICLE_GAME_DEFINITIONS");
    expect(source).toContain("ArticleGameView");
    expect(source).toContain("12 个游戏");
    expect(source).toContain("游戏库");
    expect(source).toContain("games-catalog-filter-row");
    for (const category of ["全部", "棋类", "益智", "街机"]) {
      expect(source).toContain(category);
    }
    expect(source).toContain("article-game-tabs");
    expect(source).toContain("article-game-tab-panels");
    expect(source).toContain("openArticleGameTab");
    expect(source).toContain("activeTab");
    expect(source).not.toContain("INTEGRATED_GAME_DEFINITIONS");
    expect(source).not.toContain("旧版游戏入口");
    expect(source).not.toContain("H5_GAME_REGISTRY");
  });

  it("adds a native Gomoku workspace without replacing the article-game registry", () => {
    expect(source).toContain('export const NATIVE_GOMOKU_ID = "gomoku-native"');
    expect(source).toContain("GomokuGame");
    expect(source).toContain('onOpenOnline={() => bridge.showCenter("online")}' );
    expect(source).toContain("打开五子棋");
    expect(styles).toContain(".gomoku-game");
    expect(styles).toContain(".gomoku-board");
  });

  it("puts persistent tabs before the home catalog and removes the repeated large intro", () => {
    expect(source.indexOf('className="article-game-tabs"')).toBeGreaterThanOrEqual(0);
    expect(source.indexOf('className="article-game-tabs"')).toBeLessThan(source.indexOf('className="article-games-catalog"'));
    expect(source).not.toContain("和小满玩一会儿");
    expect(source).not.toContain("11 个入口统一收纳在这里");
  });

  it("keeps the tab strip outside the scrolling home catalog", () => {
    const tabsIndex = source.indexOf('className="article-game-tabs"');
    const scrollRegionIndex = source.indexOf('className="article-game-home-scroll"');
    const catalogIndex = source.indexOf('className="article-games-catalog"');
    expect(tabsIndex).toBeGreaterThanOrEqual(0);
    expect(scrollRegionIndex).toBeGreaterThan(tabsIndex);
    expect(catalogIndex).toBeGreaterThan(scrollRegionIndex);
    expect(styles).toContain(".article-game-home-scroll");
    expect(styles).toMatch(/\.article-game-home-scroll\s*\{[\s\S]*overflow:\s*auto;/);
    expect(styles).toMatch(/\.games-view\.is-home\s*\{[\s\S]*overflow:\s*hidden;/);
    expect(styles).toMatch(/\.center-page-games\.is-active \.games-view\.is-home\s*\{[\s\S]*overflow:\s*hidden;/);
    expect(styles).toContain(".article-game-tabs {\n  position: relative;");
  });

  it("wires one host-owned mute state and an optional window restore operation", () => {
    expect(source).toContain("const [muted, setMuted] = useState(true)");
    expect(source).toContain("muted={muted}");
    expect(source).toContain("onToggleMute={() => setMuted((value) => !value)}");
    expect(source).toContain("restoreGameWindow");
    expect(source).toContain("visible");
    expect(source).toContain("onWorkspaceChange");
    expect(source).toContain("useLayoutEffect");
    expect(source).toContain("onLayoutSettled={onWorkspaceChange}");
  });

  it("keeps inactive game panels mounted and declares a no-scroll active surface", () => {
    expect(source).toContain('className={`article-game-tab-panel ${active ? "is-active" : "is-inactive"}`}');
    expect(source).toContain("aria-hidden={!active}");
    expect(styles).toContain(".article-game-frame-wrap");
    expect(styles).toContain("overflow: hidden;");
    expect(styles).not.toContain(".article-game-frame-wrap {\n  position: relative;\n  width: 100%;\n  min-width: 0;\n  min-height: var(--article-game-frame-height, 680px);\n  overflow: auto;");
    // The public web shell intentionally uses a sticky tab strip. The game
    // frame itself must remain a contained, non-sticky surface.
    expect(styles).not.toMatch(/\.article-game-frame-wrap\s*\{[^}]*position:\s*sticky;/);
    expect(styles).toContain("overflow-anchor: none;");
  });

  it("restores one outer page scroller for active games on mobile web", () => {
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.center-shell\.is-web \.content-scroll\.is-games[\s\S]*?overflow-y:\s*auto !important;/);
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.center-shell\.is-web \.games-view\.is-game-active[\s\S]*?overflow:\s*visible !important;/);
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.gomoku-game[\s\S]*?overflow:\s*visible !important;/);
  });

  it("keeps the active game's pause and utility controls in their own row", () => {
    expect(styles).toMatch(/\.games-view\.is-game-active \.article-game-header\s*\{[\s\S]*?position:\s*relative;/);
    expect(styles).toMatch(/\.games-view\.is-game-active \.article-game-toolbar\s*\{[\s\S]*?margin-left:\s*auto;/);
    expect(styles).not.toContain("top: -43px");
  });

  it("resets the games view scroll before sticky tabs are painted", () => {
    expect(source).toContain("gamesViewRef");
    expect(source).toContain("gamesViewRef.current?.scrollTo");
    expect(source).toContain('ref={gamesViewRef}');
  });
});
