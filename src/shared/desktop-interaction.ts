import type { DesktopBubble } from "./types";

export const DESKTOP_SESSION_DURATION_MS = 20_000;
export const DESKTOP_BUBBLE_MAX_HITS = 60;
export const DESKTOP_BUBBLE_MIN_RADIUS = 24;
export const DESKTOP_BUBBLE_MAX_RADIUS = 42;
export const DESKTOP_BUBBLE_MIN_SPEED = 45;
export const DESKTOP_BUBBLE_MAX_SPEED = 120;
export const DESKTOP_BUBBLE_MIN_RISE_SPEED = 70;
export const DESKTOP_BUBBLE_MAX_RISE_SPEED = 140;

export interface DesktopBubbleBounds {
  width: number;
  height: number;
}

export type RandomSource = () => number;

const unitRandom = (random: RandomSource): number => Math.min(1, Math.max(0, random()));
const range = (random: RandomSource, min: number, max: number): number => min + unitRandom(random) * (max - min);

export function createDesktopBubble(
  id: string,
  bounds: DesktopBubbleBounds,
  random: RandomSource,
  now: number,
): DesktopBubble {
  const radius = Math.round(range(random, DESKTOP_BUBBLE_MIN_RADIUS, DESKTOP_BUBBLE_MAX_RADIUS));
  const width = Math.max(0, bounds.width - radius * 2);
  const height = Math.max(0, bounds.height - radius * 2);
  const direction = unitRandom(random) >= 0.5 ? 1 : -1;
  const speed = range(random, DESKTOP_BUBBLE_MIN_SPEED, DESKTOP_BUBBLE_MAX_SPEED);
  const riseSpeed = range(random, DESKTOP_BUBBLE_MIN_RISE_SPEED, DESKTOP_BUBBLE_MAX_RISE_SPEED);

  return {
    id,
    x: radius + unitRandom(random) * width,
    y: radius + unitRandom(random) * height,
    vx: direction * speed,
    vy: -riseSpeed,
    radius,
    bornAt: now,
    expiresAt: now + DESKTOP_SESSION_DURATION_MS,
  };
}

export function advanceDesktopBubble(
  bubble: DesktopBubble,
  elapsedMs: number,
  bounds: DesktopBubbleBounds,
): DesktopBubble | null {
  if (elapsedMs >= bubble.expiresAt - bubble.bornAt) return null;

  const seconds = Math.max(0, elapsedMs) / 1_000;
  const minX = bubble.radius;
  const maxX = Math.max(minX, bounds.width - bubble.radius);
  const minY = bubble.radius;
  const maxY = Math.max(minY, bounds.height - bubble.radius);
  let x = bubble.x + bubble.vx * seconds;
  let y = bubble.y + bubble.vy * seconds;
  let vx = bubble.vx;
  let vy = bubble.vy;

  const reflect = (position: number, velocity: number, min: number, max: number): [number, number] => {
    if (min === max) return [min, 0];
    let nextPosition = position;
    let nextVelocity = velocity;
    while (nextPosition < min || nextPosition > max) {
      if (nextPosition > max) {
        nextPosition = max - (nextPosition - max);
        nextVelocity = -Math.abs(nextVelocity);
      } else {
        nextPosition = min + (min - nextPosition);
        nextVelocity = Math.abs(nextVelocity);
      }
    }
    return [nextPosition, nextVelocity];
  };

  [x, vx] = reflect(x, vx, minX, maxX);
  [y, vy] = reflect(y, vy, minY, maxY);
  return { ...bubble, x, y, vx, vy };
}

export function canHitDesktopBubble(
  status: { active: boolean; sessionId: string | null; startedAt: number | null; score: number },
  sessionId: string,
  bubbleId: string,
  now: number,
  hitIds: ReadonlySet<string>,
): boolean {
  return status.active
    && status.sessionId === sessionId
    && status.startedAt !== null
    && now >= status.startedAt
    && now < status.startedAt + DESKTOP_SESSION_DURATION_MS
    && status.score < DESKTOP_BUBBLE_MAX_HITS
    && !hitIds.has(bubbleId);
}
