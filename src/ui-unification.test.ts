import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARTICLE_GAME_DEFINITIONS, ARTICLE_GAME_IDS } from "./article-games/registry";

const appStyles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const gamesView = readFileSync(new URL("./components/GamesView.tsx", import.meta.url), "utf8");
const articleGameView = readFileSync(new URL("./components/ArticleGameView.tsx", import.meta.url), "utf8");

describe("shared UI visual contract", () => {
  it("defines the same control, radius, and surface vocabulary in the app", () => {
    expect(appStyles).toContain("--control-height: 38px;");
    expect(appStyles).toContain("--radius-panel: 8px;");
    expect(appStyles).toContain("--surface-raised: #ffffff;");
    expect(appStyles).toContain(".ui-section-heading");
  });

  it("defines a shared typography scale for every center page", () => {
    expect(appStyles).toContain("--type-page-title: 26px;");
    expect(appStyles).toContain("--type-section-title: 20px;");
    expect(appStyles).toContain("--type-card-title: 16px;");
    expect(appStyles).toContain("--type-body: 14px;");
    expect(appStyles).toContain("--type-meta: 12px;");
    expect(appStyles).toContain("--type-metric: 18px;");
    expect(appStyles).toContain(".center-shell .brand-block strong");
    expect(appStyles).toContain(".center-shell .article-game-heading h2");
    expect(appStyles).toContain(".center-shell .article-game-tab");
    expect(appStyles).toContain(".center-shell .stat-line");
    expect(appStyles).toContain(".center-shell .task-warning");
    expect(appStyles).toContain(".center-shell .settings-copy strong");
    expect(appStyles).toContain(".center-shell .settings-copy small");
    expect(appStyles).toContain(".center-shell .topbar h1");
  });

  it("uses one article catalog and one embedded frame for the public game set", () => {
    expect(ARTICLE_GAME_IDS).toHaveLength(10);
    expect(ARTICLE_GAME_DEFINITIONS.filter((game) => game.availability === "offline")).toHaveLength(9);
    expect(gamesView).toContain("ARTICLE_GAME_DEFINITIONS");
    expect(gamesView).toContain('className="article-game-grid"');
    expect(articleGameView).toContain("<iframe");
    expect(articleGameView).toContain("allow-same-origin");
  });

  it("keeps game chrome compact and prevents active game scrolling", () => {
    expect(gamesView).not.toContain("和小满玩一会儿");
    expect(gamesView).toContain("muted={muted}");
    expect(gamesView).toContain("onToggleMute");
    expect(appStyles).toContain(".article-game-frame-wrap");
    expect(appStyles).toContain("overflow: hidden;");
    expect(appStyles).not.toContain("min-height: var(--article-game-frame-height, 680px);\n  overflow: auto;");
  });

  it("does not leave the retired game directories in the release source", () => {
    const root = process.cwd();
    for (const relativePath of ["public/games", "public/h5-games", "src/h5-games"]) {
      expect(existsSync(path.join(root, relativePath)), relativePath).toBe(false);
    }
  });
});
