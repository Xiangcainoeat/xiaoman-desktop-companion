import { describe, expect, it } from "vitest";
import { ARTICLE_GAME_DEFINITIONS } from "./registry";
import {
  articleGameFrameSpec,
  articleGameWindowLayout,
  calculateArticleGameContentSize,
  validateArticleGameLayouts,
} from "./layout";

describe("article game frame specs", () => {
  it("keeps fixed-format games at their native host surface size", () => {
    expect(articleGameFrameSpec(ARTICLE_GAME_DEFINITIONS.find((game) => game.id === "react-tetris")!)).toEqual({
      layout: "tall",
      width: 640,
      height: 610,
      chromeWidth: 300,
      chromeHeight: 176,
      normalCenterSize: { width: 1080, height: 730 },
    });
    expect(articleGameFrameSpec(ARTICLE_GAME_DEFINITIONS.find((game) => game.id === "star-battle")!)).toEqual({
      layout: "wide",
      width: 960,
      height: 480,
      chromeWidth: 300,
      chromeHeight: 176,
      normalCenterSize: { width: 1080, height: 730 },
    });
    expect(articleGameFrameSpec(ARTICLE_GAME_DEFINITIONS.find((game) => game.id === "battle-city")!)).toEqual({
      layout: "wide",
      width: 768,
      height: 720,
      chromeWidth: 500,
      chromeHeight: 176,
      normalCenterSize: { width: 1080, height: 730 },
    });
    expect(articleGameFrameSpec(ARTICLE_GAME_DEFINITIONS.find((game) => game.id === "sliding-puzzle")!)).toEqual({
      layout: "portrait",
      width: 420,
      height: 700,
      chromeWidth: 300,
      chromeHeight: 176,
      normalCenterSize: { width: 1080, height: 730 },
    });
  });

  it("does not invent a local frame size for the online chess entry", () => {
    const definition = ARTICLE_GAME_DEFINITIONS.find((game) => game.id === "international-chess")!;
    expect(articleGameFrameSpec(definition)).toEqual({ layout: "default" });
  });

  it("rejects an offline definition without intrinsic dimensions", () => {
    expect(() => validateArticleGameLayouts([
      ...ARTICLE_GAME_DEFINITIONS,
    ])).not.toThrow();
    expect(() => validateArticleGameLayouts([
      { ...ARTICLE_GAME_DEFINITIONS.find((game) => game.id === "international-chess")!, availability: "offline" },
    ])).toThrow(/intrinsic/i);
  });

  it("provides the window fit size for an offline game and restores the normal size", () => {
    expect(articleGameWindowLayout(ARTICLE_GAME_DEFINITIONS.find((game) => game.id === "react-tetris")!)).toEqual({
      width: 640,
      height: 610,
      chromeWidth: 300,
      chromeHeight: 176,
      contentWidth: 940,
      contentHeight: 786,
      normalCenterSize: { width: 1080, height: 730 },
    });
    expect(articleGameWindowLayout(ARTICLE_GAME_DEFINITIONS.find((game) => game.id === "international-chess")!)).toBeNull();
  });

  it("uses the compact cropped xiangqi surface instead of the old oversized canvas", () => {
    expect(articleGameFrameSpec(ARTICLE_GAME_DEFINITIONS.find((game) => game.id === "xiangqi-h5")!)).toEqual({
      layout: "xiangqi",
      width: 523,
      height: 640,
      chromeWidth: 300,
      chromeHeight: 176,
      normalCenterSize: { width: 1080, height: 730 },
    });
  });

  it("gives 2048 room for its compact desktop side panel", () => {
    expect(articleGameFrameSpec(ARTICLE_GAME_DEFINITIONS.find((game) => game.id === "2048")!)).toEqual({
      layout: "board",
      width: 760,
      height: 640,
      chromeWidth: 500,
      chromeHeight: 176,
      normalCenterSize: { width: 1080, height: 730 },
    });
  });

  it("never returns a content size narrower or shorter than the intrinsic game surface", () => {
    expect(calculateArticleGameContentSize({ width: 960, height: 700, chromeWidth: 300, chromeHeight: 176 })).toEqual({
      width: 1260,
      height: 876,
    });
  });
});
