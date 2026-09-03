export const ARTICLE_GAME_IDS = [
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
] as const;

export type ArticleGameId = (typeof ARTICLE_GAME_IDS)[number];
export type ArticleGameAvailability = "offline" | "online";

export interface ArticleGameDefinition {
  id: ArticleGameId;
  title: string;
  description: string;
  icon: string;
  availability: ArticleGameAvailability;
  requiresNetwork: boolean;
  entryPath: string;
  sourceUrl: string;
  sourceCommit: string;
  license: string;
  controls: string;
  difficulty: string;
  onlineUrl?: string;
}

export interface ArticleGameOpenResult {
  ok: boolean;
  message: string;
}

/**
 * The catalog is deliberately data-only. Upstream games run inside one
 * sandboxed iframe; this registry is the single source of truth for the UI,
 * IPC validation, provenance, and the packaged asset contract.
 */
export const ARTICLE_GAME_DEFINITIONS: readonly ArticleGameDefinition[] = [
  {
    id: "pacman",
    title: "吃豆人",
    description: "经典迷宫追逐，吃豆子并躲开幽灵。",
    icon: "pacman",
    availability: "offline",
    requiresNetwork: false,
    entryPath: "index.html",
    sourceUrl: "https://github.com/mumuy/pacman",
    sourceCommit: "8a96194f7cf0102db2d7f0e69450166beb1d7116",
    license: "MIT",
    controls: "方向键 / WASD",
    difficulty: "单人挑战",
  },
  {
    id: "react-tetris",
    title: "俄罗斯方块",
    description: "旋转、下落、消行，保持方块井不被填满。",
    icon: "blocks",
    availability: "offline",
    requiresNetwork: false,
    entryPath: "index.html",
    sourceUrl: "https://github.com/chvin/react-tetris",
    sourceCommit: "89435b72f127b67f95870c515a130cbff38fd7cf",
    license: "Apache-2.0",
    controls: "方向键 / 空格 / P",
    difficulty: "6级速度",
  },
  {
    id: "battle-city",
    title: "坦克大战",
    description: "驾驶坦克守护基地，清除战场上的敌方坦克。",
    icon: "tank",
    availability: "offline",
    requiresNetwork: false,
    entryPath: "index.html",
    sourceUrl: "https://github.com/feichao93/battle-city",
    sourceCommit: "745c369af6d4a02c71560265fd9448518e99c18d",
    license: "MIT",
    controls: "P1 WASD + J · P2 方向键 + /",
    difficulty: "单双人关卡",
  },
  {
    id: "international-chess",
    title: "国际象棋",
    description: "进入 Lichess 在线棋盘，连接完整的国际象棋服务。",
    icon: "chess",
    availability: "online",
    requiresNetwork: true,
    entryPath: "index.html",
    sourceUrl: "https://github.com/ornicar/lila",
    sourceCommit: "9b49f37fe9d953c85dae12bbc159a0bf721a9fca",
    license: "AGPL-3.0",
    controls: "浏览器棋盘操作",
    difficulty: "在线服务",
    onlineUrl: "https://lichess.org/",
  },
  {
    id: "star-battle",
    title: "星际大战",
    description: "驾驶飞船穿越星海，躲避陨石并击落敌方目标。",
    icon: "star",
    availability: "offline",
    requiresNetwork: false,
    entryPath: "index.html",
    sourceUrl: "https://github.com/gd4Ark/star-battle",
    sourceCommit: "b600e9e91012886f6273d6b3c91d6ab83b5eecad",
    license: "MIT",
    controls: "鼠标点击",
    difficulty: "逻辑解谜",
  },
  {
    id: "space-invaders",
    title: "太空侵略者",
    description: "移动炮台并消灭不断逼近的外星入侵者。",
    icon: "rocket",
    availability: "offline",
    requiresNetwork: false,
    entryPath: "index.html",
    sourceUrl: "https://github.com/StrykerKKD/SpaceInvaders",
    sourceCommit: "6de3f7cfe5ec0cc07e8a437bd80af7b6246c3c1d",
    license: "MIT",
    controls: "方向键 / 空格",
    difficulty: "波次挑战",
  },
  {
    id: "snake",
    title: "贪吃蛇",
    description: "吃下食物不断变长，避开边界和自己的身体。",
    icon: "snake",
    availability: "offline",
    requiresNetwork: false,
    entryPath: "index.html",
    sourceUrl: "https://github.com/RabiRoshan/snake_game",
    sourceCommit: "a381235802ff2a606ee76ba440c5ed1b7e95b367",
    license: "MIT",
    controls: "方向键 / WASD",
    difficulty: "速度递增",
  },
  {
    id: "super-mario-bros",
    title: "超级马里奥",
    description: "在横向关卡中奔跑、跳跃，探索经典平台冒险。",
    icon: "mario",
    availability: "offline",
    requiresNetwork: false,
    entryPath: "index.html",
    sourceUrl: "https://github.com/martindrapeau/backbone-game-engine",
    sourceCommit: "2a41299a3895a4fd1fdcaf854579cc13bbe17614",
    license: "MIT",
    controls: "方向键 / Z / X / P",
    difficulty: "简单3次复活 / 困难无复活",
  },
  {
    id: "2048",
    title: "2048",
    description: "滑动合并数字方块，目标是合成 2048。",
    icon: "2048",
    availability: "offline",
    requiresNetwork: false,
    entryPath: "index.html",
    sourceUrl: "https://github.com/gabrielecirulli/2048",
    sourceCommit: "478b6ec346e3787f589e4af751378d06ded4cbbc",
    license: "MIT",
    controls: "方向键 / WASD",
    difficulty: "数字策略",
  },
  {
    id: "sliding-puzzle",
    title: "滑块拼图",
    description: "移动数字方块，把打乱的棋盘还原成完整顺序。",
    icon: "puzzle",
    availability: "offline",
    requiresNetwork: false,
    entryPath: "index.html",
    sourceUrl: "https://github.com/gamedolphin/sliding_puzzle",
    sourceCommit: "440ac2f59b28f279f6143d91ab1b585b450aef9c",
    license: "未声明",
    controls: "鼠标点击",
    difficulty: "益智挑战",
  },
  {
    id: "xiangqi-h5",
    title: "中国象棋",
    description: "保留你指定的 H5 象棋仓库，支持本地人机对战。",
    icon: "xiangqi",
    availability: "offline",
    requiresNetwork: false,
    entryPath: "index.html",
    sourceUrl: "https://github.com/itlwei/Chess",
    sourceCommit: "e8b4c0fea5220e08528286b157caa8f884f62505",
    license: "MIT",
    controls: "鼠标点击棋子",
    difficulty: "三档人机",
  },
] as const;

export function isArticleGameId(value: unknown): value is ArticleGameId {
  return typeof value === "string" && ARTICLE_GAME_IDS.includes(value as ArticleGameId);
}

export function getArticleGameDefinition(id: ArticleGameId): ArticleGameDefinition {
  const definition = ARTICLE_GAME_DEFINITIONS.find((item) => item.id === id);
  if (!definition) throw new Error(`未知的文章游戏：${id}`);
  return definition;
}
