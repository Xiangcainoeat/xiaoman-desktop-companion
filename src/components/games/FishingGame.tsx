import { Fish, Timer } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameSession } from "../GameShell";

export const FISHING_DURATION_MS = 20_000;

export interface TargetPosition {
  left: number;
  top: number;
}

function unitRandom(random: () => number): number {
  const value = random();
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

export function randomTargetPosition(random: () => number = Math.random): TargetPosition {
  return {
    left: 12 + unitRandom(random) * 76,
    top: 15 + unitRandom(random) * 70,
  };
}

export function fishingScore(hits: number): number {
  if (!Number.isFinite(hits)) return 0;
  return Math.round(Math.max(0, Math.min(100, hits * 10)));
}

function stopEvent(event: React.SyntheticEvent) {
  event.stopPropagation();
}

export function FishingGame({ session, random = Math.random }: { session: GameSession; random?: () => number }) {
  const [target, setTarget] = useState<TargetPosition>(() => randomTargetPosition(random));
  const [timeLeft, setTimeLeft] = useState(FISHING_DURATION_MS);
  const [hits, setHits] = useState(0);
  const hitsRef = useRef(0);
  const settledRef = useRef(false);

  const finish = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    session.finish(fishingScore(hitsRef.current));
  }, [session]);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, FISHING_DURATION_MS - (Date.now() - startedAt));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        window.clearInterval(timer);
        finish();
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [finish]);

  const catchFish = () => {
    if (session.locked || settledRef.current) return;
    const nextHits = hitsRef.current + 1;
    hitsRef.current = nextHits;
    setHits(nextHits);
    setTarget(randomTargetPosition(random));
  };

  return (
    <div className="mini-game mini-game-fishing" onClick={stopEvent}>
      <div className="mini-game-progress" aria-live="polite">
        <span><Fish size={16} aria-hidden="true" />抓到 {hits} 条</span>
        <span><Timer size={16} aria-hidden="true" />剩余 {(timeLeft / 1_000).toFixed(1)} 秒</span>
      </div>
      <div className="fishing-stage" role="group" aria-label="抓鱼干区域">
        <p className="game-helper-text">看准鱼干，点击它们</p>
        <button
          className="fishing-target"
          type="button"
          style={{ left: `${target.left}%`, top: `${target.top}%` }}
          disabled={session.locked}
          aria-label={`抓鱼干目标，已抓到 ${hits} 条`}
          onPointerDown={stopEvent}
          onMouseDown={stopEvent}
          onClick={(event) => { stopEvent(event); catchFish(); }}
        >
          <img src="./game/fish-target.png" alt="" aria-hidden="true" draggable="false" />
          <span className="sr-only">抓住</span>
        </button>
      </div>
    </div>
  );
}
