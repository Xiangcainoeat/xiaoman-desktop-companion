import type { GameMove, GameSeat } from "../social/types";
import {
  applyGomokuMove,
  boardFromString,
  boardToString,
  createGomokuBoard,
  findGomokuWinner,
  GOMOKU_SIZE,
  isGomokuBoardFull,
  type GomokuPlayer,
} from "../gomoku/logic";
import {
  ONLINE_GAME_IDS,
  type CreateOnlineMoveInput,
  type OnlineBoardSpec,
  type OnlineGameEngine,
  type OnlineGameId,
  type OnlineMoveCandidate,
  type OnlinePoint,
  type OnlineBoardValue,
  type OnlinePositionState,
} from "./types";

const RED: GameSeat = "red";
const BLACK: GameSeat = "black";
const DIRECTIONS_4: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRECTIONS_8: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function markFor(seat: GameSeat): string {
  return seat === RED ? "1" : "2";
}

function otherSeat(seat: GameSeat): GameSeat {
  return seat === RED ? BLACK : RED;
}

function pointKey(point: OnlinePoint): string {
  return `${point.x}:${point.y}`;
}

function samePoint(left: OnlinePoint, right: OnlinePoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function inBounds(point: OnlinePoint, columns: number, rows: number): boolean {
  return Number.isInteger(point.x) && Number.isInteger(point.y)
    && point.x >= 0 && point.x < columns && point.y >= 0 && point.y < rows;
}

function indexOf(point: OnlinePoint, columns: number): number {
  return point.y * columns + point.x;
}

function pointAt(index: number, columns: number): OnlinePoint {
  return { x: index % columns, y: Math.floor(index / columns) };
}

function emptyBoard(columns: number, rows: number): string {
  return "0".repeat(columns * rows);
}

function setBoardCell(board: string, point: OnlinePoint, value: string, columns: number): string {
  const index = indexOf(point, columns);
  return `${board.slice(0, index)}${value}${board.slice(index + 1)}`;
}

function jsonPosition(
  game: OnlineGameId,
  board: unknown,
  turn: GameSeat,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({ game, board, turn, ...extra });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGameSeat(value: unknown): value is GameSeat {
  return value === RED || value === BLACK;
}

function parseJsonPosition(game: OnlineGameId, position: string): OnlinePositionState | null {
  try {
    const value: unknown = JSON.parse(position);
    if (!isRecord(value) || value.game !== game || !isGameSeat(value.turn) || value.board === undefined) return null;
    return {
      ...value,
      game,
      board: value.board as OnlineBoardValue,
      turn: value.turn,
    };
  } catch {
    return null;
  }
}

function gridCoordinates(columns: number, rows: number): OnlinePoint[] {
  return Array.from({ length: columns * rows }, (_, index) => pointAt(index, columns));
}

function candidate(from: OnlinePoint, to = from, captured: OnlinePoint | null = null, label?: string): OnlineMoveCandidate {
  return { from, to, captured, ...(label ? { label } : {}) };
}

function candidatesForEmptyGrid(
  position: string,
  columns: number,
  rows: number,
): OnlineMoveCandidate[] {
  const board = parseJsonPositionForBoard(position, columns, rows);
  if (!board) return [];
  return gridCoordinates(columns, rows)
    .filter((point) => board[indexOf(point, columns)] === "0")
    .map((point) => candidate(point));
}

function parseJsonPositionForBoard(position: string, columns: number, rows: number): string | null {
  try {
    const value = JSON.parse(position) as { board?: unknown };
    return typeof value.board === "string" && value.board.length === columns * rows ? value.board : null;
  } catch {
    return null;
  }
}

function makePlacementEngine(
  id: OnlineGameId,
  board: OnlineBoardSpec,
  initialBoard: string,
  options: {
    legalMoves?: (state: OnlinePositionState, seat: GameSeat) => OnlineMoveCandidate[];
    apply?: (state: OnlinePositionState, seat: GameSeat, move: OnlineMoveCandidate) => OnlinePositionState | null;
    cellLabel?: (position: string, point: OnlinePoint) => string;
  } = {},
): OnlineGameEngine {
  return {
    id,
    board,
    initialPosition: () => jsonPosition(id, initialBoard, RED),
    parse: (position) => parseJsonPosition(id, position),
    legalMoves: (position, seat, from) => {
      const state = parseJsonPosition(id, position);
      if (!state || state.turn !== seat) return [];
      const moves = options.legalMoves
        ? options.legalMoves(state, seat)
        : candidatesForEmptyGrid(position, board.columns, board.rows);
      return from ? moves.filter((move) => samePoint(move.from, from)) : moves;
    },
    apply: (position, seat, move) => {
      const state = parseJsonPosition(id, position);
      if (!state || state.turn !== seat) return null;
      const legal = options.legalMoves
        ? options.legalMoves(state, seat)
        : candidatesForEmptyGrid(position, board.columns, board.rows);
      if (!legal.some((item) => samePoint(item.from, move.from) && samePoint(item.to, move.to))) return null;
      if (options.apply) return encodeState(options.apply(state, seat, move));
      const current = typeof state.board === "string" ? state.board : null;
      if (!current || !samePoint(move.from, move.to) || !inBounds(move.to, board.columns, board.rows) || current[indexOf(move.to, board.columns)] !== "0") return null;
      return jsonPosition(id, setBoardCell(current, move.to, markFor(seat), board.columns), otherSeat(seat));
    },
    cellLabel: options.cellLabel,
  };
}

function encodeState(state: OnlinePositionState | null): string | null {
  if (!state) return null;
  const { game, board, turn, ...extra } = state;
  return jsonPosition(game, board, turn, extra);
}

function stringBoard(state: OnlinePositionState, columns: number, rows: number): string | null {
  return typeof state.board === "string" && state.board.length === columns * rows ? state.board : null;
}

function allEmptyGridMoves(state: OnlinePositionState, columns: number, rows: number): OnlineMoveCandidate[] {
  const board = stringBoard(state, columns, rows);
  if (!board) return [];
  return gridCoordinates(columns, rows)
    .filter((point) => board[indexOf(point, columns)] === "0")
    .map((point) => candidate(point));
}

function gomokuInitialBoard(): string {
  return boardToString(createGomokuBoard());
}

const gomokuEngine: OnlineGameEngine = {
  id: "gomoku",
  board: { kind: "grid", columns: GOMOKU_SIZE, rows: GOMOKU_SIZE, aspectRatio: 1 },
  initialPosition: () => jsonPosition("gomoku", gomokuInitialBoard(), RED, { winLength: 5 }),
  parse: (position) => {
    const parsed = parseJsonPosition("gomoku", position);
    if (parsed) return parsed;
    // Compatibility with the already deployed five-in-a-row room protocol.
    if (position.length === GOMOKU_SIZE * GOMOKU_SIZE && /^[012]+$/.test(position)) {
      return { game: "gomoku", board: position, turn: RED, __encoding: "legacy-gomoku" };
    }
    return null;
  },
  legalMoves: (position, seat) => {
    const state = gomokuEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return [];
    const currentBoard = state.board as string;
    return Array.from({ length: GOMOKU_SIZE * GOMOKU_SIZE }, (_, index) => pointAt(index, GOMOKU_SIZE))
      .filter((point) => currentBoard[indexOf(point, GOMOKU_SIZE)] === "0")
      .map((point) => candidate(point));
  },
  apply: (position, seat, move) => {
    const state = gomokuEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string" || !samePoint(move.from, move.to)) return null;
    const board = boardFromString(state.board);
    const next = applyGomokuMove(board, { row: move.from.y, col: move.from.x }, seat === RED ? 1 : 2);
    if (!next) return null;
    const encoded = boardToString(next);
    if (state.__encoding === "legacy-gomoku") return encoded;
    const winner = findGomokuWinner(next);
    return jsonPosition("gomoku", encoded, otherSeat(seat), {
      winLength: 5,
      result: winner ? (winner.player === 1 ? "red" : "black") : isGomokuBoardFull(next) ? "draw" : null,
    });
  },
};

const ticTacToeEngine = makePlacementEngine(
  "tic-tac-toe",
  { kind: "grid", columns: 3, rows: 3, aspectRatio: 1 },
  emptyBoard(3, 3),
  {
    apply: (state, seat, move) => {
      const board = stringBoard(state, 3, 3);
      if (!board || !samePoint(move.from, move.to) || !inBounds(move.to, 3, 3) || board[indexOf(move.to, 3)] !== "0") return null;
      const nextBoard = setBoardCell(board, move.to, markFor(seat), 3);
      const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6],
      ];
      const won = lines.some((line) => line.every((index) => nextBoard[index] === markFor(seat)));
      const full = !nextBoard.includes("0");
      return {
        ...state,
        board: nextBoard,
        turn: otherSeat(seat),
        result: won ? seat : full ? "draw" : null,
      };
    },
  },
);

function connect6Initial(): string {
  return emptyBoard(19, 19);
}

const connect6Engine: OnlineGameEngine = {
  id: "connect6",
  board: { kind: "grid", columns: 19, rows: 19, aspectRatio: 1 },
  initialPosition: () => jsonPosition("connect6", connect6Initial(), RED, { moveCount: 0, stonesThisTurn: 0 }),
  parse: (position) => parseJsonPosition("connect6", position),
  legalMoves: (position, seat) => {
    const state = connect6Engine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return [];
    const currentBoard = state.board as string;
    return gridCoordinates(19, 19).filter((point) => currentBoard[indexOf(point, 19)] === "0").map((point) => candidate(point));
  },
  apply: (position, seat, move) => {
    const state = connect6Engine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string" || !samePoint(move.from, move.to)) return null;
    const index = indexOf(move.to, 19);
    if (state.board[index] !== "0") return null;
    const moveCount = typeof state.moveCount === "number" ? state.moveCount : 0;
    const stonesThisTurn = typeof state.stonesThisTurn === "number" ? state.stonesThisTurn : 0;
    const firstTurn = moveCount === 0;
    const nextStones = stonesThisTurn + 1;
    const completesTurn = firstTurn || nextStones >= 2;
    return jsonPosition("connect6", setBoardCell(state.board, move.to, markFor(seat), 19), completesTurn ? otherSeat(seat) : seat, {
      moveCount: moveCount + 1,
      stonesThisTurn: completesTurn ? 0 : nextStones,
    });
  },
};

function reversiInitial(): string {
  const board = Array.from({ length: 64 }, () => "0");
  board[3 * 8 + 3] = "2";
  board[3 * 8 + 4] = "1";
  board[4 * 8 + 3] = "1";
  board[4 * 8 + 4] = "2";
  return board.join("");
}

function reversiFlips(board: string, point: OnlinePoint, seat: GameSeat): OnlinePoint[] {
  if (!inBounds(point, 8, 8) || board[indexOf(point, 8)] !== "0") return [];
  const own = markFor(seat);
  const opponent = markFor(otherSeat(seat));
  const result: OnlinePoint[] = [];
  for (const [dx, dy] of DIRECTIONS_8) {
    const line: OnlinePoint[] = [];
    let x = point.x + dx;
    let y = point.y + dy;
    while (inBounds({ x, y }, 8, 8) && board[indexOf({ x, y }, 8)] === opponent) {
      line.push({ x, y });
      x += dx;
      y += dy;
    }
    if (line.length > 0 && inBounds({ x, y }, 8, 8) && board[indexOf({ x, y }, 8)] === own) result.push(...line);
  }
  return result;
}

const reversiEngine: OnlineGameEngine = {
  id: "reversi",
  board: { kind: "grid", columns: 8, rows: 8, aspectRatio: 1 },
  initialPosition: () => jsonPosition("reversi", reversiInitial(), RED),
  parse: (position) => parseJsonPosition("reversi", position),
  legalMoves: (position, seat) => {
    const state = reversiEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return [];
    return gridCoordinates(8, 8)
      .map((point) => ({ point, flips: reversiFlips(state.board as string, point, seat) }))
      .filter(({ flips }) => flips.length > 0)
      .map(({ point, flips }) => candidate(point, point, flips[0], `翻转 ${flips.length} 子`));
  },
  apply: (position, seat, move) => {
    const state = reversiEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return null;
    const flips = reversiFlips(state.board, move.to, seat);
    if (!flips.length) return null;
    let board = setBoardCell(state.board, move.to, markFor(seat), 8);
    for (const point of flips) board = setBoardCell(board, point, markFor(seat), 8);
    const nextSeat = otherSeat(seat);
    const nextMoves = gridCoordinates(8, 8).some((point) => reversiFlips(board, point, nextSeat).length > 0);
    const ownMoves = gridCoordinates(8, 8).some((point) => reversiFlips(board, point, seat).length > 0);
    return jsonPosition("reversi", board, nextMoves ? nextSeat : ownMoves ? seat : nextSeat, {
      lastFlips: flips.length,
      result: !nextMoves && !ownMoves ? countBoard(board, markFor(seat)) === countBoard(board, markFor(nextSeat)) ? "draw" : countBoard(board, markFor(seat)) > countBoard(board, markFor(nextSeat)) ? seat : nextSeat : null,
    });
  },
};

function countBoard(board: string, value: string): number {
  return Array.from(board).filter((cell) => cell === value).length;
}

function pathIsClear(board: string, from: OnlinePoint, to: OnlinePoint, columns: number): boolean {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let x = from.x + dx;
  let y = from.y + dy;
  while (x !== to.x || y !== to.y) {
    if (board[indexOf({ x, y }, columns)] !== "0") return false;
    x += dx;
    y += dy;
  }
  return true;
}

function chessOwner(piece: string): GameSeat | null {
  if (!piece || piece === "0") return null;
  return piece === piece.toUpperCase() ? RED : BLACK;
}

function chessTargets(board: string, from: OnlinePoint, seat: GameSeat): OnlineMoveCandidate[] {
  if (!inBounds(from, 8, 8)) return [];
  const piece = board[indexOf(from, 8)];
  if (chessOwner(piece) !== seat) return [];
  const kind = piece.toLowerCase();
  const targets: OnlineMoveCandidate[] = [];
  const add = (to: OnlinePoint, requireClear = false) => {
    if (!inBounds(to, 8, 8)) return;
    const targetPiece = board[indexOf(to, 8)];
    if (chessOwner(targetPiece) === seat) return;
    if (requireClear && !pathIsClear(board, from, to, 8)) return;
    targets.push(candidate(from, to, targetPiece === "0" ? null : to));
  };
  if (kind === "p") {
    const dy = seat === RED ? -1 : 1;
    const one = { x: from.x, y: from.y + dy };
    if (inBounds(one, 8, 8) && board[indexOf(one, 8)] === "0") add(one);
    const start = seat === RED ? 6 : 1;
    const two = { x: from.x, y: from.y + dy * 2 };
    if (from.y === start && board[indexOf(one, 8)] === "0" && inBounds(two, 8, 8) && board[indexOf(two, 8)] === "0") add(two);
    for (const dx of [-1, 1]) {
      const capture = { x: from.x + dx, y: from.y + dy };
      if (inBounds(capture, 8, 8) && chessOwner(board[indexOf(capture, 8)]) === otherSeat(seat)) add(capture);
    }
  } else if (kind === "n") {
    for (const [dx, dy] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) add({ x: from.x + dx, y: from.y + dy });
  } else if (kind === "k") {
    for (const [dx, dy] of DIRECTIONS_8) {
      if (Math.abs(dx) + Math.abs(dy) === 1) add({ x: from.x + dx, y: from.y + dy });
    }
  } else {
    const directions = kind === "b" ? [[1, 1], [1, -1], [-1, 1], [-1, -1]]
      : kind === "r" ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
        : DIRECTIONS_8;
    for (const [dx, dy] of directions) {
      for (let distance = 1; distance < 8; distance += 1) {
        const to = { x: from.x + dx * distance, y: from.y + dy * distance };
        if (!inBounds(to, 8, 8)) break;
        const targetPiece = board[indexOf(to, 8)];
        if (chessOwner(targetPiece) === seat) break;
        add(to, true);
        if (targetPiece !== "0") break;
      }
    }
  }
  return targets;
}

const chessEngine: OnlineGameEngine = {
  id: "chess",
  board: { kind: "grid", columns: 8, rows: 8, aspectRatio: 1 },
  initialPosition: () => jsonPosition("chess", "rnbqkbnrpppppppp00000000000000000000000000000000PPPPPPPPRNBQKBNR", RED),
  parse: (position) => parseJsonPosition("chess", position),
  legalMoves: (position, seat, from) => {
    const state = chessEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return [];
    if (from) return chessTargets(state.board, from, seat);
    return gridCoordinates(8, 8).flatMap((point) => chessTargets(state.board as string, point, seat));
  },
  apply: (position, seat, move) => {
    const state = chessEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return null;
    const legal = chessTargets(state.board, move.from, seat).find((item) => samePoint(item.to, move.to));
    if (!legal) return null;
    let piece = state.board[indexOf(move.from, 8)];
    if (piece === "P" && move.to.y === 0) piece = "Q";
    if (piece === "p" && move.to.y === 7) piece = "q";
    let board = setBoardCell(state.board, move.from, "0", 8);
    board = setBoardCell(board, move.to, piece, 8);
    return jsonPosition("chess", board, otherSeat(seat), { lastCapture: legal.captured });
  },
  cellLabel: (position, point) => {
    const state = chessEngine.parse(position);
    return state && typeof state.board === "string" ? state.board[indexOf(point, 8)] : "";
  },
};

function checkersInitial(): string {
  const board = Array.from({ length: 64 }, () => "0");
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 8; x += 1) if ((x + y) % 2 === 1) board[indexOf({ x, y }, 8)] = "b";
  }
  for (let y = 5; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) if ((x + y) % 2 === 1) board[indexOf({ x, y }, 8)] = "r";
  }
  return board.join("");
}

function checkersOwner(piece: string): GameSeat | null {
  if (piece === "r" || piece === "R") return RED;
  if (piece === "b" || piece === "B") return BLACK;
  return null;
}

function checkersTargets(board: string, from: OnlinePoint, seat: GameSeat): OnlineMoveCandidate[] {
  const piece = inBounds(from, 8, 8) ? board[indexOf(from, 8)] : "0";
  if (checkersOwner(piece) !== seat) return [];
  const king = piece === "R" || piece === "B";
  const directions = king || seat === RED ? [[1, -1], [-1, -1]] : [];
  if (king || seat === BLACK) directions.push([1, 1], [-1, 1]);
  const result: OnlineMoveCandidate[] = [];
  for (const [dx, dy] of directions) {
    const one = { x: from.x + dx, y: from.y + dy };
    if (!inBounds(one, 8, 8)) continue;
    const onePiece = board[indexOf(one, 8)];
    if (onePiece === "0") result.push(candidate(from, one));
    else if (checkersOwner(onePiece) === otherSeat(seat)) {
      const two = { x: from.x + dx * 2, y: from.y + dy * 2 };
      if (inBounds(two, 8, 8) && board[indexOf(two, 8)] === "0") result.push(candidate(from, two, one));
    }
  }
  return result;
}

const checkersEngine: OnlineGameEngine = {
  id: "checkers",
  board: { kind: "grid", columns: 8, rows: 8, aspectRatio: 1 },
  initialPosition: () => jsonPosition("checkers", checkersInitial(), RED),
  parse: (position) => parseJsonPosition("checkers", position),
  legalMoves: (position, seat, from) => {
    const state = checkersEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return [];
    return from ? checkersTargets(state.board, from, seat) : gridCoordinates(8, 8).flatMap((point) => checkersTargets(state.board as string, point, seat));
  },
  apply: (position, seat, move) => {
    const state = checkersEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return null;
    const legal = checkersTargets(state.board, move.from, seat).find((item) => samePoint(item.to, move.to));
    if (!legal) return null;
    let board = setBoardCell(state.board, move.from, "0", 8);
    if (legal.captured) board = setBoardCell(board, legal.captured, "0", 8);
    let piece = state.board[indexOf(move.from, 8)];
    if (seat === RED && move.to.y === 0) piece = "R";
    if (seat === BLACK && move.to.y === 7) piece = "B";
    board = setBoardCell(board, move.to, piece, 8);
    return jsonPosition("checkers", board, otherSeat(seat), { lastCapture: legal.captured });
  },
};

function xiangqiInitial(): string {
  return "rnbakabnr000c000c0p0p0p0p0p000000000000000000000000000000000000P0P0P0P0P0C00000C0RNBAKABNR";
}

function xiangqiOwner(piece: string): GameSeat | null {
  if (!piece || piece === "0") return null;
  return piece === piece.toUpperCase() ? RED : BLACK;
}

function xiangqiTargets(board: string, from: OnlinePoint, seat: GameSeat): OnlineMoveCandidate[] {
  if (!inBounds(from, 9, 10)) return [];
  const piece = board[indexOf(from, 9)];
  if (xiangqiOwner(piece) !== seat) return [];
  const kind = piece.toLowerCase();
  const result: OnlineMoveCandidate[] = [];
  const add = (to: OnlinePoint, clear = false, cannon = false) => {
    if (!inBounds(to, 9, 10)) return;
    const target = board[indexOf(to, 9)];
    if (xiangqiOwner(target) === seat) return;
    if (clear && !pathIsClear(board, from, to, 9)) return;
    if (cannon) {
      let screens = 0;
      const dx = Math.sign(to.x - from.x);
      const dy = Math.sign(to.y - from.y);
      let x = from.x + dx;
      let y = from.y + dy;
      while (x !== to.x || y !== to.y) {
        if (board[indexOf({ x, y }, 9)] !== "0") screens += 1;
        x += dx;
        y += dy;
      }
      if ((target === "0" && screens !== 0) || (target !== "0" && screens !== 1)) return;
    }
    result.push(candidate(from, to, target === "0" ? null : to));
  };
  const palace = (to: OnlinePoint) => to.x >= 3 && to.x <= 5 && (seat === RED ? to.y >= 7 : to.y <= 2);
  if (kind === "k" || kind === "a") {
    const deltas = kind === "k" ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dx, dy] of deltas) {
      const to = { x: from.x + dx, y: from.y + dy };
      if (palace(to)) add(to);
    }
  } else if (kind === "b") {
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const to = { x: from.x + dx * 2, y: from.y + dy * 2 };
      const eye = { x: from.x + dx, y: from.y + dy };
      if (inBounds(to, 9, 10) && (seat === RED ? to.y >= 5 : to.y <= 4) && board[indexOf(eye, 9)] === "0") add(to);
    }
  } else if (kind === "n") {
    for (const [dx, dy, lx, ly] of [[1, 2, 0, 1], [2, 1, 1, 0], [-1, 2, 0, 1], [-2, 1, -1, 0], [1, -2, 0, -1], [2, -1, 1, 0], [-1, -2, 0, -1], [-2, -1, -1, 0]]) {
      const leg = { x: from.x + lx, y: from.y + ly };
      const to = { x: from.x + dx, y: from.y + dy };
      if (inBounds(to, 9, 10) && inBounds(leg, 9, 10) && board[indexOf(leg, 9)] === "0") add(to);
    }
  } else if (kind === "r" || kind === "c") {
    for (const [dx, dy] of DIRECTIONS_4) {
      for (let distance = 1; distance < 10; distance += 1) {
        const to = { x: from.x + dx * distance, y: from.y + dy * distance };
        if (!inBounds(to, 9, 10)) break;
        const target = board[indexOf(to, 9)];
        if (kind === "r") {
          if (target === "0") result.push(candidate(from, to));
          else { if (xiangqiOwner(target) === otherSeat(seat)) result.push(candidate(from, to, to)); break; }
        } else add(to, false, true);
      }
    }
  } else {
    const dy = seat === RED ? -1 : 1;
    const forward = { x: from.x, y: from.y + dy };
    if (inBounds(forward, 9, 10)) add(forward);
    const crossedRiver = seat === RED ? from.y <= 4 : from.y >= 5;
    if (crossedRiver) {
      for (const dx of [-1, 1]) {
        const side = { x: from.x + dx, y: from.y };
        if (inBounds(side, 9, 10)) add(side);
      }
    }
  }
  return result;
}

const xiangqiEngine: OnlineGameEngine = {
  id: "xiangqi",
  board: { kind: "grid", columns: 9, rows: 10, aspectRatio: 0.9 },
  initialPosition: () => jsonPosition("xiangqi", xiangqiInitial(), RED),
  parse: (position) => parseJsonPosition("xiangqi", position) ?? (position === "initial" ? { game: "xiangqi", board: xiangqiInitial(), turn: RED } : null),
  legalMoves: (position, seat, from) => {
    const state = xiangqiEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return [];
    return from ? xiangqiTargets(state.board, from, seat) : gridCoordinates(9, 10).flatMap((point) => xiangqiTargets(state.board as string, point, seat));
  },
  apply: (position, seat, move) => {
    const state = xiangqiEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return null;
    const legal = xiangqiTargets(state.board, move.from, seat).find((item) => samePoint(item.to, move.to));
    if (!legal) return null;
    let board = setBoardCell(state.board, move.from, "0", 9);
    board = setBoardCell(board, move.to, state.board[indexOf(move.from, 9)], 9);
    return jsonPosition("xiangqi", board, otherSeat(seat), { lastCapture: legal.captured });
  },
};

function groupAndLiberty(board: string, start: OnlinePoint, player: string, columns: number, rows: number): { group: OnlinePoint[]; liberty: boolean } {
  const group: OnlinePoint[] = [];
  const seen = new Set<string>();
  const queue = [start];
  let liberty = false;
  while (queue.length) {
    const point = queue.pop()!;
    const key = pointKey(point);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!inBounds(point, columns, rows)) continue;
    const value = board[indexOf(point, columns)];
    if (value === "0") { liberty = true; continue; }
    if (value !== player) continue;
    group.push(point);
    for (const [dx, dy] of DIRECTIONS_4) queue.push({ x: point.x + dx, y: point.y + dy });
  }
  return { group, liberty };
}

function goApply(board: string, point: OnlinePoint, seat: GameSeat): string | null {
  if (!inBounds(point, 9, 9) || board[indexOf(point, 9)] !== "0") return null;
  let next = setBoardCell(board, point, markFor(seat), 9);
  const opponent = markFor(otherSeat(seat));
  for (const [dx, dy] of DIRECTIONS_4) {
    const adjacent = { x: point.x + dx, y: point.y + dy };
    if (!inBounds(adjacent, 9, 9) || next[indexOf(adjacent, 9)] !== opponent) continue;
    const group = groupAndLiberty(next, adjacent, opponent, 9, 9);
    if (!group.liberty) for (const stone of group.group) next = setBoardCell(next, stone, "0", 9);
  }
  const ownGroup = groupAndLiberty(next, point, markFor(seat), 9, 9);
  return ownGroup.liberty ? next : null;
}

const goEngine: OnlineGameEngine = {
  id: "go",
  board: { kind: "grid", columns: 9, rows: 9, aspectRatio: 1 },
  initialPosition: () => jsonPosition("go", emptyBoard(9, 9), RED, { boardSize: 9 }),
  parse: (position) => parseJsonPosition("go", position),
  legalMoves: (position, seat) => {
    const state = goEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return [];
    return gridCoordinates(9, 9).filter((point) => goApply(state.board as string, point, seat) !== null).map((point) => candidate(point));
  },
  apply: (position, seat, move) => {
    const state = goEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return null;
    const next = goApply(state.board, move.to, seat);
    return next ? jsonPosition("go", next, otherSeat(seat), { boardSize: 9 }) : null;
  },
};

function shogiInitial(): string {
  return [
    "lnsgkgsnl",
    "0r00000b0",
    "ppppppppp",
    "000000000",
    "000000000",
    "000000000",
    "PPPPPPPPP",
    "0B00000R0",
    "LNSGKGSNL",
  ].join("");
}

function shogiOwner(piece: string): GameSeat | null {
  if (!piece || piece === "0") return null;
  return piece === piece.toUpperCase() ? RED : BLACK;
}

function shogiTargets(board: string, from: OnlinePoint, seat: GameSeat): OnlineMoveCandidate[] {
  if (!inBounds(from, 9, 9)) return [];
  const piece = board[indexOf(from, 9)];
  if (shogiOwner(piece) !== seat) return [];
  const kind = piece.toLowerCase();
  const result: OnlineMoveCandidate[] = [];
  const forward = seat === RED ? -1 : 1;
  const add = (to: OnlinePoint) => {
    if (!inBounds(to, 9, 9)) return;
    const target = board[indexOf(to, 9)];
    if (shogiOwner(target) === seat) return;
    result.push(candidate(from, to, target === "0" ? null : to));
  };
  const step = (dx: number, dy: number) => add({ x: from.x + dx, y: from.y + dy });
  if (kind === "p") step(0, forward);
  else if (kind === "n") { step(-1, forward * 2); step(1, forward * 2); }
  else if (kind === "s") { step(0, forward); step(-1, forward); step(1, forward); step(-1, -forward); step(1, -forward); }
  else if (kind === "g") {
    step(0, forward); step(-1, forward); step(1, forward); step(-1, 0); step(1, 0); step(0, -forward);
  } else if (kind === "k") {
    for (const [dx, dy] of DIRECTIONS_8) step(dx, dy);
  } else {
    const directions = kind === "r" ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [dx, dy] of directions) {
      for (let distance = 1; distance < 9; distance += 1) {
        const to = { x: from.x + dx * distance, y: from.y + dy * distance };
        if (!inBounds(to, 9, 9)) break;
        const target = board[indexOf(to, 9)];
        if (shogiOwner(target) === seat) break;
        result.push(candidate(from, to, target === "0" ? null : to));
        if (target !== "0") break;
      }
    }
  }
  return result;
}

const shogiEngine: OnlineGameEngine = {
  id: "shogi",
  board: { kind: "grid", columns: 9, rows: 9, aspectRatio: 1 },
  initialPosition: () => jsonPosition("shogi", shogiInitial(), RED),
  parse: (position) => parseJsonPosition("shogi", position),
  legalMoves: (position, seat, from) => {
    const state = shogiEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return [];
    return from ? shogiTargets(state.board, from, seat) : gridCoordinates(9, 9).flatMap((point) => shogiTargets(state.board as string, point, seat));
  },
  apply: (position, seat, move) => {
    const state = shogiEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return null;
    const legal = shogiTargets(state.board, move.from, seat).find((item) => samePoint(item.to, move.to));
    if (!legal) return null;
    let board = setBoardCell(state.board, move.from, "0", 9);
    board = setBoardCell(board, move.to, state.board[indexOf(move.from, 9)], 9);
    return jsonPosition("shogi", board, otherSeat(seat), { lastCapture: legal.captured });
  },
};

interface DotsBoard {
  h: string;
  v: string;
  boxes: string;
  scores: [number, number];
}

function dotsInitial(): DotsBoard {
  return { h: "0".repeat(12), v: "0".repeat(12), boxes: "0".repeat(9), scores: [0, 0] };
}

function readDots(state: OnlinePositionState): DotsBoard | null {
  if (!state.board || typeof state.board !== "object") return null;
  const value = state.board as Partial<DotsBoard>;
  if (typeof value.h !== "string" || value.h.length !== 12 || typeof value.v !== "string" || value.v.length !== 12 || typeof value.boxes !== "string" || value.boxes.length !== 9 || !Array.isArray(value.scores) || value.scores.length !== 2) return null;
  if (!value.scores.every((score) => typeof score === "number")) return null;
  return { h: value.h, v: value.v, boxes: value.boxes, scores: [value.scores[0] as number, value.scores[1] as number] };
}

function dotsEdge(from: OnlinePoint, to: OnlinePoint): { axis: "h" | "v"; index: number } | null {
  if (!inBounds(from, 4, 4) || !inBounds(to, 4, 4)) return null;
  if (from.y === to.y && Math.abs(from.x - to.x) === 1) return { axis: "h", index: from.y * 3 + Math.min(from.x, to.x) };
  if (from.x === to.x && Math.abs(from.y - to.y) === 1) return { axis: "v", index: Math.min(from.y, to.y) * 4 + from.x };
  return null;
}

function dotsBoxesForEdge(edge: { axis: "h" | "v"; index: number }): number[] {
  if (edge.axis === "h") {
    const y = Math.floor(edge.index / 3);
    const x = edge.index % 3;
    return [y > 0 ? (y - 1) * 3 + x : -1, y < 3 ? y * 3 + x : -1].filter((index) => index >= 0);
  }
  const y = Math.floor(edge.index / 4);
  const x = edge.index % 4;
  return [x > 0 ? y * 3 + x - 1 : -1, x < 3 ? y * 3 + x : -1].filter((index) => index >= 0);
}

function dotsBoxComplete(board: DotsBoard, box: number): boolean {
  const row = Math.floor(box / 3);
  const col = box % 3;
  return board.h[row * 3 + col] !== "0"
    && board.h[(row + 1) * 3 + col] !== "0"
    && board.v[row * 4 + col] !== "0"
    && board.v[row * 4 + col + 1] !== "0";
}

const dotsAndBoxesEngine: OnlineGameEngine = {
  id: "dots-and-boxes",
  board: { kind: "dots", columns: 4, rows: 4, aspectRatio: 1 },
  initialPosition: () => jsonPosition("dots-and-boxes", dotsInitial(), RED),
  parse: (position) => parseJsonPosition("dots-and-boxes", position),
  legalMoves: (position, seat) => {
    const state = dotsAndBoxesEngine.parse(position);
    const board = state && readDots(state);
    if (!state || !board || state.turn !== seat) return [];
    const moves: OnlineMoveCandidate[] = [];
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 3; x += 1) if (board.h[y * 3 + x] === "0") moves.push(candidate({ x, y }, { x: x + 1, y }));
    for (let y = 0; y < 3; y += 1) for (let x = 0; x < 4; x += 1) if (board.v[y * 4 + x] === "0") moves.push(candidate({ x, y }, { x, y: y + 1 }));
    return moves;
  },
  apply: (position, seat, move) => {
    const state = dotsAndBoxesEngine.parse(position);
    const current = state && readDots(state);
    const edge = dotsEdge(move.from, move.to);
    if (!state || !current || state.turn !== seat || !edge) return null;
    if ((edge.axis === "h" ? current.h : current.v)[edge.index] !== "0") return null;
    const value = markFor(seat);
    const next: DotsBoard = { ...current, h: current.h, v: current.v, boxes: current.boxes, scores: [...current.scores] as [number, number] };
    if (edge.axis === "h") next.h = `${current.h.slice(0, edge.index)}${value}${current.h.slice(edge.index + 1)}`;
    else next.v = `${current.v.slice(0, edge.index)}${value}${current.v.slice(edge.index + 1)}`;
    let completed = 0;
    for (const box of dotsBoxesForEdge(edge)) {
      if (next.boxes[box] === "0" && dotsBoxComplete(next, box)) {
        next.boxes = `${next.boxes.slice(0, box)}${value}${next.boxes.slice(box + 1)}`;
        next.scores[seat === RED ? 0 : 1] += 1;
        completed += 1;
      }
    }
    return jsonPosition("dots-and-boxes", next, completed > 0 ? seat : otherSeat(seat));
  },
};

interface MancalaBoard {
  pits: number[];
  stores: [number, number];
}

function mancalaInitial(): MancalaBoard {
  return { pits: [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0], stores: [0, 0] };
}

function readMancala(state: OnlinePositionState): MancalaBoard | null {
  if (!state.board || typeof state.board !== "object") return null;
  const value = state.board as Partial<MancalaBoard>;
  if (!Array.isArray(value.pits) || value.pits.length !== 14 || !value.pits.every((pit) => Number.isInteger(pit) && (pit as number) >= 0) || !Array.isArray(value.stores) || value.stores.length !== 2 || !value.stores.every((store) => Number.isInteger(store) && (store as number) >= 0)) return null;
  return { pits: value.pits.slice() as number[], stores: [value.stores[0] as number, value.stores[1] as number] };
}

function mancalaPoint(index: number): OnlinePoint {
  if (index >= 0 && index <= 5) return { x: index, y: 1 };
  if (index >= 7 && index <= 12) return { x: 12 - index, y: 0 };
  return { x: 6, y: index === 6 ? 1 : 0 };
}

function mancalaIndex(point: OnlinePoint): number | null {
  if (point.y === 1 && point.x >= 0 && point.x <= 5) return point.x;
  if (point.y === 0 && point.x >= 0 && point.x <= 5) return 12 - point.x;
  if (point.x === 6 && point.y === 1) return 6;
  if (point.x === 6 && point.y === 0) return 13;
  return null;
}

const mancalaEngine: OnlineGameEngine = {
  id: "mancala",
  board: { kind: "mancala", columns: 7, rows: 2, aspectRatio: 2.1 },
  initialPosition: () => jsonPosition("mancala", mancalaInitial(), RED),
  parse: (position) => parseJsonPosition("mancala", position),
  legalMoves: (position, seat) => {
    const state = mancalaEngine.parse(position);
    const board = state && readMancala(state);
    if (!state || !board || state.turn !== seat) return [];
    const range = seat === RED ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12];
    return range.filter((index) => board.pits[index] > 0).map((index) => {
      let cursor = index;
      let remaining = board.pits[index];
      while (remaining > 0) { cursor = (cursor + 1) % 14; if (cursor === (seat === RED ? 13 : 6)) cursor = (cursor + 1) % 14; remaining -= 1; }
      return candidate(mancalaPoint(index), mancalaPoint(cursor));
    });
  },
  apply: (position, seat, move) => {
    const state = mancalaEngine.parse(position);
    const current = state && readMancala(state);
    const start = current && mancalaIndex(move.from);
    if (!state || !current || state.turn !== seat || start === null || start === undefined || (seat === RED ? start > 5 : start < 7 || start > 12) || current.pits[start] <= 0) return null;
    const pits = current.pits.slice();
    let stones = pits[start];
    pits[start] = 0;
    let cursor = start;
    while (stones > 0) {
      cursor = (cursor + 1) % 14;
      if (cursor === (seat === RED ? 13 : 6)) continue;
      pits[cursor] += 1;
      stones -= 1;
    }
    const ownRange = seat === RED ? cursor >= 0 && cursor <= 5 : cursor >= 7 && cursor <= 12;
    let captured = 0;
    if (ownRange && pits[cursor] === 1) {
      const opposite = 12 - cursor;
      if (pits[opposite] > 0) {
        captured = pits[opposite] + pits[cursor];
        pits[opposite] = 0;
        pits[cursor] = 0;
        current.stores[seat === RED ? 0 : 1] += captured;
      }
    }
    const extraTurn = (seat === RED && cursor === 6) || (seat === BLACK && cursor === 13);
    return jsonPosition("mancala", { pits, stores: current.stores }, extraTurn ? seat : otherSeat(seat), { captured });
  },
};

interface LudoBoard {
  tokens: [number[], number[]];
  roll: number;
}

const LUDO_COLUMNS = 13;
const LUDO_ROWS = 8;
const LUDO_HOME_ROWS = 2;
const LUDO_TRACK_LAST_STEP = 57;

function ludoInitial(): LudoBoard {
  return { tokens: [[-1, -1, -1, -1], [-1, -1, -1, -1]], roll: 1 };
}

function readLudo(state: OnlinePositionState): LudoBoard | null {
  if (!state.board || typeof state.board !== "object") return null;
  const value = state.board as Partial<LudoBoard>;
  if (!Array.isArray(value.tokens) || value.tokens.length !== 2 || !value.tokens.every((tokens) => Array.isArray(tokens) && tokens.length === 4 && tokens.every((token) => Number.isInteger(token) && token >= -1 && token <= LUDO_TRACK_LAST_STEP))) return null;
  const roll = typeof value.roll === "number" && Number.isInteger(value.roll) && value.roll >= 1 && value.roll <= 6 ? value.roll : null;
  if (roll === null) return null;
  return { tokens: [value.tokens[0].slice() as number[], value.tokens[1].slice() as number[]], roll };
}

function ludoHomePoint(seat: GameSeat, token: number): OnlinePoint {
  return { x: token, y: seat === RED ? 0 : 1 };
}

function ludoTokenFromPoint(point: OnlinePoint): { seat: GameSeat; token: number } | null {
  if (!inBounds(point, 4, LUDO_HOME_ROWS)) return null;
  return { seat: point.y === 0 ? RED : BLACK, token: point.x };
}

function ludoTrackPoint(step: number): OnlinePoint {
  return { x: step % LUDO_COLUMNS, y: LUDO_HOME_ROWS + Math.floor(step / LUDO_COLUMNS) };
}

const ludoEngine: OnlineGameEngine = {
  id: "ludo",
  board: { kind: "track", columns: LUDO_COLUMNS, rows: LUDO_ROWS, aspectRatio: 1.6 },
  initialPosition: () => jsonPosition("ludo", ludoInitial(), RED),
  parse: (position) => parseJsonPosition("ludo", position),
  legalMoves: (position, seat, from) => {
    const state = ludoEngine.parse(position);
    const board = state && readLudo(state);
    if (!state || !board || state.turn !== seat) return [];
    const requestedToken = from ? ludoTokenFromPoint(from) : null;
    if (from && (!requestedToken || requestedToken.seat !== seat)) return [];
    const side = seat === RED ? 0 : 1;
    return board.tokens[side]
      .map((token, index) => ({ token, index }))
      .filter(({ index }) => !requestedToken || requestedToken.token === index)
      .filter(({ token }) => token < 57)
      .map(({ token, index }) => {
        const next = token < 0 ? 0 : Math.min(57, token + Math.max(1, board.roll));
        return candidate(ludoHomePoint(seat, index), ludoTrackPoint(next), null, `棋子 ${index + 1}`);
      });
  },
  apply: (position, seat, move) => {
    const state = ludoEngine.parse(position);
    const current = state && readLudo(state);
    const tokenInfo = ludoTokenFromPoint(move.from);
    if (!state || !current || state.turn !== seat || !tokenInfo || tokenInfo.seat !== seat) return null;
    const side = seat === RED ? 0 : 1;
    const old = current.tokens[side][tokenInfo.token];
    if (old >= LUDO_TRACK_LAST_STEP) return null;
    const next = old < 0 ? 0 : Math.min(57, old + Math.max(1, current.roll));
    if (!samePoint(move.to, ludoTrackPoint(next))) return null;
    const tokens: [number[], number[]] = [current.tokens[0].slice(), current.tokens[1].slice()];
    tokens[side][tokenInfo.token] = next;
    return jsonPosition("ludo", { tokens, roll: 1 }, otherSeat(seat), { movedToken: tokenInfo.token });
  },
};

function adjacentInitial(columns: number, rows: number, placements: Array<[number, string]>): string {
  const board = Array.from({ length: columns * rows }, () => "0");
  for (const [index, value] of placements) board[index] = value;
  return board.join("");
}

function adjacentTargets(
  board: string,
  from: OnlinePoint,
  seat: GameSeat,
  columns: number,
  rows: number,
  owner: (piece: string) => GameSeat | null,
): OnlineMoveCandidate[] {
  if (!inBounds(from, columns, rows) || owner(board[indexOf(from, columns)]) !== seat) return [];
  return DIRECTIONS_4
    .map(([dx, dy]) => ({ x: from.x + dx, y: from.y + dy }))
    .filter((to) => inBounds(to, columns, rows) && owner(board[indexOf(to, columns)]) !== seat)
    .map((to) => candidate(from, to, board[indexOf(to, columns)] === "0" ? null : to));
}

function animalOwner(piece: string): GameSeat | null {
  if (!piece || piece === "0") return null;
  return piece === piece.toUpperCase() ? RED : BLACK;
}

const animalChessEngine: OnlineGameEngine = {
  id: "animal-chess",
  board: { kind: "grid", columns: 8, rows: 4, aspectRatio: 2 },
  initialPosition: () => jsonPosition("animal-chess", adjacentInitial(8, 4, [
    [0, "e"], [1, "l"], [2, "t"], [5, "t"], [6, "l"], [7, "e"], [8, "r"], [15, "c"], [16, "R"], [23, "C"], [24, "E"], [25, "L"], [26, "T"], [29, "T"], [30, "L"], [31, "E"],
  ]), RED),
  parse: (position) => parseJsonPosition("animal-chess", position),
  legalMoves: (position, seat, from) => {
    const state = animalChessEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return [];
    return from ? adjacentTargets(state.board, from, seat, 8, 4, animalOwner) : gridCoordinates(8, 4).flatMap((point) => adjacentTargets(state.board as string, point, seat, 8, 4, animalOwner));
  },
  apply: (position, seat, move) => {
    const state = animalChessEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return null;
    const legal = adjacentTargets(state.board, move.from, seat, 8, 4, animalOwner).find((item) => samePoint(item.to, move.to));
    if (!legal) return null;
    let board = setBoardCell(state.board, move.from, "0", 8);
    board = setBoardCell(board, move.to, state.board[indexOf(move.from, 8)], 8);
    return jsonPosition("animal-chess", board, otherSeat(seat), { lastCapture: legal.captured });
  },
};

function armyOwner(piece: string): GameSeat | null {
  if (!piece || piece === "0") return null;
  return piece === piece.toUpperCase() ? RED : BLACK;
}

const ARMY_CAMP_INDICES = new Set([11, 13, 17, 21, 23, 36, 38, 42, 46, 48]);
const ARMY_PIECES = [
  "f", "l", "l", "l", "b", "b", "a", "j", "s", "s", "t", "t", "r", "r", "y", "y", "c", "c", "p", "p", "g", "g", "g", "m", "m",
] as const;

function armyInitialBoard(): string {
  const board = Array.from({ length: 5 * 12 }, () => "0");
  const playable = board.map((_, index) => index).filter((index) => !ARMY_CAMP_INDICES.has(index));
  playable.slice(0, ARMY_PIECES.length).forEach((index, pieceIndex) => { board[index] = ARMY_PIECES[pieceIndex]; });
  playable.slice(ARMY_PIECES.length).forEach((index, pieceIndex) => { board[index] = ARMY_PIECES[pieceIndex].toUpperCase(); });
  return board.join("");
}

function armyRevealedIndices(state: OnlinePositionState): Set<number> {
  if (!Array.isArray(state.revealed)) return new Set();
  return new Set(state.revealed.filter((value): value is number => (
    Number.isInteger(value) && value >= 0 && value < 5 * 12
  )));
}

function armyMoveTargets(
  board: string,
  revealed: Set<number>,
  from: OnlinePoint,
  seat: GameSeat,
): OnlineMoveCandidate[] {
  const sourceIndex = indexOf(from, 5);
  if (!revealed.has(sourceIndex) || armyOwner(board[sourceIndex]) !== seat) return [];
  return adjacentTargets(board, from, seat, 5, 12, armyOwner)
    .filter((move) => {
      const targetIndex = indexOf(move.to, 5);
      return board[targetIndex] === "0" || revealed.has(targetIndex);
    });
}

const armyChessEngine: OnlineGameEngine = {
  id: "army-chess",
  board: { kind: "grid", columns: 5, rows: 12, aspectRatio: 0.42 },
  initialPosition: () => jsonPosition("army-chess", armyInitialBoard(), RED, { revealed: [] }),
  parse: (position) => parseJsonPosition("army-chess", position),
  legalMoves: (position, seat, from) => {
    const state = armyChessEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return [];
    const board = state.board;
    const revealed = armyRevealedIndices(state);
    const movesForPoint = (point: OnlinePoint): OnlineMoveCandidate[] => {
      const piece = board[indexOf(point, 5)];
      if (piece !== "0" && !revealed.has(indexOf(point, 5))) {
        return [candidate(point, point, null, "翻开棋子")];
      }
      return armyMoveTargets(board, revealed, point, seat);
    };
    return from ? movesForPoint(from) : gridCoordinates(5, 12).flatMap(movesForPoint);
  },
  apply: (position, seat, move) => {
    const state = armyChessEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return null;
    const revealed = armyRevealedIndices(state);
    const sourceIndex = indexOf(move.from, 5);
    if (samePoint(move.from, move.to) && state.board[sourceIndex] !== "0" && !revealed.has(sourceIndex)) {
      revealed.add(sourceIndex);
      return jsonPosition("army-chess", state.board, otherSeat(seat), {
        revealed: [...revealed].sort((left, right) => left - right),
        lastAction: "reveal",
      });
    }
    const legal = armyMoveTargets(state.board, revealed, move.from, seat).find((item) => samePoint(item.to, move.to));
    if (!legal) return null;
    let board = setBoardCell(state.board, move.from, "0", 5);
    board = setBoardCell(board, move.to, state.board[indexOf(move.from, 5)], 5);
    revealed.delete(sourceIndex);
    revealed.delete(indexOf(move.to, 5));
    revealed.add(indexOf(move.to, 5));
    return jsonPosition("army-chess", board, otherSeat(seat), {
      revealed: [...revealed].sort((left, right) => left - right),
      lastAction: "move",
      lastCapture: legal.captured,
    });
  },
};

interface BackgammonBoard {
  points: number[];
  bar: [number, number];
  borneOff: [number, number];
  roll: number;
}

const BACKGAMMON_COLUMNS = 12;
const BACKGAMMON_POINT_ROWS = 2;
const BACKGAMMON_BEAR_OFF_ROW = 2;
const BACKGAMMON_ROWS = BACKGAMMON_BEAR_OFF_ROW + 1;

function backgammonInitial(): BackgammonBoard {
  return { points: [2, 0, 0, 0, 0, -5, 0, -3, 0, 0, 0, 5, -5, 0, 0, 0, 3, 0, 5, 0, 0, 0, 0, -2], bar: [0, 0], borneOff: [0, 0], roll: 1 };
}

function readBackgammon(state: OnlinePositionState): BackgammonBoard | null {
  if (!state.board || typeof state.board !== "object") return null;
  const value = state.board as Partial<BackgammonBoard>;
  if (!Array.isArray(value.points) || value.points.length !== 24 || !value.points.every((point) => Number.isInteger(point)) || !Array.isArray(value.bar) || value.bar.length !== 2 || !value.bar.every((point) => Number.isInteger(point) && point >= 0) || !Array.isArray(value.borneOff) || value.borneOff.length !== 2 || !value.borneOff.every((point) => Number.isInteger(point) && point >= 0)) return null;
  const roll = typeof value.roll === "number" && Number.isInteger(value.roll) && value.roll >= 1 && value.roll <= 6 ? value.roll : null;
  if (roll === null) return null;
  return { points: value.points.slice() as number[], bar: value.bar.slice() as [number, number], borneOff: value.borneOff.slice() as [number, number], roll };
}

function backgammonPoint(index: number): OnlinePoint {
  return { x: index < 12 ? index : index - 12, y: index < 12 ? 0 : 1 };
}

function backgammonSourceIndex(point: OnlinePoint): number | null {
  if (!inBounds(point, BACKGAMMON_COLUMNS, BACKGAMMON_POINT_ROWS)) return null;
  return point.y === 0 ? point.x : point.x + BACKGAMMON_COLUMNS;
}

function backgammonTarget(destination: number, sign: number): OnlinePoint {
  if (destination < 0 || destination >= 24) {
    return { x: sign > 0 ? BACKGAMMON_COLUMNS - 1 : 0, y: BACKGAMMON_BEAR_OFF_ROW };
  }
  return backgammonPoint(destination);
}

const backgammonEngine: OnlineGameEngine = {
  id: "backgammon",
  board: { kind: "backgammon", columns: BACKGAMMON_COLUMNS, rows: BACKGAMMON_ROWS, aspectRatio: 1.8 },
  initialPosition: () => jsonPosition("backgammon", backgammonInitial(), RED),
  parse: (position) => parseJsonPosition("backgammon", position),
  legalMoves: (position, seat, from) => {
    const state = backgammonEngine.parse(position);
    const board = state && readBackgammon(state);
    if (!state || !board || state.turn !== seat) return [];
    const sign = seat === RED ? 1 : -1;
    const requestedSource = from ? backgammonSourceIndex(from) : null;
    if (from && requestedSource === null) return [];
    const sources = from && requestedSource !== null ? [requestedSource] : Array.from({ length: 24 }, (_, index) => index);
    return sources.flatMap((source) => {
      if (source < 0 || source >= 24 || (sign > 0 ? board.points[source] <= 0 : board.points[source] >= 0)) return [];
      const destination = source + sign * Math.max(1, board.roll);
      if (destination < 0 || destination >= 24) return [candidate(backgammonPoint(source), backgammonTarget(destination, sign), null, "收棋")];
      const occupied = board.points[destination];
      if ((sign > 0 && occupied < -1) || (sign < 0 && occupied > 1)) return [];
      return [candidate(backgammonPoint(source), backgammonPoint(destination), occupied !== 0 && Math.sign(occupied) !== sign ? backgammonPoint(destination) : null)];
    });
  },
  apply: (position, seat, move) => {
    const state = backgammonEngine.parse(position);
    const current = state && readBackgammon(state);
    if (!state || !current || state.turn !== seat) return null;
    const source = backgammonSourceIndex(move.from);
    if (source === null || (seat === RED ? current.points[source] <= 0 : current.points[source] >= 0)) return null;
    const sign = seat === RED ? 1 : -1;
    const destination = source + sign * Math.max(1, current.roll);
    if (!samePoint(move.to, backgammonTarget(destination, sign))) return null;
    const points = current.points.slice();
    points[source] -= sign;
    if (destination < 0 || destination >= 24) current.borneOff[seat === RED ? 0 : 1] += 1;
    else {
      if (Math.sign(points[destination]) === -sign && Math.abs(points[destination]) === 1) {
        current.bar[seat === RED ? 1 : 0] += 1;
        points[destination] = 0;
      }
      points[destination] += sign;
    }
    return jsonPosition("backgammon", { points, bar: current.bar, borneOff: current.borneOff, roll: 1 }, otherSeat(seat), { movedFrom: source, movedTo: destination });
  },
};

function chineseCheckersPlayable(point: OnlinePoint): boolean {
  return inBounds(point, 13, 13) && (point.x + point.y) % 2 === 0 && Math.abs(point.x - 6) + Math.abs(point.y - 6) <= 8;
}

function chineseCheckersPoints(): OnlinePoint[] {
  return gridCoordinates(13, 13).filter(chineseCheckersPlayable);
}

function chineseCheckersInitial(): string {
  const board = Array.from({ length: 169 }, () => "0");
  for (const point of chineseCheckersPoints()) {
    if (point.y <= 2 && Math.abs(point.x - 6) <= point.y) board[indexOf(point, 13)] = "r";
    if (point.y >= 10 && Math.abs(point.x - 6) <= 12 - point.y) board[indexOf(point, 13)] = "b";
  }
  return board.join("");
}

function chineseCheckersOwner(piece: string): GameSeat | null {
  if (piece === "r") return RED;
  if (piece === "b") return BLACK;
  return null;
}

function chineseCheckersTargets(board: string, from: OnlinePoint, seat: GameSeat): OnlineMoveCandidate[] {
  if (!chineseCheckersPlayable(from) || chineseCheckersOwner(board[indexOf(from, 13)]) !== seat) return [];
  const result: OnlineMoveCandidate[] = [];
  const stepDirections = [[2, 0], [-2, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [dx, dy] of stepDirections) {
    const to = { x: from.x + dx, y: from.y + dy };
    if (chineseCheckersPlayable(to) && board[indexOf(to, 13)] === "0") result.push(candidate(from, to));
  }
  const jumpDirections = [[4, 0], [-4, 0], [2, 2], [2, -2], [-2, 2], [-2, -2]];
  for (const [dx, dy] of jumpDirections) {
    const jumped = { x: from.x + dx / 2, y: from.y + dy / 2 };
    const to = { x: from.x + dx, y: from.y + dy };
    if (chineseCheckersPlayable(jumped) && board[indexOf(jumped, 13)] !== "0" && chineseCheckersPlayable(to) && board[indexOf(to, 13)] === "0") {
      result.push(candidate(from, to, jumped));
    }
  }
  return result;
}

const chineseCheckersEngine: OnlineGameEngine = {
  id: "chinese-checkers",
  board: { kind: "star", columns: 13, rows: 13, coordinates: chineseCheckersPoints(), aspectRatio: 1 },
  initialPosition: () => jsonPosition("chinese-checkers", chineseCheckersInitial(), RED),
  parse: (position) => parseJsonPosition("chinese-checkers", position),
  legalMoves: (position, seat, from) => {
    const state = chineseCheckersEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return [];
    return from ? chineseCheckersTargets(state.board, from, seat) : chineseCheckersPoints().flatMap((point) => chineseCheckersTargets(state.board as string, point, seat));
  },
  apply: (position, seat, move) => {
    const state = chineseCheckersEngine.parse(position);
    if (!state || state.turn !== seat || typeof state.board !== "string") return null;
    const legal = chineseCheckersTargets(state.board, move.from, seat).find((item) => samePoint(item.to, move.to));
    if (!legal) return null;
    let board = setBoardCell(state.board, move.from, "0", 13);
    board = setBoardCell(board, move.to, markFor(seat) === "1" ? "r" : "b", 13);
    return jsonPosition("chinese-checkers", board, otherSeat(seat), { jumped: legal.captured });
  },
};

export const ONLINE_GAME_ENGINES: Readonly<Record<OnlineGameId, OnlineGameEngine>> = {
  gomoku: gomokuEngine,
  "tic-tac-toe": ticTacToeEngine,
  chess: chessEngine,
  reversi: reversiEngine,
  checkers: checkersEngine,
  xiangqi: xiangqiEngine,
  go: goEngine,
  shogi: shogiEngine,
  connect6: connect6Engine,
  ludo: ludoEngine,
  "animal-chess": animalChessEngine,
  "army-chess": armyChessEngine,
  backgammon: backgammonEngine,
  "dots-and-boxes": dotsAndBoxesEngine,
  mancala: mancalaEngine,
  "chinese-checkers": chineseCheckersEngine,
};

export function getOnlineGameEngine(gameId: OnlineGameId): OnlineGameEngine {
  return ONLINE_GAME_ENGINES[gameId];
}

export function createInitialPosition(gameId: OnlineGameId): string {
  return getOnlineGameEngine(gameId).initialPosition();
}

export function parseOnlinePosition(gameId: OnlineGameId, position: string): OnlinePositionState | null {
  return getOnlineGameEngine(gameId).parse(position);
}

export function getLegalMoves(gameId: OnlineGameId, position: string, seat: GameSeat, from?: OnlinePoint): OnlineMoveCandidate[] {
  const engine = getOnlineGameEngine(gameId);
  const coordinateKeys = engine.board.coordinates
    ? new Set(engine.board.coordinates.map((point) => pointKey(point)))
    : null;
  const isProtocolPoint = (point: OnlinePoint): boolean => {
    if (!inBounds(point, engine.board.columns, engine.board.rows)) return false;
    return coordinateKeys === null || coordinateKeys.has(pointKey(point));
  };
  return engine.legalMoves(position, seat, from).filter((move) =>
    isProtocolPoint(move.from)
    && isProtocolPoint(move.to)
    && (move.captured === null || isProtocolPoint(move.captured)),
  );
}

export function applyOnlineMove(
  gameId: OnlineGameId,
  position: string,
  seat: GameSeat,
  from: OnlinePoint,
  to?: OnlinePoint,
): string | null {
  const moves = getLegalMoves(gameId, position, seat, from);
  const sourceMoves = moves.filter((candidateMove) => samePoint(candidateMove.from, from));
  const move = to
    ? sourceMoves.find((candidateMove) => samePoint(candidateMove.to, to))
    : sourceMoves.find((candidateMove) => samePoint(candidateMove.from, from) && samePoint(candidateMove.to, from))
      ?? sourceMoves[0];
  return move ? getOnlineGameEngine(gameId).apply(position, seat, move) : null;
}

export function validateOnlineMove(
  gameId: OnlineGameId,
  position: string,
  seat: GameSeat,
  from: OnlinePoint,
  to?: OnlinePoint,
): boolean {
  return applyOnlineMove(gameId, position, seat, from, to) !== null;
}

/** Build the exact envelope consumed by SocialClient.sendMove. */
export function createOnlineMove(input: CreateOnlineMoveInput): GameMove | null {
  const state = parseOnlinePosition(input.gameId, input.position);
  if (!state || state.turn !== input.seat) return null;
  const moves = getLegalMoves(input.gameId, input.position, input.seat, input.from);
  const sourceMoves = moves.filter((candidateMove) => samePoint(candidateMove.from, input.from));
  const requestedTo = input.to;
  const legal = requestedTo
    ? sourceMoves.find((candidateMove) => samePoint(candidateMove.to, requestedTo))
    : sourceMoves.find((candidateMove) => samePoint(candidateMove.from, input.from) && samePoint(candidateMove.to, input.from))
      ?? sourceMoves[0];
  if (!legal) return null;
  const nextPosition = getOnlineGameEngine(input.gameId).apply(input.position, input.seat, legal);
  if (!nextPosition) return null;
  return {
    roomId: input.roomId,
    gameId: input.gameId as unknown as GameMove["gameId"],
    seat: input.seat,
    from: { x: legal.from.x, y: legal.from.y },
    to: { x: legal.to.x, y: legal.to.y },
    captured: legal.captured,
    position: nextPosition,
    seq: input.seq,
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function isOnlineGameId(value: string): value is OnlineGameId {
  return (ONLINE_GAME_IDS as readonly string[]).includes(value);
}
