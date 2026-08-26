import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Fish, Heart, Moon, Sparkles, Utensils } from "lucide-react";
import { advanceAnimationClock, atlasFramePosition } from "../shared/animation";
import { STANDARD_ATLAS_FRAME_COUNTS } from "../shared/domain";
import {
  interpolateLookDirection,
  resolveGazeSmoothingMs,
  resolveGazeTarget,
  shouldTrackCursor,
  shortestAngleDelta,
  smoothAngle,
} from "../shared/gaze";
import { bridge } from "../useCompanion";
import type { AnimationClock } from "../shared/animation";
import type { CompanionSettings, PetMotion, PetState } from "../shared/types";

interface PetSpriteProps {
  state: PetState;
  settings: CompanionSettings;
  size?: number;
  className?: string;
  motion?: PetMotion | null;
  gazeSuppressed?: boolean;
  onGazeActivityChange?: (active: boolean) => void;
}

interface AnimationSpec {
  atlas: "standard" | "idle";
  row: number;
  frames: number;
  fps: number;
  columns: number;
  atlasRows: number;
}

const STATE_ROW: Record<PetState, number> = {
  idle: 0,
  working: 7,
  waiting: 6,
  ready: 8,
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

const MOTION_SPEC: Record<PetMotion, AnimationSpec> = {
  "running-right": { atlas: "standard", row: 1, frames: 8, fps: 7.4, columns: 8, atlasRows: 11 },
  "running-left": { atlas: "standard", row: 2, frames: 8, fps: 7.4, columns: 8, atlasRows: 11 },
  jumping: { atlas: "standard", row: 4, frames: 5, fps: 6.2, columns: 8, atlasRows: 11 },
  "idle-lick": { atlas: "idle", row: 0, frames: 30, fps: 5.6, columns: 10, atlasRows: 9 },
  "idle-blink": { atlas: "idle", row: 3, frames: 30, fps: 6.8, columns: 10, atlasRows: 9 },
  "idle-scratch": { atlas: "idle", row: 6, frames: 30, fps: 5.1, columns: 10, atlasRows: 9 },
};

const LOOK_STATES = new Set<PetState>(["idle", "working", "happy", "celebrating", "sleepy"]);

function MoodGlyph({ state }: { state: PetState }) {
  if (state === "hungry") return <Fish aria-hidden="true" />;
  if (state === "eating") return <Utensils aria-hidden="true" />;
  if (state === "affectionate" || state === "happy") return <Heart aria-hidden="true" />;
  if (state === "sleepy" || state === "sleeping") return <Moon aria-hidden="true" />;
  if (state === "reminder") return <BellRing aria-hidden="true" />;
  if (state === "celebrating" || state === "playful") return <Sparkles aria-hidden="true" />;
  return null;
}

export function PetSprite({
  state,
  settings,
  size = 240,
  className = "",
  motion = null,
  gazeSuppressed = false,
  onGazeActivityChange,
}: PetSpriteProps) {
  const [frame, setFrame] = useState(0);
  const [settled, setSettled] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [lookIndex, setLookIndex] = useState<number | null>(null);
  const animationClockRef = useRef<AnimationClock>({ frame: 0, remainderMs: 0 });
  const frameRef = useRef(0);
  const loopsRef = useRef(0);
  const settledRef = useRef(false);
  const animationRef = useRef<AnimationSpec | null>(null);
  const lookIndexRef = useRef<number | null>(null);
  const targetAngleRef = useRef(0);
  const currentAngleRef = useRef(0);
  const targetDistanceRef = useRef(0);
  const lastCursorPositionRef = useRef<{ x: number; y: number } | null>(null);
  const lastCursorMoveAtRef = useRef(0);
  const lookingRef = useRef(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    animationClockRef.current = { frame: 0, remainderMs: 0 };
    frameRef.current = 0;
    loopsRef.current = 0;
    settledRef.current = false;
    setFrame((value) => value === 0 ? value : 0);
    setSettled((value) => value ? false : value);
  }, [motion, state]);

  const animation = useMemo<AnimationSpec>(() => {
    if (motion) return MOTION_SPEC[motion];
    if (settled) {
      return {
        atlas: "standard",
        row: 0,
        frames: STANDARD_ATLAS_FRAME_COUNTS[0],
        fps: STATE_FPS.idle,
        columns: 8,
        atlasRows: 11,
      };
    }
    const row = STATE_ROW[state];
    return {
      atlas: "standard",
      row,
      frames: STANDARD_ATLAS_FRAME_COUNTS[row],
      fps: STATE_FPS[state],
      columns: 8,
      atlasRows: 11,
    };
  }, [motion, settled, state]);

  animationRef.current = animation;
  settledRef.current = settled;

  useEffect(() => {
    if (reducedMotion) {
      animationClockRef.current = { frame: 0, remainderMs: 0 };
      loopsRef.current = 0;
      if (frameRef.current !== 0) {
        frameRef.current = 0;
        setFrame(0);
      }
      return;
    }

    let animationFrame = 0;
    let previousTime: number | null = null;
    let previousTickTime: number | null = null;
    const animate = (time: number) => {
      if (previousTime === null) {
        previousTime = time;
        previousTickTime = time;
      } else if (time - (previousTickTime ?? time) >= 1000 / settings.animationFrameRate - 1) {
        const elapsed = time - previousTime;
        previousTime = time;
        previousTickTime = time;
        const spec = animationRef.current;
        if (spec) {
          const previousFrame = animationClockRef.current.frame;
          const nextClock = advanceAnimationClock(animationClockRef.current, elapsed, spec.fps, spec.frames);
          animationClockRef.current = nextClock;
          if (nextClock.frame !== previousFrame) {
            if (nextClock.frame === 0) {
              loopsRef.current += 1;
              if (!motion && state !== "idle" && !settledRef.current && loopsRef.current >= 3) {
                settledRef.current = true;
                setSettled(true);
              }
            }
            frameRef.current = nextClock.frame;
            setFrame(nextClock.frame);
          }
        }
      }
      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [motion, reducedMotion, settings.animationFrameRate, state]);

  const dimensions = useMemo(() => ({ width: size, height: Math.round((size * 208) / 192) }), [size]);
  const displayFrame = Math.max(0, Math.min(frame, animation.frames - 1));
  const framePosition = useMemo(
    () => atlasFramePosition(animation, displayFrame),
    [animation, displayFrame],
  );

  const baseSprite = useMemo(() => {
    return {
      width: dimensions.width,
      height: dimensions.height,
      backgroundImage: animation.atlas === "idle"
        ? "url('./pet/idle-actions-30.webp')"
        : "url('./pet/spritesheet.webp')",
      backgroundSize: `${size * animation.columns}px ${dimensions.height * animation.atlasRows}px`,
      backgroundPosition: `${-framePosition.column * size}px ${-framePosition.row * dimensions.height}px`,
      opacity: lookIndex === null ? 1 : 0,
    };
  }, [animation, dimensions.height, dimensions.width, framePosition, lookIndex, size]);

  useEffect(() => {
    const canLook = settings.gazeEnabled && !gazeSuppressed && !motion && !reducedMotion && LOOK_STATES.has(state);

    const setLooking = (active: boolean) => {
      const changed = lookingRef.current !== active;
      lookingRef.current = active;
      if (!active && lookIndexRef.current !== null) {
        lookIndexRef.current = null;
        setLookIndex(null);
      }
      if (changed) onGazeActivityChange?.(active);
    };

    const renderLook = (angle: number) => {
      const { first: firstIndex, second: secondIndex, blend } = interpolateLookDirection(angle, 16);
      const index = blend < 0.5 ? firstIndex : secondIndex;
      if (lookIndexRef.current !== index) {
        lookIndexRef.current = index;
        setLookIndex(index);
      }
      setLooking(true);
    };

    if (!canLook) {
      setLooking(false);
      currentAngleRef.current = 0;
      targetAngleRef.current = 0;
      lastCursorPositionRef.current = null;
      lastCursorMoveAtRef.current = 0;
      return;
    }

    const stopCursor = bridge.onCursor((payload) => {
      const now = performance.now();
      const previous = lastCursorPositionRef.current;
      if (!previous || Math.hypot(payload.x - previous.x, payload.y - previous.y) >= 0.9) {
        lastCursorMoveAtRef.current = now;
      }
      lastCursorPositionRef.current = { x: payload.x, y: payload.y };

      const centerX = payload.windowWidth / 2;
      const centerY = payload.windowHeight - dimensions.height * 0.61;
      const deltaX = payload.x - centerX;
      const deltaY = payload.y - centerY;
      targetDistanceRef.current = Math.hypot(deltaX, deltaY);
      const angle = (Math.atan2(deltaX, -deltaY) * 180) / Math.PI;
      targetAngleRef.current = resolveGazeTarget(angle, settings.gazeRange);
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
      const shouldTrack = shouldTrackCursor({
        now: time,
        lastMovedAt: lastCursorMoveAtRef.current,
        idleResetMs: settings.gazeIdleResetMs,
        distance: targetDistanceRef.current,
        deadzonePx: settings.gazeDeadzonePx,
        wasLooking: lookingRef.current,
      });
      const desiredAngle = shouldTrack ? targetAngleRef.current : 0;
      const lowerTarget = shouldTrack
        && settings.gazeRange === "full-360"
        && desiredAngle > 90
        && desiredAngle < 270;
      const smoothingPhase = shouldTrack
        ? (lowerTarget ? "lower-tracking" : "tracking")
        : "returning";
      currentAngleRef.current = smoothAngle(
        currentAngleRef.current,
        desiredAngle,
        elapsed,
        resolveGazeSmoothingMs(settings.gazeSmoothingMs, settings.gazeIdleResetMs, smoothingPhase),
      );

      if (shouldTrack) {
        renderLook(currentAngleRef.current);
      } else if (lookingRef.current) {
        if (Math.abs(shortestAngleDelta(currentAngleRef.current, 0)) <= 1.4) {
          currentAngleRef.current = 0;
          setLooking(false);
        } else {
          renderLook(currentAngleRef.current);
        }
      }
      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => {
      stopCursor();
      cancelAnimationFrame(animationFrame);
      setLooking(false);
    };
  }, [
    dimensions.height,
    gazeSuppressed,
    motion,
    onGazeActivityChange,
    reducedMotion,
    settings.gazeDeadzonePx,
    settings.gazeEnabled,
    settings.gazeFrameRate,
    settings.gazeIdleResetMs,
    settings.gazeRange,
    settings.gazeSmoothingMs,
    size,
    state,
  ]);

  const lookLayerStyle = useMemo(() => ({
    width: dimensions.width,
    height: dimensions.height,
    backgroundImage: "url('./pet/look-16.webp')",
    backgroundSize: `${size * 8}px ${dimensions.height * 2}px`,
    backgroundPosition: lookIndex === null
      ? "0px 0px"
      : `${-(lookIndex % 8) * size}px ${-Math.floor(lookIndex / 8) * dimensions.height}px`,
    opacity: lookIndex === null ? 0 : 1,
  }), [dimensions.height, dimensions.width, lookIndex, size]);

  const decorated = ["hungry", "eating", "happy", "affectionate", "sleepy", "sleeping", "playful", "celebrating", "reminder"].includes(state);

  return (
    <div
      className={`pet-sprite-wrap state-${state} ${motion ? `motion-${motion}` : ""} ${className}`}
      style={{ width: dimensions.width, height: dimensions.height }}
      role="img"
      aria-label={`小满：${state}`}
    >
      <div className="pet-sprite pet-sprite-base" style={baseSprite} aria-hidden="true" />
      <div className="pet-sprite pet-look-layer" style={lookLayerStyle} aria-hidden="true" />
      {decorated && (
        <span className="pet-mood-glyph">
          <MoodGlyph state={state} />
        </span>
      )}
      {state === "sleeping" && <span className="sleep-drift">z z</span>}
    </div>
  );
}
