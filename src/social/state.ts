import type {
  FriendRequest,
  GameInvite,
  GameMove,
  GameRoom,
  GameSeat,
  RoomPlayer,
  SocialUser,
} from "./types";
import { GOMOKU_POSITION_LENGTH } from "./types";
import {
  getOnlineGameEngine,
  parseOnlinePosition,
} from "../online-games/engine";
import type { OnlineGameId, OnlineMoveCandidate } from "../online-games/types";
import {
  applyGomokuMove,
  boardFromString,
  boardToString,
  findGomokuWinner,
  GOMOKU_SIZE,
  isGomokuBoardFull,
  type GomokuPlayer,
} from "../gomoku/logic";

export const MAX_MESSAGE_LENGTH = 2_000;

export type SocialErrorCode =
  | "INVALID_INPUT"
  | "FRIEND_REQUEST_EXISTS"
  | "FRIEND_NOT_FOUND"
  | "INVALID_FRIEND_REQUEST_STATE"
  | "INVITE_EXPIRED"
  | "INVALID_INVITE_STATE"
  | "ROOM_FULL"
  | "ROOM_NOT_FOUND"
  | "INVALID_ROOM_STATE"
  | "MOVE_REJECTED"
  | "CONFIGURATION"
  | "NETWORK"
  | "UNAUTHORIZED"
  | "UNKNOWN";

export class SocialError extends Error {
  readonly code: SocialErrorCode;

  constructor(code: SocialErrorCode, message: string) {
    super(message);
    this.name = "SocialError";
    this.code = code;
  }
}

export function socialErrorMessage(error: unknown): string {
  if (error instanceof SocialError) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "社交服务暂时不可用";
}

export function normalizeMessageBody(body: string): string {
  if (typeof body !== "string") {
    throw new SocialError("INVALID_INPUT", "消息内容无效");
  }
  const normalized = body.trim();
  if (!normalized) throw new SocialError("INVALID_INPUT", "消息不能为空");
  if (normalized.length > MAX_MESSAGE_LENGTH) {
    throw new SocialError("INVALID_INPUT", `消息不能超过 ${MAX_MESSAGE_LENGTH} 个字符`);
  }
  return normalized;
}

function ensurePendingInvite(invite: GameInvite, now: number): void {
  if (invite.status !== "pending") {
    throw new SocialError("INVALID_INVITE_STATE", "邀请当前状态不能处理");
  }
  if (now >= invite.expiresAt) {
    throw new SocialError("INVITE_EXPIRED", "这条邀请已经过期");
  }
}

export function acceptInvite(invite: GameInvite, now = Date.now()): GameInvite {
  ensurePendingInvite(invite, now);
  return { ...invite, status: "accepted" };
}

export function declineInvite(invite: GameInvite, now = Date.now()): GameInvite {
  ensurePendingInvite(invite, now);
  return { ...invite, status: "declined" };
}

function ensurePendingFriendRequest(request: FriendRequest, actorId: string): void {
  if (!actorId.trim() || request.to.id !== actorId) {
    throw new SocialError("INVALID_FRIEND_REQUEST_STATE", "只有接收方可以处理好友请求");
  }
  if (request.status !== "pending") {
    throw new SocialError("INVALID_FRIEND_REQUEST_STATE", "这条好友请求当前状态不能处理");
  }
}

export function acceptFriendRequest(
  request: FriendRequest,
  actorId: string,
  now = Date.now(),
): FriendRequest {
  ensurePendingFriendRequest(request, actorId);
  return { ...request, status: "accepted", updatedAt: now };
}

export function declineFriendRequest(
  request: FriendRequest,
  actorId: string,
  now = Date.now(),
): FriendRequest {
  ensurePendingFriendRequest(request, actorId);
  return { ...request, status: "declined", updatedAt: now };
}

export function assertFriendRequestAllowed(
  actorId: string,
  targetId: string,
  requests: FriendRequest[],
  friendIds: string[],
): void {
  if (!actorId.trim() || !targetId.trim()) {
    throw new SocialError("INVALID_INPUT", "好友对象无效");
  }
  if (actorId === targetId) {
    throw new SocialError("INVALID_INPUT", "不能给自己发送好友请求");
  }
  if (friendIds.includes(targetId)) {
    throw new SocialError("FRIEND_REQUEST_EXISTS", "你们已经是好友");
  }
  const duplicate = requests.some((request) => {
    const samePair = (request.from.id === actorId && request.to.id === targetId)
      || (request.from.id === targetId && request.to.id === actorId);
    return samePair && (request.status === "pending" || request.status === "accepted");
  });
  if (duplicate) {
    throw new SocialError("FRIEND_REQUEST_EXISTS", "重复的好友请求已经存在或正在处理中");
  }
}

function playerFor(room: GameRoom, seat: GameSeat): RoomPlayer | null {
  return room.players[seat];
}

function playersAfterMove(room: GameRoom, finished: boolean): GameRoom["players"] {
  if (!finished) return room.players;
  return {
    red: room.players.red ? { ...room.players.red, ready: false } : null,
    black: room.players.black ? { ...room.players.black, ready: false } : null,
  };
}

export function assignRoomSeat(room: GameRoom, user: SocialUser): { room: GameRoom; seat: GameSeat } {
  for (const seat of ["red", "black"] as const) {
    if (playerFor(room, seat)?.user.id === user.id) return { room, seat };
  }

  const seat = room.players.red === null ? "red" : room.players.black === null ? "black" : null;
  if (!seat) throw new SocialError("ROOM_FULL", "这个房间的席位已满");

  const nextPlayer: RoomPlayer = { user, seat, ready: false, connected: true };
  return {
    seat,
    room: {
      ...room,
      players: { ...room.players, [seat]: nextPlayer },
      updatedAt: Date.now(),
    },
  };
}

function validPoint(point: { x: number; y: number }, sizeX: number, sizeY: number): boolean {
  return Number.isInteger(point.x) && Number.isInteger(point.y)
    && point.x >= 0 && point.x < sizeX && point.y >= 0 && point.y < sizeY;
}

function validGomokuPosition(position: string): boolean {
  return position.length === GOMOKU_POSITION_LENGTH && /^[012]+$/.test(position);
}

function samePoint(left: { x: number; y: number }, right: { x: number; y: number }): boolean {
  return left.x === right.x && left.y === right.y;
}

function gomokuPlayerForSeat(seat: GameSeat): GomokuPlayer {
  return seat === "red" ? 1 : 2;
}

function canApplyGomokuMove(room: GameRoom, move: GameMove): boolean {
  if (!validPoint(move.from, GOMOKU_SIZE, GOMOKU_SIZE)
    || !validPoint(move.to, GOMOKU_SIZE, GOMOKU_SIZE)
    || !samePoint(move.from, move.to)
    || move.captured !== null
    || !validGomokuPosition(room.position)
    || !validGomokuPosition(move.position)) return false;

  const board = boardFromString(room.position);
  const point = { row: move.from.y, col: move.from.x };
  const next = applyGomokuMove(board, point, gomokuPlayerForSeat(move.seat));
  return next !== null && boardToString(next) === move.position;
}

function sameMovePoint(left: { x: number; y: number }, right: { x: number; y: number }): boolean {
  return left.x === right.x && left.y === right.y;
}

function canApplyEngineMove(room: GameRoom, move: GameMove): boolean {
  try {
    const gameId = move.gameId as unknown as OnlineGameId;
    const engine = getOnlineGameEngine(gameId);
    const state = engine.parse(room.position);
    if (!state || state.turn !== move.seat) return false;
    const candidate = engine.legalMoves(room.position, move.seat, move.from)
      .find((item: OnlineMoveCandidate) => sameMovePoint(item.to, move.to)
        && (item.captured === null ? move.captured === null : move.captured !== null && sameMovePoint(item.captured, move.captured)));
    if (!candidate) return false;
    return engine.apply(room.position, move.seat, candidate) === move.position;
  } catch {
    return false;
  }
}

export function canApplyMove(room: GameRoom, move: GameMove): boolean {
  const envelopeValid = room.id === move.roomId
    && room.gameId === move.gameId
    && room.status === "playing"
    && !room.undoRequest
    && room.turn === move.seat
    && room.seq + 1 === move.seq
    && typeof move.position === "string";
  if (!envelopeValid) return false;
  if (room.gameId === "gomoku") return canApplyGomokuMove(room, move);
  if (room.gameId === "xiangqi" && (room.position === "initial" || !parseOnlinePosition("xiangqi" as OnlineGameId, room.position))) {
    // The first released Xiangqi iframe sent opaque snapshots. Keep accepting
    // that format while new structured rooms use the shared engine below.
    return validPoint(move.from, 9, 10)
      && validPoint(move.to, 9, 10)
      && move.position.length > 0;
  }
  return canApplyEngineMove(room, move);
}

function moveRejection(room: GameRoom, move: GameMove): SocialError {
  if (room.id !== move.roomId) return new SocialError("MOVE_REJECTED", "走子不属于当前房间");
  if (room.gameId !== move.gameId) return new SocialError("MOVE_REJECTED", "游戏类型不匹配");
  if (room.status !== "playing") return new SocialError("MOVE_REJECTED", "当前房间还不能落子");
  if (room.undoRequest) return new SocialError("MOVE_REJECTED", "请先处理当前悔棋请求");
  if (room.turn !== move.seat) return new SocialError("MOVE_REJECTED", "还没轮到这个席位");
  if (room.seq + 1 !== move.seq) return new SocialError("MOVE_REJECTED", "走子序号不连续，请重新同步棋局");
  return new SocialError("MOVE_REJECTED", "走子数据无效");
}

export function applyRoomMove(room: GameRoom, move: GameMove): GameRoom {
  if (!canApplyMove(room, move)) throw moveRejection(room, move);
  const nextTurn: GameSeat = move.seat === "red" ? "black" : "red";
  if (room.gameId === "gomoku") {
    const board = boardFromString(move.position);
    const winner = findGomokuWinner(board);
    const finished = Boolean(winner) || isGomokuBoardFull(board);
    return {
      ...room,
      turn: nextTurn,
      seq: move.seq,
      position: move.position,
      lastMove: { ...move },
      undoRequest: null,
      rematchRequest: null,
      players: playersAfterMove(room, finished),
      status: finished ? "finished" : room.status,
      winner: winner ? (winner.player === 1 ? "red" : "black") : null,
      updatedAt: move.createdAt,
    };
  }
  if (room.gameId !== "xiangqi" || parseOnlinePosition("xiangqi" as OnlineGameId, move.position)) {
    const state = parseOnlinePosition(move.gameId as unknown as OnlineGameId, move.position);
    const result = state && typeof state.result === "string" ? state.result : null;
    const finished = result === "red" || result === "black" || result === "draw";
    return {
      ...room,
      turn: state?.turn === "red" || state?.turn === "black" ? state.turn : nextTurn,
      seq: move.seq,
      position: move.position,
      lastMove: { ...move },
      undoRequest: null,
      rematchRequest: null,
      players: playersAfterMove(room, finished),
      status: finished ? "finished" : room.status,
      winner: result === "red" || result === "black" ? result : null,
      updatedAt: move.createdAt,
    };
  }
  return {
    ...room,
    turn: nextTurn,
    seq: move.seq,
    position: move.position,
    lastMove: { ...move },
    undoRequest: null,
    rematchRequest: null,
    updatedAt: move.createdAt,
  };
}
