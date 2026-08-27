import type { GameId, GameSettlement } from "./types";

export function settleGameResult(gameId: GameId, score: number): GameSettlement {
  const safeScore = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  const rewards: Record<GameId, { affection: number; experience: number }> = {
    "rock-paper-scissors": { affection: 1, experience: 2 },
    "fish-catch": { affection: 2, experience: 4 },
    "bubble-pop": { affection: 5, experience: 12 },
  };
  const reward = rewards[gameId];
  return { gameId, score: safeScore, affection: reward.affection, experience: reward.experience };
}
