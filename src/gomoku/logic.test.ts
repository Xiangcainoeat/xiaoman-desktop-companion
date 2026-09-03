import { describe, expect, it } from "vitest";
import {
  applyGomokuMove,
  chooseGomokuMove,
  createGomokuBoard,
  findGomokuWinner,
  winnerFromMove,
} from "./logic";

function boardWith(moves: Array<[number, number, 1 | 2]>) {
  let board = createGomokuBoard();
  for (const [row, col, player] of moves) {
    const next = applyGomokuMove(board, { row, col }, player);
    if (!next) throw new Error("invalid test move");
    board = next;
  }
  return board;
}

describe("gomoku rules", () => {
  it("detects horizontal, diagonal, and anti-diagonal wins", () => {
    const horizontal = boardWith([[7, 3, 1], [7, 4, 1], [7, 5, 1], [7, 6, 1], [7, 7, 1]]);
    expect(findGomokuWinner(horizontal)?.player).toBe(1);

    const diagonal = boardWith([[3, 3, 2], [4, 4, 2], [5, 5, 2], [6, 6, 2], [7, 7, 2]]);
    expect(findGomokuWinner(diagonal)?.line).toHaveLength(5);

    const antiDiagonal = boardWith([[3, 8, 1], [4, 7, 1], [5, 6, 1], [6, 5, 1], [7, 4, 1]]);
    expect(findGomokuWinner(antiDiagonal)?.player).toBe(1);
  });

  it("rejects occupied cells and returns the winning line for the last move", () => {
    const board = boardWith([[7, 3, 1], [7, 4, 1], [7, 5, 1], [7, 6, 1]]);
    expect(applyGomokuMove(board, { row: 7, col: 6 }, 2)).toBeNull();
    const next = applyGomokuMove(board, { row: 7, col: 7 }, 1);
    expect(next).not.toBeNull();
    expect(winnerFromMove(next!, { row: 7, col: 7 }, 1)?.line).toHaveLength(5);
  });

  it("takes a winning move and blocks an immediate threat", () => {
    const winning = boardWith([[7, 5, 2], [7, 6, 2], [7, 7, 2], [7, 8, 2], [6, 6, 1]]);
    const winningMove = chooseGomokuMove(winning, 2, "medium");
    expect(winningMove).not.toBeNull();
    expect(winnerFromMove(applyGomokuMove(winning, winningMove!, 2)!, winningMove!, 2)?.player).toBe(2);

    const threat = boardWith([[6, 4, 1], [6, 5, 1], [6, 6, 1], [6, 7, 1], [7, 7, 2]]);
    const blockingMove = chooseGomokuMove(threat, 2, "hard");
    expect(blockingMove).not.toBeNull();
    const afterBlock = applyGomokuMove(threat, blockingMove!, 2)!;
    expect(findGomokuWinner(afterBlock)?.player).not.toBe(1);
  });
});
