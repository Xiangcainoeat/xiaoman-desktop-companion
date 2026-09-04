import { AppError } from "./errors.js";
import {
  ONLINE_GAME_IDS,
  SUPPORTED_GAME_IDS,
  isPoint,
  pointBounds,
} from "./online-game-rules.js";

const GOMOKU_SIZE = 15;
const GOMOKU_POSITION_LENGTH = GOMOKU_SIZE * GOMOKU_SIZE;

export function gameId(value) {
  if (!SUPPORTED_GAME_IDS.has(value)) {
    throw new AppError("INVALID_INPUT", `不支持的联机游戏，可用游戏：${ONLINE_GAME_IDS.join("、")}`, 400);
  }
  return value;
}

export function moveInput(value) {
  if (!value || typeof value !== "object") {
    throw new AppError("MOVE_REJECTED", "走子数据无效", 400);
  }
  const selectedGame = gameId(value.gameId);
  const point = (item) => isPoint(item, selectedGame);
  const gomokuMove = selectedGame === "gomoku";
  if ((value.seat !== "red" && value.seat !== "black")
    || !point(value.from) || !point(value.to)
    || (value.captured !== null && value.captured !== undefined && !point(value.captured))
    || typeof value.position !== "string" || !value.position || value.position.length > 500_000
    || !Number.isInteger(value.seq) || value.seq < 1) {
    throw new AppError("MOVE_REJECTED", "走子数据无效", 400);
  }
  if (gomokuMove && (value.from.x !== value.to.x || value.from.y !== value.to.y
    || value.captured !== null
    || value.position.length !== GOMOKU_POSITION_LENGTH
    || !/^[012]+$/.test(value.position))) {
    throw new AppError("MOVE_REJECTED", "五子棋走子数据无效", 400);
  }
  return {
    roomId: typeof value.roomId === "string" ? value.roomId : "",
    gameId: selectedGame,
    seat: value.seat,
    from: { x: value.from.x, y: value.from.y },
    to: { x: value.to.x, y: value.to.y },
    captured: value.captured ? { x: value.captured.x, y: value.captured.y } : null,
    position: value.position,
    seq: value.seq,
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
  };
}

export { GOMOKU_POSITION_LENGTH, GOMOKU_SIZE, ONLINE_GAME_IDS, SUPPORTED_GAME_IDS, pointBounds };
