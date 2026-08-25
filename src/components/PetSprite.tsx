import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Fish, Heart, Moon, Sparkles, Utensils } from "lucide-react";
import { STANDARD_ATLAS_FRAME_COUNTS } from "../shared/domain";
import { bridge } from "../useCompanion";
import type { CompanionSettings, PetState } from "../shared/types";

interface PetSpriteProps {
  state: PetState;
  settings: CompanionSettings;
  size?: number;
  className?: string;
}

const STATE_ROW: Record<PetState, number> = {
  idle: 0,
  working: 7,
  waiting: 6,
  ready: 3,
  failed: 5,
  hungry: 6,
  eating: 0,
  happy: 3,
  affectionate: 8,
  sleepy: 0,
  sleeping: 0,
  playful: 4,
  startled: 4,
  celebrating: 3,
  focused: 8,
  reminder: 6,
};

const STATE_FPS: Record<PetState, number> = {
  idle: 2.2,
  working: 5.8,
  waiting: 2.4,
  ready: 4.5,
  failed: 2.2,
  hungry: 1.8,
  eating: 3.4,
  happy: 4.2,
  affectionate: 2.8,
  sleepy: 1.1,
  sleeping: 0.65,
  playful: 5.5,
  startled: 5.2,
  celebrating: 4.8,
  focused: 3.4,
  reminder: 2.8,
};

const LOOK_STATES = new Set<PetState>(["idle", "focused", "happy", "affectionate", "hungry", "sleepy"]);

function normalizeAngle(value: number): number {
  return ((value % 360) + 360) % 360;
}

function shortestAngle(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function MoodGlyph({ state }: { state: PetState }) {
  if (state === "hungry") return <Fish aria-hidden="true" />;
  if (state === "eating") return <Utensils aria-hidden="true" />;
  if (state === "affectionate" || state === "happy") return <Heart aria-hidden="true" />;
  if (state === "sleepy" || state === "sleeping") return <Moon aria-hidden="true" />;
  if (state === "reminder") return <BellRing aria-hidden="true" />;
  if (state === "celebrating" || state === "playful") return <Sparkles aria-hidden="true" />;
  return null;
}

export function PetSprite({ state, settings, size = 240, className = "" }: PetSpriteProps) {
  const [frame, setFrame] = useState(0);
  const [lookDirection, setLookDirection] = useState<number | null>(null);
  const targetAngleRef = useRef(0);
  const currentAngleRef = useRef(0);
  const targetDistanceRef = useRef(0);
  const lookDirectionRef = useRef<number | null>(null);
  const initializedAngleRef = useRef(false);
  const standardFrameCount = STANDARD_ATLAS_FRAME_COUNTS[STATE_ROW[state]];

  useEffect(() => {
    setFrame(0);
    const interval = window.setInterval(
      () => setFrame((value) => (value + 1) % standardFrameCount),
      1000 / STATE_FPS[state],
    );
    return () => window.clearInterval(interval);
  }, [standardFrameCount, state]);

  useEffect(() => {
    if (!settings.gazeEnabled || !LOOK_STATES.has(state)) {
      lookDirectionRef.current = null;
      setLookDirection(null);
      return;
    }

    const stopCursor = bridge.onCursor((payload) => {
      const centerX = payload.windowWidth / 2;
      const centerY = payload.windowHeight * 0.67;
      const deltaX = payload.x - centerX;
      const deltaY = payload.y - centerY;
      targetDistanceRef.current = Math.hypot(deltaX, deltaY);
      targetAngleRef.current = normalizeAngle((Math.atan2(deltaX, -deltaY) * 180) / Math.PI);
    });

    let animationFrame = 0;
    let previousTime = performance.now();
    let previousRenderTime = previousTime;
    const animate = (time: number) => {
      const frameInterval = 1000 / settings.gazeFrameRate;
      if (time - previousRenderTime < frameInterval - 1) {
        animationFrame = requestAnimationFrame(animate);
        return;
      }
      const elapsed = Math.min(50, Math.max(1, time - previousTime));
      previousTime = time;
      previousRenderTime = time;
      const enterDistance = settings.gazeDeadzonePx + 12;
      const leaveDistance = settings.gazeDeadzonePx;
      const wasLooking = lookDirectionRef.current !== null;
      const shouldLook = wasLooking ? targetDistanceRef.current > leaveDistance : targetDistanceRef.current > enterDistance;

      if (!shouldLook) {
        if (wasLooking) {
          lookDirectionRef.current = null;
          setLookDirection(null);
        }
      } else {
        if (!initializedAngleRef.current) {
          currentAngleRef.current = targetAngleRef.current;
          initializedAngleRef.current = true;
        } else {
          const alpha = 1 - Math.exp(-elapsed / settings.gazeSmoothingMs);
          currentAngleRef.current = normalizeAngle(
            currentAngleRef.current + shortestAngle(currentAngleRef.current, targetAngleRef.current) * alpha,
          );
        }

        const previousDirection = lookDirectionRef.current;
        let nextDirection = previousDirection;
        if (nextDirection === null) {
          nextDirection = Math.round(currentAngleRef.current / 11.25) % 32;
        } else {
          const center = nextDirection * 11.25;
          if (Math.abs(shortestAngle(center, currentAngleRef.current)) > 8.25) {
            nextDirection = Math.round(currentAngleRef.current / 11.25) % 32;
          }
        }
        if (nextDirection !== previousDirection) {
          lookDirectionRef.current = nextDirection;
          setLookDirection(nextDirection);
        }
      }
      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => {
      stopCursor();
      cancelAnimationFrame(animationFrame);
    };
  }, [settings.gazeDeadzonePx, settings.gazeEnabled, settings.gazeFrameRate, settings.gazeSmoothingMs, state]);

  const sprite = useMemo(() => {
    const height = Math.round((size * 208) / 192);
    let row = STATE_ROW[state];
    let column = frame;
    let backgroundImage = "url('./pet/spritesheet.webp')";
    let atlasRows = 11;
    if (lookDirection !== null && LOOK_STATES.has(state)) {
      backgroundImage = "url('./pet/look-32.webp')";
      atlasRows = 4;
      row = Math.floor(lookDirection / 8);
      column = lookDirection % 8;
    }
    return {
      width: size,
      height,
      backgroundImage,
      backgroundSize: `${size * 8}px ${height * atlasRows}px`,
      backgroundPosition: `${-column * size}px ${-row * height}px`,
    };
  }, [frame, lookDirection, size, state]);

  const decorated = ["hungry", "eating", "happy", "affectionate", "sleepy", "sleeping", "playful", "celebrating", "reminder"].includes(state);

  return (
    <div className={`pet-sprite-wrap state-${state} ${className}`} style={{ width: sprite.width, height: sprite.height }}>
      <div className="pet-sprite" style={sprite} role="img" aria-label={`小满：${state}`} />
      {decorated && (
        <span className="pet-mood-glyph">
          <MoodGlyph state={state} />
        </span>
      )}
      {state === "sleeping" && <span className="sleep-drift">z z</span>}
    </div>
  );
}
