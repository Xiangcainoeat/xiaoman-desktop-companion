import type { GameId, GameSettlement } from "./types";

export const REWARDED_GAME_IDS = [
  "rock-paper-scissors",
  "fish-catch",
  "bubble-pop",
  "xiangqi",
  "gomoku",
  "animal-chess",
  "monopoly",
  "doudizhu",
  "spider-solitaire",
  "hearts",
  "minesweeper",
] as const satisfies readonly GameId[];

export function isRewardedGameId(value: unknown): value is GameId {
  return typeof value === "string" && REWARDED_GAME_IDS.includes(value as (typeof REWARDED_GAME_IDS)[number]);
}

export function settleGameResult(gameId: GameId, score: number): GameSettlement {
  const safeScore = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  const rewards: Record<GameId, { affection: number; experience: number }> = {
    "rock-paper-scissors": { affection: 1, experience: 2 },
    "fish-catch": { affection: 2, experience: 4 },
    "bubble-pop": { affection: 5, experience: 12 },
    xiangqi: { affection: 4, experience: 10 },
    gomoku: { affection: 3, experience: 8 },
    "animal-chess": { affection: 4, experience: 10 },
    monopoly: { affection: 5, experience: 14 },
    doudizhu: { affection: 5, experience: 15 },
    "spider-solitaire": { affection: 3, experience: 8 },
    hearts: { affection: 4, experience: 10 },
    minesweeper: { affection: 3, experience: 8 },
  };
  const reward = rewards[gameId];
  return { gameId, score: safeScore, affection: reward.affection, experience: reward.experience };
}
