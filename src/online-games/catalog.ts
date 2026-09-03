import { getOnlineGameEngine } from "./engine";
import { ONLINE_GAME_IDS, type OnlineGameCatalogEntry, type OnlineGameId } from "./types";

const CATALOG_META: Record<OnlineGameId, Omit<OnlineGameCatalogEntry, "id" | "engine">> = {
  gomoku: {
    label: "五子棋",
    shortLabel: "五子",
    description: "黑白双方轮流落子，先连成五子者获胜。",
    players: "双人",
    ruleSummary: "15×15 棋盘 · 五子连线",
  },
  "tic-tac-toe": {
    label: "井字棋",
    shortLabel: "井字",
    description: "三乘三棋盘上轮流落子，先连成三子者获胜。",
    players: "双人",
    ruleSummary: "3×3 棋盘 · 三子连线",
  },
  chess: {
    label: "国际象棋",
    shortLabel: "国际",
    description: "在八乘八棋盘上移动棋子，使用标准棋子走法对弈。",
    players: "双人",
    ruleSummary: "8×8 棋盘 · 基础走法",
  },
  reversi: {
    label: "黑白棋",
    shortLabel: "黑白",
    description: "夹住对手棋子并翻转它们，结束时棋子更多的一方获胜。",
    players: "双人",
    ruleSummary: "8×8 棋盘 · 夹子翻转",
  },
  checkers: {
    label: "跳棋",
    shortLabel: "跳棋",
    description: "沿斜线移动或跳吃对手棋子，抵达对侧后可升变。",
    players: "双人",
    ruleSummary: "8×8 棋盘 · 斜线跳吃",
  },
  xiangqi: {
    label: "中国象棋",
    shortLabel: "象棋",
    description: "红黑双方在九路十行棋盘上交锋，按基础棋子走法落子。",
    players: "双人",
    ruleSummary: "9×10 棋盘 · 中国象棋",
  },
  go: {
    label: "围棋",
    shortLabel: "围棋",
    description: "在棋盘交叉点落子，围住并提取对手棋群。",
    players: "双人",
    ruleSummary: "9×9 棋盘 · 基础提子",
  },
  shogi: {
    label: "日本将棋",
    shortLabel: "将棋",
    description: "在九路棋盘上移动将棋棋子，支持基础移动和吃子。",
    players: "双人",
    ruleSummary: "9×9 棋盘 · 基础走法",
  },
  connect6: {
    label: "六子棋",
    shortLabel: "六子",
    description: "首手一子，之后每回合两子，先连成六子者获胜。",
    players: "双人",
    ruleSummary: "19×19 棋盘 · 每回合一至两子",
  },
  ludo: {
    label: "飞行棋",
    shortLabel: "飞行",
    description: "选择自己的棋子沿轨道前进，房间协议会记录棋子位置。",
    players: "双人",
    ruleSummary: "轨道棋盘 · 四枚棋子",
  },
  "animal-chess": {
    label: "斗兽棋",
    shortLabel: "斗兽",
    description: "在动物棋盘上移动己方棋子并吃掉对手棋子。",
    players: "双人",
    ruleSummary: "8×4 棋盘 · 动物棋子",
  },
  "army-chess": {
    label: "军棋",
    shortLabel: "军棋",
    description: "双方移动军棋棋子，在简洁棋盘上进行回合制对抗。",
    players: "双人",
    ruleSummary: "5×12 棋盘 · 回合制移动",
  },
  backgammon: {
    label: "双陆棋",
    shortLabel: "双陆",
    description: "沿二十四个点位移动棋子，房间状态会保存每一步。",
    players: "双人",
    ruleSummary: "24 点位 · 基础骰点",
  },
  "dots-and-boxes": {
    label: "点格棋",
    shortLabel: "点格",
    description: "连接相邻点，完成方格后取得该格并继续行动。",
    players: "双人",
    ruleSummary: "4×4 点阵 · 连线得格",
  },
  mancala: {
    label: "播棋",
    shortLabel: "播棋",
    description: "从己方坑位播撒棋子，收集更多棋子到自己的仓。",
    players: "双人",
    ruleSummary: "六坑一仓 · 播撒收集",
  },
  "chinese-checkers": {
    label: "中国跳棋",
    shortLabel: "中国跳棋",
    description: "沿六方向移动或跳跃棋子，把己方棋子移到对侧区域。",
    players: "双人",
    ruleSummary: "星形孔位 · 六方向跳跃",
  },
};

export const ONLINE_GAME_CATALOG: readonly OnlineGameCatalogEntry[] = ONLINE_GAME_IDS.map((id) => ({
  id,
  ...CATALOG_META[id],
  engine: getOnlineGameEngine(id),
}));

export function getOnlineGameDefinition(gameId: OnlineGameId): OnlineGameCatalogEntry {
  return ONLINE_GAME_CATALOG.find((entry) => entry.id === gameId) ?? ONLINE_GAME_CATALOG[0];
}
