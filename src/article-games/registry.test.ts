import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARTICLE_GAME_DEFINITIONS,
  ARTICLE_GAME_IDS,
  getArticleGameDefinition,
  isArticleGameId,
} from "./registry";

describe("article game registry", () => {
  it("contains the ten article projects plus the retained H5 xiangqi project", () => {
    expect(ARTICLE_GAME_IDS).toEqual([
      "pacman",
      "react-tetris",
      "battle-city",
      "international-chess",
      "star-battle",
      "space-invaders",
      "snake",
      "super-mario-bros",
      "2048",
      "sliding-puzzle",
      "xiangqi-h5",
    ]);
    expect(ARTICLE_GAME_DEFINITIONS).toHaveLength(11);
    expect(new Set(ARTICLE_GAME_DEFINITIONS.map((game) => game.id)).size).toBe(11);
  });

  it("has a checked-in local entry for every redistributable offline game", () => {
    const redistributableGames = ARTICLE_GAME_DEFINITIONS.filter(
      (item) => item.availability === "offline" && item.license !== "未声明",
    );

    for (const game of redistributableGames) {
      const entry = path.join(process.cwd(), "public", "article-games", game.id, game.entryPath);
      expect(existsSync(entry), `${game.id} entry`).toBe(true);
      expect(readFileSync(entry, "utf8")).toContain("<html");
    }
  });

  it("keeps the Lila entry honest about its network boundary", () => {
    const game = getArticleGameDefinition("international-chess");
    expect(game.availability).toBe("online");
    expect(game.requiresNetwork).toBe(true);
    expect(game.sourceUrl).toBe("https://github.com/ornicar/lila");
    expect(game.onlineUrl).toBe("https://lichess.org/");
  });

  it("rejects old game ids and path traversal", () => {
    expect(isArticleGameId("xiangqi-h5")).toBe(true);
    expect(isArticleGameId("rock-paper-scissors")).toBe(false);
    expect(isArticleGameId("../../outside")).toBe(false);
    expect(isArticleGameId(null)).toBe(false);
  });
});
