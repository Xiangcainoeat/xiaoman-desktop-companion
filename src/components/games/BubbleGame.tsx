import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameSession } from "../GameShell";

export const BUBBLE_DURATION_MS = 20_000;
export const BUBBLE_COUNT = 5;

export interface BubbleTarget {
  id: number;
  left: number;
  top: number;
  size: number;
  points: number;
}

function unitRandom(random: () => number): number {
  const value = random();
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

export function createBubble(id: number, random: () => number = Math.random): BubbleTarget {
  const left = 8 + unitRandom(random) * 84;
  const top = 10 + unitRandom(random) * 74;
  const size = 48 + unitRandom(random) * 32;
  const points = 1 + Math.floor(unitRandom(random) * 3);
  return { id, left, top, size, points };
}

export function bubbleScore(points: number): number {
  if (!Number.isFinite(points)) return 0;
  return Math.round(Math.max(0, Math.min(100, points * 5)));
}

function stopEvent(event: React.SyntheticEvent) {
  event.stopPropagation();
}

export function BubbleGame({ session, random = Math.random }: { session: GameSession; random?: () => number }) {
  const nextIdRef = useRef(BUBBLE_COUNT);
  const [bubbles, setBubbles] = useState<BubbleTarget[]>(() => (
    Array.from({ length: BUBBLE_COUNT }, (_, index) => createBubble(index, random))
  ));
  const [points, setPoints] = useState(0);
  const pointsRef = useRef(0);
  const [timeLeft, setTimeLeft] = useState(BUBBLE_DURATION_MS);
  const settledRef = useRef(false);

  const finish = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    session.finish(bubbleScore(pointsRef.current));
  }, [session]);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, BUBBLE_DURATION_MS - (Date.now() - startedAt));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        window.clearInterval(timer);
        finish();
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [finish]);

  const popBubble = (bubble: BubbleTarget) => {
    if (session.locked || settledRef.current) return;
    const nextPoints = pointsRef.current + bubble.points;
    pointsRef.current = nextPoints;
    setPoints(nextPoints);
    const nextId = nextIdRef.current;
    nextIdRef.current += 1;
    setBubbles((current) => current.map((item) => item.id === bubble.id ? createBubble(nextId, random) : item));
  };

  return (
    <div className="mini-game mini-game-bubbles" onClick={stopEvent}>
      <div className="mini-game-progress" aria-live="polite">
        <span><Sparkles size={16} aria-hidden="true" />泡泡分数 {points}</span>
        <span>剩余 {(timeLeft / 1_000).toFixed(1)} 秒</span>
      </div>
      <div className="bubble-stage" role="group" aria-label="射泡泡区域">
        <p className="game-helper-text">点击泡泡，特殊泡泡分数更高</p>
        {bubbles.map((bubble) => (
          <button
            key={bubble.id}
            className={`bubble-target bubble-points-${bubble.points}`}
            type="button"
            style={{ left: `${bubble.left}%`, top: `${bubble.top}%`, width: `${bubble.size}px`, height: `${bubble.size}px` }}
            disabled={session.locked}
            aria-label={`泡泡，点击获得 ${bubble.points} 分`}
            onPointerDown={stopEvent}
            onMouseDown={stopEvent}
            onClick={(event) => { stopEvent(event); popBubble(bubble); }}
          >
            <img src="./game/bubble-target.png" alt="" aria-hidden="true" draggable="false" />
            <span aria-hidden="true">{bubble.points}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
