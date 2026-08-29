import type { ArticleGameDefinition } from "./registry";

/**
 * The embedded projects keep their own native canvas dimensions. The host
 * chooses a frame size that gives each project room without scaling its core
 * surface down to fit an arbitrary common rectangle.
 */
export type ArticleGameFrameLayout =
  | "default"
  | "board"
  | "portrait"
  | "square"
  | "wide"
  | "tall"
  | "xiangqi";

export interface ArticleGameFrameSpec {
  layout: ArticleGameFrameLayout;
  /** The intrinsic surface width. Online entries deliberately omit it. */
  width?: number;
  /** The intrinsic surface height. Online entries deliberately omit it. */
  height?: number;
  /** Width reserved for the center-window shell around the game surface. */
  chromeWidth?: number;
  /** Host chrome height reserved above and below the game surface. */
  chromeHeight?: number;
  /** The ordinary center-window outer size used outside an active game. */
  normalCenterSize?: { width: number; height: number };
}

export interface ArticleGameWindowLayout {
  width: number;
  height: number;
  chromeWidth: number;
  chromeHeight: number;
  contentWidth: number;
  contentHeight: number;
  normalCenterSize: { width: number; height: number };
}

export const NORMAL_CENTER_WINDOW_SIZE = { width: 1080, height: 730 } as const;
const ARTICLE_GAME_CHROME_WIDTH = 300;
const ARTICLE_GAME_CHROME_HEIGHT = 176;

const FRAME_SPECS: Record<ArticleGameDefinition["id"], ArticleGameFrameSpec> = {
  pacman: { layout: "wide", width: 960, height: 640, chromeWidth: ARTICLE_GAME_CHROME_WIDTH, chromeHeight: ARTICLE_GAME_CHROME_HEIGHT, normalCenterSize: NORMAL_CENTER_WINDOW_SIZE },
  "react-tetris": { layout: "tall", width: 640, height: 960, chromeWidth: ARTICLE_GAME_CHROME_WIDTH, chromeHeight: ARTICLE_GAME_CHROME_HEIGHT, normalCenterSize: NORMAL_CENTER_WINDOW_SIZE },
  "battle-city": { layout: "wide", width: 768, height: 720, chromeWidth: 500, chromeHeight: ARTICLE_GAME_CHROME_HEIGHT, normalCenterSize: NORMAL_CENTER_WINDOW_SIZE },
  "international-chess": { layout: "default" },
  "star-battle": { layout: "wide", width: 960, height: 480, chromeWidth: ARTICLE_GAME_CHROME_WIDTH, chromeHeight: ARTICLE_GAME_CHROME_HEIGHT, normalCenterSize: NORMAL_CENTER_WINDOW_SIZE },
  "space-invaders": { layout: "wide", width: 800, height: 600, chromeWidth: ARTICLE_GAME_CHROME_WIDTH, chromeHeight: ARTICLE_GAME_CHROME_HEIGHT, normalCenterSize: NORMAL_CENTER_WINDOW_SIZE },
  snake: { layout: "square", width: 720, height: 720, chromeWidth: ARTICLE_GAME_CHROME_WIDTH, chromeHeight: ARTICLE_GAME_CHROME_HEIGHT, normalCenterSize: NORMAL_CENTER_WINDOW_SIZE },
  "super-mario-bros": { layout: "wide", width: 960, height: 700, chromeWidth: ARTICLE_GAME_CHROME_WIDTH, chromeHeight: ARTICLE_GAME_CHROME_HEIGHT, normalCenterSize: NORMAL_CENTER_WINDOW_SIZE },
  "2048": { layout: "board", width: 760, height: 640, chromeWidth: 500, chromeHeight: ARTICLE_GAME_CHROME_HEIGHT, normalCenterSize: NORMAL_CENTER_WINDOW_SIZE },
  "xiangqi-h5": { layout: "xiangqi", width: 523, height: 640, chromeWidth: ARTICLE_GAME_CHROME_WIDTH, chromeHeight: ARTICLE_GAME_CHROME_HEIGHT, normalCenterSize: NORMAL_CENTER_WINDOW_SIZE },
};

export function validateArticleGameLayouts(
  definitions: readonly Pick<ArticleGameDefinition, "id" | "availability">[],
): void {
  for (const definition of definitions) {
    const spec = FRAME_SPECS[definition.id];
    if (definition.availability === "offline"
      && (!spec.width || !spec.height || !spec.chromeWidth || !spec.chromeHeight || !spec.normalCenterSize)) {
      throw new Error(`Offline article game ${definition.id} is missing intrinsic dimensions`);
    }
  }
}

validateArticleGameLayouts([
  { id: "pacman", availability: "offline" },
  { id: "react-tetris", availability: "offline" },
  { id: "battle-city", availability: "offline" },
  { id: "international-chess", availability: "online" },
  { id: "star-battle", availability: "offline" },
  { id: "space-invaders", availability: "offline" },
  { id: "snake", availability: "offline" },
  { id: "super-mario-bros", availability: "offline" },
  { id: "2048", availability: "offline" },
  { id: "xiangqi-h5", availability: "offline" },
]);

export function articleGameFrameSpec(
  definition: Pick<ArticleGameDefinition, "id">,
): ArticleGameFrameSpec {
  return FRAME_SPECS[definition.id];
}

export function articleGameFrameLayout(
  definition: Pick<ArticleGameDefinition, "id">,
): ArticleGameFrameLayout {
  return articleGameFrameSpec(definition).layout;
}

export function articleGameWindowLayout(
  definition: Pick<ArticleGameDefinition, "id" | "availability">,
): ArticleGameWindowLayout | null {
  const spec = articleGameFrameSpec(definition);
  if (definition.availability !== "offline") return null;
  if (!spec.width || !spec.height || !spec.chromeWidth || !spec.chromeHeight || !spec.normalCenterSize) {
    throw new Error(`Offline article game ${definition.id} is missing intrinsic dimensions`);
  }
  const contentSize = calculateArticleGameContentSize({
    width: spec.width,
    height: spec.height,
    chromeWidth: spec.chromeWidth,
    chromeHeight: spec.chromeHeight,
  });
  return {
    width: spec.width,
    height: spec.height,
    chromeWidth: spec.chromeWidth,
    chromeHeight: spec.chromeHeight,
    contentWidth: contentSize.width,
    contentHeight: contentSize.height,
    normalCenterSize: spec.normalCenterSize,
  };
}

export function calculateArticleGameContentSize(input: {
  width: number;
  height: number;
  chromeWidth: number;
  chromeHeight: number;
}): { width: number; height: number } {
  return {
    width: Math.max(1, Math.ceil(input.width + input.chromeWidth)),
    height: Math.max(1, Math.ceil(input.height + input.chromeHeight)),
  };
}
