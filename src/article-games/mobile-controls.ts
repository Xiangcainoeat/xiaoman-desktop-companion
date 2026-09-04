import type { ArticleGameId } from "./registry";

export type GameInputMode = "auto" | "desktop" | "mobile";
export type ResolvedGameInputMode = Exclude<GameInputMode, "auto">;
export type MobileControlIcon = "left" | "right" | "up" | "down" | "rotate" | "drop" | "fire" | "jump" | "run";

export interface MobileControlAction {
  id: string;
  label: string;
  icon: MobileControlIcon;
  key: string;
  code: string;
  keyCode: number;
  hold?: boolean;
  position?: "up" | "right" | "down" | "left";
}

export interface MobileControlProfile {
  kind: "buttons" | "direct" | "external";
  hint: string;
  directions?: readonly MobileControlAction[];
  actions?: readonly MobileControlAction[];
}

export const GAME_INPUT_MODE_STORAGE_KEY = "xiaoman.article-game.input-mode";

const arrow = (
  position: NonNullable<MobileControlAction["position"]>,
  overrides: Partial<MobileControlAction> = {},
): MobileControlAction => {
  const values = {
    left: { label: "左移", key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
    up: { label: "上移", key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
    right: { label: "右移", key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
    down: { label: "下移", key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  }[position];
  return { id: position, icon: position, position, ...values, ...overrides };
};

const wasd = (
  position: NonNullable<MobileControlAction["position"]>,
  overrides: Partial<MobileControlAction> = {},
): MobileControlAction => {
  const values = {
    left: { label: "左移", key: "a", code: "KeyA", keyCode: 65 },
    up: { label: "上移", key: "w", code: "KeyW", keyCode: 87 },
    right: { label: "右移", key: "d", code: "KeyD", keyCode: 68 },
    down: { label: "下移", key: "s", code: "KeyS", keyCode: 83 },
  }[position];
  return { id: position, icon: position, position, ...values, ...overrides };
};

const DIRECTIONS = [arrow("up"), arrow("right"), arrow("down"), arrow("left")] as const;

export const MOBILE_GAME_CONTROLS: Record<ArticleGameId, MobileControlProfile> = {
  pacman: {
    kind: "buttons",
    hint: "方向键控制吃豆人",
    directions: DIRECTIONS,
  },
  "react-tetris": {
    kind: "buttons",
    hint: "长按左右或下移，点击旋转与硬降",
    directions: [arrow("left", { hold: true }), arrow("right", { hold: true }), arrow("down", { hold: true })],
    actions: [
      { id: "rotate", label: "旋转", icon: "rotate", key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
      { id: "drop", label: "硬降", icon: "drop", key: " ", code: "Space", keyCode: 32 },
    ],
  },
  "battle-city": {
    kind: "buttons",
    hint: "手机端控制玩家一",
    directions: [wasd("up", { hold: true }), wasd("right", { hold: true }), wasd("down", { hold: true }), wasd("left", { hold: true })],
    actions: [{ id: "fire", label: "开火", icon: "fire", key: "j", code: "KeyJ", keyCode: 74 }],
  },
  "international-chess": {
    kind: "external",
    hint: "在在线棋盘中直接触摸棋子",
  },
  "star-battle": {
    kind: "direct",
    hint: "直接点击棋盘完成操作",
  },
  "space-invaders": {
    kind: "buttons",
    hint: "长按移动，点击发射",
    directions: [arrow("left", { hold: true }), arrow("right", { hold: true })],
    actions: [{ id: "fire", label: "发射", icon: "fire", key: " ", code: "Space", keyCode: 32 }],
  },
  snake: {
    kind: "buttons",
    hint: "方向键改变移动方向",
    directions: DIRECTIONS,
  },
  "super-mario-bros": {
    kind: "buttons",
    hint: "长按移动或奔跑，点击跳跃",
    directions: [arrow("left", { hold: true }), arrow("right", { hold: true })],
    actions: [
      { id: "jump", label: "跳跃", icon: "jump", key: "z", code: "KeyZ", keyCode: 90 },
      { id: "run", label: "奔跑", icon: "run", key: "x", code: "KeyX", keyCode: 88, hold: true },
    ],
  },
  "2048": {
    kind: "direct",
    hint: "在棋盘上滑动移动全部数字块",
  },
  "sliding-puzzle": {
    kind: "direct",
    hint: "直接点击与空位相邻的数字块",
  },
  "xiangqi-h5": {
    kind: "direct",
    hint: "直接点击棋子与目标位置",
  },
};

export function resolveGameInputMode(
  mode: GameInputMode,
  viewportWidth: number,
  coarsePointer: boolean,
): ResolvedGameInputMode {
  if (mode !== "auto") return mode;
  return coarsePointer || viewportWidth <= 760 ? "mobile" : "desktop";
}

export function mobileControlProfile(gameId: ArticleGameId): MobileControlProfile {
  return MOBILE_GAME_CONTROLS[gameId];
}

export function mobileProfileKeyCodes(profile: MobileControlProfile): number[] {
  return [...(profile.directions ?? []), ...(profile.actions ?? [])].map((action) => action.keyCode);
}
