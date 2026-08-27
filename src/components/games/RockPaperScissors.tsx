import { Circle, Hand, Scissors } from "lucide-react";
import { useRef, useState } from "react";
import type { GameSession } from "../GameShell";

export const RPS_ROUNDS = 3;
export const RPS_CHOICES = ["rock", "paper", "scissors"] as const;
export type RpsChoice = (typeof RPS_CHOICES)[number];
export type RpsOutcome = "win" | "draw" | "loss";

export interface RpsRoundResult {
  player: RpsChoice;
  computer: RpsChoice;
  outcome: RpsOutcome;
}

const CHOICE_LABELS: Record<RpsChoice, string> = {
  rock: "石头",
  paper: "布",
  scissors: "剪刀",
};

const OUTCOME_LABELS: Record<RpsOutcome, string> = {
  win: "小满输了这一局",
  draw: "这一局平手",
  loss: "小满赢了这一局",
};

const CHOICE_ICONS: Record<RpsChoice, typeof Circle> = {
  rock: Circle,
  paper: Hand,
  scissors: Scissors,
};

export function chooseComputerChoice(random: () => number = Math.random): RpsChoice {
  const sample = random();
  const normalized = Number.isFinite(sample) ? Math.max(0, Math.min(0.999999, sample)) : 0;
  return RPS_CHOICES[Math.floor(normalized * RPS_CHOICES.length)] ?? "rock";
}

export function resolveRpsRound(player: RpsChoice, computer: RpsChoice): RpsOutcome {
  if (player === computer) return "draw";
  const playerWins = (player === "rock" && computer === "scissors")
    || (player === "paper" && computer === "rock")
    || (player === "scissors" && computer === "paper");
  return playerWins ? "win" : "loss";
}

export function scoreRpsRounds(rounds: readonly RpsRoundResult[]): number {
  if (rounds.length === 0) return 0;
  const points = rounds.slice(0, RPS_ROUNDS).reduce((total, round) => (
    total + (round.outcome === "win" ? 100 : round.outcome === "draw" ? 50 : 0)
  ), 0);
  return Math.round(Math.max(0, Math.min(100, points / RPS_ROUNDS)));
}

function stopEvent(event: React.SyntheticEvent) {
  event.stopPropagation();
}

export function RockPaperScissors({ session }: { session: GameSession }) {
  const [rounds, setRounds] = useState<RpsRoundResult[]>([]);
  const settledRef = useRef(false);

  const choose = (player: RpsChoice) => {
    if (session.locked || settledRef.current || rounds.length >= RPS_ROUNDS) return;
    const computer = chooseComputerChoice();
    const nextRound: RpsRoundResult = { player, computer, outcome: resolveRpsRound(player, computer) };
    const nextRounds = [...rounds, nextRound];
    setRounds(nextRounds);
    if (nextRounds.length === RPS_ROUNDS) {
      settledRef.current = true;
      session.finish(scoreRpsRounds(nextRounds));
    }
  };

  const latest = rounds[rounds.length - 1] ?? null;
  const nextRoundNumber = Math.min(RPS_ROUNDS, rounds.length + 1);

  return (
    <div className="mini-game mini-game-rps" onClick={stopEvent}>
      <div className="mini-game-progress" aria-live="polite">
        <span>第 {nextRoundNumber} / {RPS_ROUNDS} 局</span>
        <span>{rounds.length === RPS_ROUNDS ? `最终得分 ${scoreRpsRounds(rounds)}` : "选一个出招"}</span>
      </div>
      {latest && (
        <div className="rps-round-result" role="status">
          <strong>{OUTCOME_LABELS[latest.outcome]}</strong>
          <span>你出了{CHOICE_LABELS[latest.player]}，小满出了{CHOICE_LABELS[latest.computer]}</span>
        </div>
      )}
      <div className="rps-choice-grid" role="group" aria-label="猜拳出招">
        {RPS_CHOICES.map((choice) => {
          const Icon = CHOICE_ICONS[choice];
          return (
            <button
              key={choice}
              className="rps-choice-button"
              type="button"
              disabled={session.locked || rounds.length >= RPS_ROUNDS}
              aria-label={`出${CHOICE_LABELS[choice]}`}
              onPointerDown={stopEvent}
              onMouseDown={stopEvent}
              onClick={(event) => { stopEvent(event); choose(choice); }}
            >
              <Icon size={26} aria-hidden="true" />
              <span>{CHOICE_LABELS[choice]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
