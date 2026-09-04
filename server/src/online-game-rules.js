import { AppError } from "./errors.js";

// Keep the server catalog in lockstep with the public online-games page.  The
// room protocol is deliberately game-agnostic; only the position envelope and
// a small set of safety checks live here.
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
];

export const SUPPORTED_GAME_IDS = new Set(ONLINE_GAME_IDS);

const RED = "red";
const BLACK = "black";
const MAX_POSITION_LENGTH = 500_000;

// Bounds are used for envelope validation and for the generic renderer. They
// do not try to encode every rule of the source projects; those rules remain in
// the client engines and can evolve without changing the WebSocket contract.
const SPECS = Object.freeze({
  gomoku: { columns: 15, rows: 15 },
  "tic-tac-toe": { columns: 3, rows: 3 },
  chess: { columns: 8, rows: 8 },
  reversi: { columns: 8, rows: 8 },
  checkers: { columns: 8, rows: 8 },
  xiangqi: { columns: 9, rows: 10 },
  go: { columns: 9, rows: 9 },
  shogi: { columns: 9, rows: 9 },
  connect6: { columns: 19, rows: 19 },
  ludo: { columns: 13, rows: 8 },
  "animal-chess": { columns: 8, rows: 4 },
  "army-chess": { columns: 5, rows: 12 },
  // Rows 0 and 1 are the 24 playable points; row 2 is the explicit bear-off
  // gutter used by the client move envelope.
  backgammon: { columns: 12, rows: 3 },
  "dots-and-boxes": { columns: 4, rows: 4 },
  mancala: { columns: 7, rows: 2 },
  "chinese-checkers": { columns: 13, rows: 13 },
});

export function gameSpec(gameId) {
  return SPECS[gameId] ?? null;
}

export function pointBounds(gameId) {
  const spec = gameSpec(gameId);
  if (!spec) return null;
  return { maxX: spec.columns - 1, maxY: spec.rows - 1 };
}

function emptyBoard(gameId) {
  const spec = gameSpec(gameId);
  return "0".repeat(spec.columns * spec.rows);
}

function reversiBoard() {
  const board = Array.from({ length: 64 }, () => "0");
  board[3 * 8 + 3] = "2";
  board[3 * 8 + 4] = "1";
  board[4 * 8 + 3] = "1";
  board[4 * 8 + 4] = "2";
  return board.join("");
}

function checkersBoard() {
  const board = Array.from({ length: 64 }, () => "0");
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if ((row + col) % 2 === 1) board[row * 8 + col] = "b";
    }
  }
  for (let row = 5; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      if ((row + col) % 2 === 1) board[row * 8 + col] = "r";
    }
  }
  return board.join("");
}

const ARMY_CAMP_INDICES = new Set([11, 13, 17, 21, 23, 36, 38, 42, 46, 48]);
const ARMY_PIECES = [
  "f", "l", "l", "l", "b", "b", "a", "j", "s", "s", "t", "t", "r", "r", "y", "y", "c", "c", "p", "p", "g", "g", "g", "m", "m",
];

function armyBoard() {
  const board = Array.from({ length: 5 * 12 }, () => "0");
  const playable = board.map((_, index) => index).filter((index) => !ARMY_CAMP_INDICES.has(index));
  playable.slice(0, ARMY_PIECES.length).forEach((index, pieceIndex) => { board[index] = ARMY_PIECES[pieceIndex]; });
  playable.slice(ARMY_PIECES.length).forEach((index, pieceIndex) => { board[index] = ARMY_PIECES[pieceIndex].toUpperCase(); });
  return board.join("");
}

function initialBoard(gameId) {
  if (gameId === "reversi") return reversiBoard();
  if (gameId === "checkers") return checkersBoard();
  if (gameId === "chess") return "rnbqkbnrpppppppp00000000000000000000000000000000PPPPPPPPRNBQKBNR";
  if (gameId === "shogi") return [
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
  if (gameId === "xiangqi") return "rnbakabnr000c000c0p0p0p0p0p000000000000000000000000000000000000P0P0P0P0P0C00000C0RNBAKABNR";
  if (gameId === "animal-chess") return adjacentBoard(8, 4, [
    [0, "e"], [1, "l"], [2, "t"], [5, "t"], [6, "l"], [7, "e"], [8, "r"], [15, "c"], [16, "R"], [23, "C"], [24, "E"], [25, "L"], [26, "T"], [29, "T"], [30, "L"], [31, "E"],
  ]);
  if (gameId === "army-chess") return armyBoard();
  if (gameId === "dots-and-boxes") return { h: "0".repeat(12), v: "0".repeat(12), boxes: "0".repeat(9), scores: [0, 0] };
  if (gameId === "mancala") return { pits: [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0], stores: [0, 0] };
  if (gameId === "ludo") return { tokens: [[-1, -1, -1, -1], [-1, -1, -1, -1]], roll: 1 };
  if (gameId === "backgammon") return { points: [2, 0, 0, 0, 0, -5, 0, -3, 0, 0, 0, 5, -5, 0, 0, 0, 3, 0, 5, 0, 0, 0, 0, -2], bar: [0, 0], borneOff: [0, 0], roll: 1 };
  if (gameId === "chinese-checkers") return chineseCheckersBoard();
  if (gameId === "checkers") return checkersBoard();
  return emptyBoard(gameId);
}

function adjacentBoard(columns, rows, placements) {
  const board = Array.from({ length: columns * rows }, () => "0");
  for (const [index, value] of placements) board[index] = value;
  return board.join("");
}

function chineseCheckersBoard() {
  const board = Array.from({ length: 169 }, () => "0");
  for (let y = 0; y < 13; y += 1) {
    for (let x = 0; x < 13; x += 1) {
      if ((x + y) % 2 !== 0 || Math.abs(x - 6) + Math.abs(y - 6) > 8) continue;
      if (y <= 2 && Math.abs(x - 6) <= y) board[y * 13 + x] = "r";
      if (y >= 10 && Math.abs(x - 6) <= 12 - y) board[y * 13 + x] = "b";
    }
  }
  return board.join("");
}

export function initialPosition(gameId) {
  if (gameId === "gomoku") return emptyBoard("gomoku");
  // Existing Xiangqi rooms used an opaque H5 position. Keep that encoding
  // valid so an upgrade never invalidates a room already in progress.
  if (gameId === "xiangqi") return "initial";
  const extra = gameId === "connect6"
    ? { moveCount: 0, stonesThisTurn: 0 }
    : gameId === "army-chess"
      ? { revealed: [] }
      : {};
  return JSON.stringify({ v: 1, game: gameId, board: initialBoard(gameId), turn: RED, ...extra });
}

export function isPoint(value, gameId) {
  const bounds = pointBounds(gameId);
  return Boolean(bounds)
    && value && Number.isInteger(value.x) && Number.isInteger(value.y)
    && value.x >= 0 && value.x <= bounds.maxX
    && value.y >= 0 && value.y <= bounds.maxY;
}

export function isLegacyGomokuPosition(position) {
  return typeof position === "string" && position.length === 225 && /^[012]+$/.test(position);
}

function parsePosition(position) {
  if (typeof position !== "string" || !position || position.length > MAX_POSITION_LENGTH) return null;
  try {
    const value = JSON.parse(position);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function validBoardValue(board, gameId) {
  const spec = gameSpec(gameId);
  if (!spec) return false;
  if (typeof board === "string") {
    return board.length === spec.columns * spec.rows && /^[\u0000-\u007f]+$/.test(board);
  }
  if (Array.isArray(board)) return board.length <= spec.columns * spec.rows * 4;
  return board && typeof board === "object" && JSON.stringify(board).length <= MAX_POSITION_LENGTH;
}

export function isStructuredPosition(position, gameId) {
  const value = parsePosition(position);
  return Boolean(value)
    && value.game === gameId
    && (value.turn === RED || value.turn === BLACK)
    && validBoardValue(value.board, gameId);
}

function samePoint(left, right) {
  return left?.x === right?.x && left?.y === right?.y;
}

function markerFor(seat) { return seat === RED ? "1" : "2"; }

function pieceBelongsToSeat(gameId, piece, seat) {
  if (typeof piece !== "string" || !piece || piece === "0") return false;
  if (["chess", "shogi", "xiangqi", "animal-chess", "army-chess"].includes(gameId)) {
    return seat === RED ? piece === piece.toUpperCase() : piece === piece.toLowerCase();
  }
  if (["checkers", "chinese-checkers"].includes(gameId)) {
    return seat === RED ? piece.toLowerCase() === "r" : piece.toLowerCase() === "b";
  }
  return piece === markerFor(seat);
}

function boardAt(board, point, columns) {
  return typeof board === "string" ? board[point.y * columns + point.x] : undefined;
}

function countChangedCells(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return null;
  let changed = 0;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) changed += 1;
  return changed;
}

function armyRevealedSet(value, allowMissing = false) {
  if (value === undefined && allowMissing) return new Set();
  if (!Array.isArray(value)) return null;
  const result = new Set();
  for (const index of value) {
    if (!Number.isInteger(index) || index < 0 || index >= 60 || result.has(index)) return null;
    result.add(index);
  }
  return result;
}

function sameNumberSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function armyBoardAfterMove(board, fromIndex, toIndex) {
  const next = board.split("");
  next[toIndex] = next[fromIndex];
  next[fromIndex] = "0";
  return next.join("");
}

function validateArmyChessMove(current, next, move, seat) {
  if (typeof current.board !== "string" || current.board.length !== 60
    || typeof next.board !== "string" || next.board.length !== 60) {
    throw new AppError("MOVE_REJECTED", "军棋棋盘状态无效", 400);
  }
  const currentRevealed = armyRevealedSet(current.revealed, true);
  const nextRevealed = armyRevealedSet(next.revealed);
  if (!currentRevealed || !nextRevealed) throw new AppError("MOVE_REJECTED", "军棋翻牌状态无效", 400);

  const expectedTurn = seat === RED ? BLACK : RED;
  if (next.turn !== expectedTurn) throw new AppError("MOVE_REJECTED", "军棋每步必须切换回合", 409);
  const fromIndex = move.from.y * 5 + move.from.x;
  const toIndex = move.to.y * 5 + move.to.x;
  const source = current.board[fromIndex];
  const destination = current.board[toIndex];

  if (samePoint(move.from, move.to)) {
    if (source === "0" || currentRevealed.has(fromIndex)) {
      throw new AppError("MOVE_REJECTED", "这个军棋位置不能翻开", 409);
    }
    const expectedRevealed = new Set(currentRevealed);
    expectedRevealed.add(fromIndex);
    if (next.board !== current.board || !sameNumberSet(expectedRevealed, nextRevealed) || move.captured !== null) {
      throw new AppError("MOVE_REJECTED", "军棋翻牌状态与服务器不同步", 409);
    }
    return { position: move.position, nextTurn: expectedTurn, winner: null, finished: false };
  }

  const adjacent = Math.abs(move.from.x - move.to.x) + Math.abs(move.from.y - move.to.y) === 1;
  if (!adjacent || !currentRevealed.has(fromIndex) || !pieceBelongsToSeat("army-chess", source, seat)) {
    throw new AppError("MOVE_REJECTED", "这个军棋棋子不能这样移动", 409);
  }
  if (pieceBelongsToSeat("army-chess", destination, seat)
    || (destination !== "0" && !currentRevealed.has(toIndex))) {
    throw new AppError("MOVE_REJECTED", "军棋目标位置不可用", 409);
  }
  const expectedBoard = armyBoardAfterMove(current.board, fromIndex, toIndex);
  const expectedRevealed = new Set(currentRevealed);
  expectedRevealed.delete(fromIndex);
  expectedRevealed.delete(toIndex);
  expectedRevealed.add(toIndex);
  const expectedCapture = destination === "0" ? null : move.to;
  if (next.board !== expectedBoard || !sameNumberSet(expectedRevealed, nextRevealed)
    || !samePoint(move.captured, expectedCapture)) {
    throw new AppError("MOVE_REJECTED", "军棋走子状态与服务器不同步", 409);
  }
  return { position: move.position, nextTurn: expectedTurn, winner: null, finished: false };
}

function lineWinner(board, columns, rows, point, marker, length) {
  if (typeof board !== "string") return false;
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const at = (x, y) => x >= 0 && x < columns && y >= 0 && y < rows && board[y * columns + x] === marker;
  for (const [dx, dy] of directions) {
    let count = 1;
    for (const sign of [1, -1]) {
      let x = point.x + dx * sign;
      let y = point.y + dy * sign;
      while (at(x, y)) { count += 1; x += dx * sign; y += dy * sign; }
    }
    if (count >= length) return true;
  }
  return false;
}

function resultFor(gameId, next, move, seat) {
  const board = next.board;
  const spec = gameSpec(gameId);
  const marker = markerFor(seat);
  if (typeof board === "string" && samePoint(move.from, move.to)) {
    if (gameId === "gomoku" || gameId === "connect6") {
      if (lineWinner(board, spec.columns, spec.rows, move.to, marker, gameId === "gomoku" ? 5 : 6)) return seat;
    }
    if (gameId === "tic-tac-toe" && lineWinner(board, 3, 3, move.to, marker, 3)) return seat;
    if (["tic-tac-toe", "gomoku"].includes(gameId) && !board.includes("0")) return "draw";
  }
  if (typeof next.result === "string" && (next.result === RED || next.result === BLACK || next.result === "draw")) return next.result;
  return null;
}

/**
 * Validate a move and return the state metadata the room store should commit.
 * The returned position is always the exact client position after validation;
 * this makes the protocol compatible with richer board encodings (pieces,
 * dice, captured units, and edge sets) without putting rendering details in
 * SQLite or in the WebSocket layer.
 */
export function validateAndApplyMove(gameId, currentPosition, move, seat) {
  if (!SUPPORTED_GAME_IDS.has(gameId) || move?.gameId !== gameId || move?.seat !== seat) {
    throw new AppError("MOVE_REJECTED", "走子数据与房间不匹配", 400);
  }
  if (!isPoint(move.from, gameId) || !isPoint(move.to, gameId)) {
    throw new AppError("MOVE_REJECTED", "走子坐标超出棋盘范围", 400);
  }
  if (move.captured !== null && move.captured !== undefined && !isPoint(move.captured, gameId)) {
    throw new AppError("MOVE_REJECTED", "吃子坐标无效", 400);
  }
  if (typeof move.position !== "string" || !move.position || move.position.length > MAX_POSITION_LENGTH) {
    throw new AppError("MOVE_REJECTED", "棋局状态无效", 400);
  }

  // Preserve the deployed strict five-in-a-row wire format.
  if (gameId === "gomoku" && isLegacyGomokuPosition(currentPosition)) {
    if (!samePoint(move.from, move.to) || move.captured !== null || !isLegacyGomokuPosition(move.position)) {
      throw new AppError("MOVE_REJECTED", "五子棋走子数据无效", 400);
    }
    const index = move.from.y * 15 + move.from.x;
    const marker = markerFor(seat);
    if (currentPosition[index] !== "0") throw new AppError("MOVE_REJECTED", "这个位置已经有棋子", 409);
    const expected = `${currentPosition.slice(0, index)}${marker}${currentPosition.slice(index + 1)}`;
    if (move.position !== expected) throw new AppError("MOVE_REJECTED", "棋盘状态与服务器不同步，请重新同步", 409);
    const winning = lineWinner(move.position, 15, 15, move.to, marker, 5);
    return { position: move.position, nextTurn: seat === RED ? BLACK : RED, winner: winning ? seat : null, finished: winning || !move.position.includes("0") };
  }

  // Xiangqi's original iframe bridge intentionally used opaque positions. It
  // still receives coordinate/bounds checks, while new engines may opt into
  // the structured JSON envelope below.
  const current = parsePosition(currentPosition);
  const next = parsePosition(move.position);
  if (!current || !next || current.game !== gameId || next.game !== gameId) {
    if (gameId === "xiangqi" && currentPosition === "initial" && move.position !== "initial") {
      return { position: move.position, nextTurn: seat === RED ? BLACK : RED, winner: null, finished: false };
    }
    // Older Xiangqi clients may send opaque snapshots after the first move.
    if (gameId === "xiangqi" && typeof move.position === "string" && move.position !== currentPosition) {
      return { position: move.position, nextTurn: seat === RED ? BLACK : RED, winner: null, finished: false };
    }
    throw new AppError("MOVE_REJECTED", "棋局状态格式无效，请重新同步", 400);
  }
  if (current.turn !== seat) throw new AppError("MOVE_REJECTED", "还没轮到这个席位", 409);
  if (!validBoardValue(next.board, gameId)) throw new AppError("MOVE_REJECTED", "棋盘状态格式无效", 400);
  if (move.position === currentPosition) throw new AppError("MOVE_REJECTED", "这一步没有改变棋局", 409);
  if (gameId === "army-chess") return validateArmyChessMove(current, next, move, seat);

  // For string boards, reject impossible wholesale rewrites while allowing
  // games whose move changes several cells (captures, flips, sowing, etc.).
  const changed = countChangedCells(current.board, next.board);
  if (changed === 0) throw new AppError("MOVE_REJECTED", "这一步没有改变棋盘", 409);
  if (typeof current.board === "string" && typeof next.board === "string") {
    const spec = gameSpec(gameId);
    const destination = boardAt(current.board, move.to, spec.columns);
    const source = boardAt(current.board, move.from, spec.columns);
    if (samePoint(move.from, move.to) && destination !== "0") {
      throw new AppError("MOVE_REJECTED", "这个位置已经有棋子", 409);
    }
    if (samePoint(move.from, move.to) && source !== "0"
      && ["tic-tac-toe", "connect6", "go", "gomoku", "reversi"].includes(gameId)) {
      throw new AppError("MOVE_REJECTED", "这个位置已经有棋子", 409);
    }
    if (!samePoint(move.from, move.to) && source !== undefined && source !== "0"
      && !pieceBelongsToSeat(gameId, source, seat)) {
      throw new AppError("MOVE_REJECTED", "不能移动对方棋子", 409);
    }
  }
  const result = resultFor(gameId, next, move, seat);
  const nextTurn = next.turn === RED || next.turn === BLACK ? next.turn : seat === RED ? BLACK : RED;
  return {
    position: move.position,
    nextTurn,
    winner: result === RED || result === BLACK ? result : null,
    finished: result !== null,
  };
}

export { MAX_POSITION_LENGTH, SPECS };
