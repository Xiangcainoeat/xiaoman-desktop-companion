export const GOMOKU_SIZE = 15;
export const GOMOKU_POSITION_LENGTH = GOMOKU_SIZE * GOMOKU_SIZE;
export const GOMOKU_WIN_LENGTH = 5;

export type GomokuPlayer = 1 | 2;
export type GomokuCell = 0 | GomokuPlayer;
export type GomokuBoard = GomokuCell[][];
export type GomokuDifficulty = "easy" | "medium" | "hard" | "master";

export interface GomokuPoint {
  row: number;
  col: number;
}

export interface GomokuWinner {
  player: GomokuPlayer;
  line: GomokuPoint[];
}

const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const;

const CENTER = (GOMOKU_SIZE - 1) / 2;

export function createGomokuBoard(): GomokuBoard {
  return Array.from({ length: GOMOKU_SIZE }, () => Array<GomokuCell>(GOMOKU_SIZE).fill(0));
}

export function cloneGomokuBoard(board: GomokuBoard): GomokuBoard {
  return board.map((row) => row.slice());
}

export function isGomokuPoint(point: GomokuPoint): boolean {
  return Number.isInteger(point.row)
    && Number.isInteger(point.col)
    && point.row >= 0
    && point.row < GOMOKU_SIZE
    && point.col >= 0
    && point.col < GOMOKU_SIZE;
}

export function boardToString(board: GomokuBoard): string {
  return board.flat().join("");
}

export function boardFromString(value: string): GomokuBoard {
  if (value.length !== GOMOKU_POSITION_LENGTH || !/^[012]+$/.test(value)) {
    return createGomokuBoard();
  }
  return Array.from({ length: GOMOKU_SIZE }, (_, row) => (
    Array.from({ length: GOMOKU_SIZE }, (_, col) => Number(value[row * GOMOKU_SIZE + col]) as GomokuCell)
  ));
}

export function applyGomokuMove(
  board: GomokuBoard,
  point: GomokuPoint,
  player: GomokuPlayer,
): GomokuBoard | null {
  if (!isGomokuPoint(point) || board[point.row][point.col] !== 0) return null;
  const next = cloneGomokuBoard(board);
  next[point.row][point.col] = player;
  return next;
}

function pointsInDirection(
  board: GomokuBoard,
  point: GomokuPoint,
  player: GomokuPlayer,
  rowDelta: number,
  colDelta: number,
): GomokuPoint[] {
  const points: GomokuPoint[] = [point];
  for (const sign of [1, -1] as const) {
    let row = point.row + rowDelta * sign;
    let col = point.col + colDelta * sign;
    const collected: GomokuPoint[] = [];
    while (row >= 0 && row < GOMOKU_SIZE && col >= 0 && col < GOMOKU_SIZE && board[row][col] === player) {
      collected.push({ row, col });
      row += rowDelta * sign;
      col += colDelta * sign;
    }
    if (sign === -1) collected.reverse();
    points.unshift(...(sign === -1 ? collected : []));
    if (sign === 1) points.push(...collected);
  }
  return points;
}

export function winnerFromMove(
  board: GomokuBoard,
  point: GomokuPoint,
  player: GomokuPlayer,
): GomokuWinner | null {
  if (!isGomokuPoint(point) || board[point.row][point.col] !== player) return null;
  for (const [rowDelta, colDelta] of DIRECTIONS) {
    const line = pointsInDirection(board, point, player, rowDelta, colDelta);
    if (line.length >= GOMOKU_WIN_LENGTH) {
      const center = Math.floor(line.length / 2);
      const start = Math.max(0, Math.min(center - 2, line.length - GOMOKU_WIN_LENGTH));
      return { player, line: line.slice(start, start + GOMOKU_WIN_LENGTH) };
    }
  }
  return null;
}

export function findGomokuWinner(board: GomokuBoard): GomokuWinner | null {
  for (let row = 0; row < GOMOKU_SIZE; row += 1) {
    for (let col = 0; col < GOMOKU_SIZE; col += 1) {
      const player = board[row][col];
      if (player === 0) continue;
      const winner = winnerFromMove(board, { row, col }, player);
      if (winner) return winner;
    }
  }
  return null;
}

export function isGomokuBoardFull(board: GomokuBoard): boolean {
  return board.every((row) => row.every((cell) => cell !== 0));
}

function hasNeighbor(board: GomokuBoard, row: number, col: number, radius = 2): boolean {
  for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
    for (let colOffset = -radius; colOffset <= radius; colOffset += 1) {
      if (rowOffset === 0 && colOffset === 0) continue;
      const nextRow = row + rowOffset;
      const nextCol = col + colOffset;
      if (nextRow >= 0 && nextRow < GOMOKU_SIZE && nextCol >= 0 && nextCol < GOMOKU_SIZE && board[nextRow][nextCol] !== 0) {
        return true;
      }
    }
  }
  return false;
}

function candidatePoints(board: GomokuBoard): GomokuPoint[] {
  const occupied = board.some((row) => row.some((cell) => cell !== 0));
  if (!occupied) return [{ row: Math.floor(CENTER), col: Math.floor(CENTER) }];
  const points: GomokuPoint[] = [];
  for (let row = 0; row < GOMOKU_SIZE; row += 1) {
    for (let col = 0; col < GOMOKU_SIZE; col += 1) {
      if (board[row][col] === 0 && hasNeighbor(board, row, col)) points.push({ row, col });
    }
  }
  return points.sort((left, right) => pointPriority(board, right) - pointPriority(board, left));
}

function pointPriority(board: GomokuBoard, point: GomokuPoint): number {
  let nearby = 0;
  for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
    for (let colOffset = -2; colOffset <= 2; colOffset += 1) {
      const row = point.row + rowOffset;
      const col = point.col + colOffset;
      if (row >= 0 && row < GOMOKU_SIZE && col >= 0 && col < GOMOKU_SIZE) nearby += board[row][col] === 0 ? 0 : 1;
    }
  }
  const centerDistance = Math.abs(point.row - CENTER) + Math.abs(point.col - CENTER);
  return nearby * 12 - centerDistance;
}

function lineShapeScore(length: number, openEnds: number): number {
  if (length >= 5) return 1_000_000;
  if (length === 4) return openEnds === 2 ? 100_000 : openEnds === 1 ? 12_000 : 0;
  if (length === 3) return openEnds === 2 ? 5_000 : openEnds === 1 ? 600 : 0;
  if (length === 2) return openEnds === 2 ? 260 : openEnds === 1 ? 45 : 0;
  return openEnds === 2 ? 8 : 0;
}

function scoreForPlayer(board: GomokuBoard, player: GomokuPlayer): number {
  let total = 0;
  for (let row = 0; row < GOMOKU_SIZE; row += 1) {
    for (let col = 0; col < GOMOKU_SIZE; col += 1) {
      if (board[row][col] !== player) continue;
      for (const [rowDelta, colDelta] of DIRECTIONS) {
        const previousRow = row - rowDelta;
        const previousCol = col - colDelta;
        if (previousRow >= 0 && previousRow < GOMOKU_SIZE && previousCol >= 0 && previousCol < GOMOKU_SIZE && board[previousRow][previousCol] === player) continue;
        let length = 0;
        let nextRow = row;
        let nextCol = col;
        while (nextRow >= 0 && nextRow < GOMOKU_SIZE && nextCol >= 0 && nextCol < GOMOKU_SIZE && board[nextRow][nextCol] === player) {
          length += 1;
          nextRow += rowDelta;
          nextCol += colDelta;
        }
        let openEnds = 0;
        const beforeRow = row - rowDelta;
        const beforeCol = col - colDelta;
        if (beforeRow >= 0 && beforeRow < GOMOKU_SIZE && beforeCol >= 0 && beforeCol < GOMOKU_SIZE && board[beforeRow][beforeCol] === 0) openEnds += 1;
        if (nextRow >= 0 && nextRow < GOMOKU_SIZE && nextCol >= 0 && nextCol < GOMOKU_SIZE && board[nextRow][nextCol] === 0) openEnds += 1;
        total += lineShapeScore(length, openEnds);
      }
    }
  }
  return total;
}

function evaluate(board: GomokuBoard, player: GomokuPlayer): number {
  const opponent: GomokuPlayer = player === 1 ? 2 : 1;
  return scoreForPlayer(board, player) - scoreForPlayer(board, opponent) * 0.92;
}

function winningMove(board: GomokuBoard, player: GomokuPlayer, points: GomokuPoint[]): GomokuPoint | null {
  for (const point of points) {
    const next = applyGomokuMove(board, point, player);
    if (next && winnerFromMove(next, point, player)) return point;
  }
  return null;
}

function tacticalScore(board: GomokuBoard, point: GomokuPoint, player: GomokuPlayer): number {
  const next = applyGomokuMove(board, point, player);
  if (!next) return -Infinity;
  const opponent: GomokuPlayer = player === 1 ? 2 : 1;
  const own = evaluate(next, player);
  const block = evaluate(next, opponent);
  return own - block * 0.5 + pointPriority(board, point);
}

function minimax(
  board: GomokuBoard,
  player: GomokuPlayer,
  maximizingPlayer: GomokuPlayer,
  depth: number,
  alpha: number,
  beta: number,
): number {
  const winner = findGomokuWinner(board);
  if (winner) return winner.player === maximizingPlayer ? 2_000_000 + depth : -2_000_000 - depth;
  if (depth === 0 || isGomokuBoardFull(board)) return evaluate(board, maximizingPlayer);
  const points = candidatePoints(board).slice(0, depth >= 2 ? 14 : 18);
  const minimizingPlayer: GomokuPlayer = maximizingPlayer === 1 ? 2 : 1;
  const isMaximizing = player === maximizingPlayer;
  let best = isMaximizing ? -Infinity : Infinity;
  for (const point of points) {
    const next = applyGomokuMove(board, point, player);
    if (!next) continue;
    const value = minimax(next, isMaximizing ? minimizingPlayer : maximizingPlayer, maximizingPlayer, depth - 1, alpha, beta);
    if (isMaximizing) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best;
}

function aiDepth(difficulty: GomokuDifficulty): number {
  if (difficulty === "master") return 3;
  if (difficulty === "hard") return 2;
  return 1;
}

export function chooseGomokuMove(
  board: GomokuBoard,
  player: GomokuPlayer,
  difficulty: GomokuDifficulty,
): GomokuPoint | null {
  const points = candidatePoints(board);
  if (points.length === 0) return null;
  if (points.length === 1) return points[0];

  const opponent: GomokuPlayer = player === 1 ? 2 : 1;
  const immediateWin = winningMove(board, player, points);
  if (immediateWin) return immediateWin;
  if (difficulty !== "easy") {
    const immediateBlock = winningMove(board, opponent, points);
    if (immediateBlock) return immediateBlock;
  }

  if (difficulty === "easy") {
    const ranked = points.slice(0, Math.min(points.length, 10));
    return ranked[Math.floor(Math.random() * ranked.length)] ?? points[0];
  }

  if (difficulty === "medium") {
    return points.slice(0, 12).sort((left, right) => tacticalScore(board, right, player) - tacticalScore(board, left, player))[0] ?? points[0];
  }

  const depth = aiDepth(difficulty);
  const candidates = points.slice(0, difficulty === "master" ? 12 : 16);
  let bestPoint = candidates[0];
  let bestValue = -Infinity;
  for (const point of candidates) {
    const next = applyGomokuMove(board, point, player);
    if (!next) continue;
    const value = minimax(next, opponent, player, depth - 1, -Infinity, Infinity) + pointPriority(board, point) * 0.15;
    if (value > bestValue) {
      bestValue = value;
      bestPoint = point;
    }
  }
  return bestPoint;
}

export function playerLabel(player: GomokuPlayer): string {
  return player === 1 ? "黑方" : "白方";
}
