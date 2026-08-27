import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RPS_ROUNDS,
  RPS_CHOICES,
  chooseComputerChoice,
  resolveRpsRound,
  scoreRpsRounds,
  type RpsRoundResult,
} from "./RockPaperScissors";

describe("rock-paper-scissors rules", () => {
  it("offers exactly three accessible choices and three rounds", () => {
    expect(RPS_CHOICES).toEqual(["rock", "paper", "scissors"]);
    expect(RPS_ROUNDS).toBe(3);
  });

  it("resolves wins, draws, and losses", () => {
    expect(resolveRpsRound("rock", "scissors")).toBe("win");
    expect(resolveRpsRound("paper", "paper")).toBe("draw");
    expect(resolveRpsRound("scissors", "rock")).toBe("loss");
  });

  it("keeps random choice within the shared choice set", () => {
    expect(chooseComputerChoice(() => 0)).toBe("rock");
    expect(chooseComputerChoice(() => 0.34)).toBe("paper");
    expect(chooseComputerChoice(() => 0.99)).toBe("scissors");
    expect(chooseComputerChoice(() => 5)).toBe("scissors");
  });

  it("converts three round outcomes into a bounded score", () => {
    const rounds: RpsRoundResult[] = [
      { player: "rock", computer: "scissors", outcome: "win" },
      { player: "paper", computer: "paper", outcome: "draw" },
      { player: "scissors", computer: "rock", outcome: "loss" },
    ];
    expect(scoreRpsRounds(rounds)).toBe(50);
    expect(scoreRpsRounds([])).toBe(0);
    expect(scoreRpsRounds(rounds.slice(0, 1))).toBe(33);
  });
});

describe("RockPaperScissors source contract", () => {
  const source = readFileSync(new URL("./RockPaperScissors.tsx", import.meta.url), "utf8");

  it("uses the local session boundary instead of mutating persistence", () => {
    expect(source).toContain("session.finish");
    expect(source).toContain("aria-label");
    expect(source).toContain("RPS_ROUNDS");
    expect(source).not.toContain("feedFood");
    expect(source).not.toContain("localStorage");
  });
});
