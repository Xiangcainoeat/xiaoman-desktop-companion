import { describe, expect, it } from "vitest";
import { settleGameResult } from "../src/shared/games";

describe("game settlement", () => {
  it("clamps scores and returns bounded fixed rewards", () => {
    expect(settleGameResult("rock-paper-scissors", -20)).toEqual({ gameId: "rock-paper-scissors", score: 0, affection: 1, experience: 2 });
    expect(settleGameResult("bubble-pop", 99999)).toEqual({ gameId: "bubble-pop", score: 100, affection: 5, experience: 12 });
    expect(settleGameResult("fish-catch", 7)).toEqual({ gameId: "fish-catch", score: 7, affection: 2, experience: 4 });
  });
});
