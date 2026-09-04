import type { GameMove, GameRoom, GameSeat } from "../social/types";

export const ONLINE_GAME_IDS = [
  "gomoku",
  "tic-tac-toe",
  "chess",
  "reversi",
  "checkers",
  "xiangqi",
  "go",
  "shogi",
  "connect6",
  "ludo",
  "animal-chess",
  "army-chess",
  "backgammon",
  "dots-and-boxes",
  "mancala",
  "chinese-checkers",
] as const;

export type OnlineGameId = typeof ONLINE_GAME_IDS[number];
export type OnlinePoint = { x: number; y: number };
export type OnlineBoardValue = string | number[] | Record<string, unknown>;

export type OnlineBoardKind = "grid" | "dots" | "mancala" | "track" | "backgammon" | "star";

export interface OnlineBoardSpec {
  kind: OnlineBoardKind;
  columns: number;
  rows: number;
  /** The playable coordinates used by the renderer and move encoder. */
  coordinates?: OnlinePoint[];
  cellLabels?: Record<string, string>;
  aspectRatio?: number;
}

export interface OnlinePositionState {
  game: OnlineGameId;
  board: OnlineBoardValue;
  turn: GameSeat;
  /** Extra state is kept outside board only when it is part of the protocol. */
  [key: string]: unknown;
}

export interface OnlineMoveCandidate {
  from: OnlinePoint;
  to: OnlinePoint;
  captured: OnlinePoint | null;
  label?: string;
}

export interface OnlineGameEngine {
  readonly id: OnlineGameId;
  readonly board: OnlineBoardSpec;
  initialPosition(): string;
  parse(position: string): OnlinePositionState | null;
  legalMoves(position: string, seat: GameSeat, from?: OnlinePoint): OnlineMoveCandidate[];
  apply(
    position: string,
    seat: GameSeat,
    move: OnlineMoveCandidate,
  ): string | null;
  cellLabel?(position: string, point: OnlinePoint): string;
}

/** A deliberately small client surface keeps the reusable board testable. */
export interface OnlineBoardClient {
  sendMove(move: GameMove): Promise<void>;
}

export interface OnlineBoardGameProps {
  room: GameRoom;
  seat: GameSeat | null;
  client: OnlineBoardClient;
}

export interface CreateOnlineMoveInput {
  roomId: string;
  gameId: OnlineGameId;
  seat: GameSeat;
  seq: number;
  position: string;
  from: OnlinePoint;
  to?: OnlinePoint;
  createdAt?: number;
}

export interface OnlineGameCatalogEntry {
  id: OnlineGameId;
  label: string;
  shortLabel: string;
  description: string;
  players: string;
  ruleSummary: string;
  engine: OnlineGameEngine;
}
