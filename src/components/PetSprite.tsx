import { useEffect, useMemo, useRef, useState } from "react";
import { Bath, BellRing, Fish, Heart, Moon, Sparkles, Utensils } from "lucide-react";
import {
  atlasFramePosition,
  parseLookAtlasMetadata,
  type LookAtlasMetadata,
} from "../shared/animation";
import { SpritePlayer } from "./SpritePlayer";
import { STANDARD_ATLAS_FRAME_COUNTS } from "../shared/domain";
import { HOVER_JUMP_FPS, HOVER_JUMP_FRAME_COUNT } from "../shared/motion";
import {
  resolveGazeTarget,
  resolveCursorSpeedPxPerSecond,
  resolveVelocityResponsiveGazeSmoothingMs,
  selectLookDirection,
  shouldTrackCursor,
  shortestAngleDelta,
  smoothAngle,
} from "../shared/gaze";
import { bridge } from "../useCompanion";
import type { AnimationSpec } from "../shared/animation";
import type { CursorPositionSample } from "../shared/gaze";
import type { CompanionSettings, PetMotion, PetProfile, PetState } from "../shared/types";

export type CareMotion = "care-bath" | "care-feed";
export type PetSpriteMotion = PetMotion | CareMotion;
export type PetSpriteState = PetState | "bathing";

interface PetSpriteProps {
  state: PetSpriteState;
  settings: CompanionSettings;
  size?: number;
  className?: string;
  motion?: PetSpriteMotion | null;
  gazeSuppressed?: boolean;
  onGazeActivityChange?: (active: boolean) => void;
}

interface PetAnimationSpec extends AnimationSpec {
  atlas: "standard" | "idle" | "sleeping" | "care";
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
  dirty: 6,
  eating: 0,
  bathing: 0,
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
  dirty: 1.5,
  eating: 3.4,
  bathing: 5.2,
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

const MOTION_SPEC: Record<PetMotion, PetAnimationSpec> = {
  "running-right": { atlas: "standard", row: 1, frames: 8, fps: 7.4, columns: 8, atlasRows: 11 },
  "running-left": { atlas: "standard", row: 2, frames: 8, fps: 7.4, columns: 8, atlasRows: 11 },
  jumping: {
    atlas: "standard",
    row: 4,
    frames: HOVER_JUMP_FRAME_COUNT,
    fps: HOVER_JUMP_FPS,
    columns: 8,
    atlasRows: 11,
  },
  "idle-lick": { atlas: "idle", row: 0, frames: 30, fps: 5.6, columns: 10, atlasRows: 9 },
  "idle-blink": { atlas: "idle", row: 3, frames: 30, fps: 6.8, columns: 10, atlasRows: 9 },
  "idle-scratch": { atlas: "idle", row: 6, frames: 30, fps: 5.1, columns: 10, atlasRows: 9 },
};

const CARE_MOTION_SPEC: Record<CareMotion, PetAnimationSpec> = {
  "care-bath": { atlas: "care", row: 0, frames: 30, fps: 5.2, columns: 10, atlasRows: 6 },
  "care-feed": { atlas: "care", row: 3, frames: 30, fps: 5.2, columns: 10, atlasRows: 6 },
};

const LOOK_STATES = new Set<PetState>(["idle", "working", "happy", "celebrating", "sleepy"]);

const LOOK_ATLAS_FALLBACKS: Record<PetProfile, LookAtlasMetadata> = {
  enhanced: {
    frameCount: 96,
    columns: 12,
    rows: 8,
    frameWidth: 192,
    frameHeight: 208,
    stepDegrees: 3.75,
  },
  native: {
    frameCount: 16,
    columns: 8,
    rows: 2,
    frameWidth: 192,
    frameHeight: 208,
    stepDegrees: 22.5,
  },
};

function MoodGlyph({ state }: { state: PetSpriteState }) {
  if (state === "hungry") return <Fish aria-hidden="true" />;
  if (state === "dirty") return <Bath aria-hidden="true" />;
  if (state === "eating") return <Utensils aria-hidden="true" />;
  if (state === "bathing") return <Sparkles aria-hidden="true" />;
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
  const [settled, setSettled] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [lookIndex, setLookIndex] = useState<number | null>(null);
  const [lookMetadata, setLookMetadata] = useState<LookAtlasMetadata>(
    () => LOOK_ATLAS_FALLBACKS[settings.petProfile],
  );
  const loopsRef = useRef(0);
  const settledRef = useRef(false);
  const lookIndexRef = useRef<number | null>(null);
  const targetAngleRef = useRef(0);
  const currentAngleRef = useRef(0);
  const targetDistanceRef = useRef(0);
  const lastCursorPositionRef = useRef<CursorPositionSample | null>(null);
  const cursorSpeedRef = useRef(0);
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
    const profile = settings.petProfile;
    const fallback = LOOK_ATLAS_FALLBACKS[profile];
    const root = profile === "native" ? "./pet/native" : "./pet";
    const metadataName = profile === "native" ? "look-16.json" : "look-96.json";
    let cancelled = false;
    setLookMetadata(fallback);
    void fetch(`${root}/${metadataName}`)
      .then((response) => response.ok ? response.json() as Promise<unknown> : null)
      .then((value) => {
        if (!cancelled && value) setLookMetadata(parseLookAtlasMetadata(value, fallback));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [settings.petProfile]);

  useEffect(() => {
    loopsRef.current = 0;
    settledRef.current = false;
    setSettled((value) => value ? false : value);
  }, [motion, state]);

  const animation = useMemo<PetAnimationSpec>(() => {
    if (motion && !(settings.petProfile === "native" && (motion.startsWith("idle-") || motion.startsWith("care-")))) {
      return motion.startsWith("care-")
        ? CARE_MOTION_SPEC[motion as CareMotion]
        : MOTION_SPEC[motion as PetMotion];
    }
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
    if (settings.petProfile === "native" && motion === "care-bath") {
      return { atlas: "standard", row: 0, frames: STANDARD_ATLAS_FRAME_COUNTS[0], fps: 3.4, columns: 8, atlasRows: 11 };
    }
    if (settings.petProfile === "enhanced" && state === "sleeping") {
      return { atlas: "sleeping", row: 0, frames: 30, fps: 5.2, columns: 10, atlasRows: 3 };
    }
    if (settings.petProfile === "enhanced" && state === "bathing") {
      return CARE_MOTION_SPEC["care-bath"];
    }
    if (settings.petProfile === "enhanced" && state === "eating") {
      return CARE_MOTION_SPEC["care-feed"];
    }
    const row = STATE_ROW[state as PetState];
    return {
      atlas: "standard",
      row,
      frames: STANDARD_ATLAS_FRAME_COUNTS[row],
      fps: STATE_FPS[state as PetState],
      columns: 8,
      atlasRows: 11,
    };
  }, [motion, settled, settings.petProfile, state]);

  settledRef.current = settled;

  const dimensions = useMemo(
    () => ({ width: size, height: Math.round((size * lookMetadata.frameHeight) / lookMetadata.frameWidth) }),
    [lookMetadata.frameHeight, lookMetadata.frameWidth, size],
  );
  const baseSprite = useMemo(() => {
    const root = settings.petProfile === "native" ? "./pet/native" : "./pet";
    return {
      width: dimensions.width,
      height: dimensions.height,
      backgroundImage: animation.atlas === "idle"
        ? "url('./pet/idle-actions-30.webp')"
        : animation.atlas === "sleeping"
          ? "url('./pet/sleeping-30.webp')"
          : animation.atlas === "care"
            ? "url('./pet/care-actions-30.webp')"
            : `url('${root}/spritesheet.webp')`,
      backgroundSize: `${size * animation.columns}px ${dimensions.height * animation.atlasRows}px`,
    };
  }, [animation, dimensions.height, dimensions.width, settings.petProfile, size]);

  useEffect(() => {
    const canLook = settings.gazeEnabled
      && !gazeSuppressed
      && !motion
      && !reducedMotion
      && state !== "bathing"
      && LOOK_STATES.has(state);

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
      const index = selectLookDirection(
        angle,
        lookMetadata.frameCount,
        lookIndexRef.current ?? undefined,
        0.8,
      );
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
      cursorSpeedRef.current = 0;
      lastCursorMoveAtRef.current = 0;
      return;
    }

    const stopCursor = bridge.onCursor((payload) => {
      const now = performance.now();
      const previous = lastCursorPositionRef.current;
      const sample: CursorPositionSample = { x: payload.x, y: payload.y, at: now };
      const instantaneousSpeed = resolveCursorSpeedPxPerSecond(previous, sample);
      if (!previous || Math.hypot(payload.x - previous.x, payload.y - previous.y) >= 0.9) {
        lastCursorMoveAtRef.current = now;
      }
      lastCursorPositionRef.current = sample;
      cursorSpeedRef.current = previous
        ? cursorSpeedRef.current + (instantaneousSpeed - cursorSpeedRef.current) * 0.55
        : 0;

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
      const cursorAge = lastCursorMoveAtRef.current > 0
        ? Math.max(0, time - lastCursorMoveAtRef.current)
        : Number.POSITIVE_INFINITY;
      const velocity = shouldTrack
        ? cursorSpeedRef.current * Math.exp(-Math.min(cursorAge, 800) / 140)
        : 0;
      currentAngleRef.current = smoothAngle(
        currentAngleRef.current,
        desiredAngle,
        elapsed,
        resolveVelocityResponsiveGazeSmoothingMs(
          settings.gazeSmoothingMs,
          settings.gazeIdleResetMs,
          smoothingPhase,
          velocity,
        ),
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
    lookMetadata.frameCount,
    size,
    state,
  ]);

  const lookAssetRoot = settings.petProfile === "native" ? "./pet/native" : "./pet";
  const lookAssetName = settings.petProfile === "native" ? "look-16.webp" : "look-96.webp";
  const lookLayerStyle = (index: number, assetName = lookAssetName) => ({
    width: dimensions.width,
    height: dimensions.height,
    backgroundImage: `url('${lookAssetRoot}/${assetName}')`,
    backgroundSize: `${size * lookMetadata.columns}px ${dimensions.height * lookMetadata.rows}px`,
    backgroundPosition: `${-(index % lookMetadata.columns) * size}px ${-Math.floor(index / lookMetadata.columns) * dimensions.height}px`,
  });

  const decorated = ["hungry", "dirty", "eating", "bathing", "happy", "affectionate", "sleepy", "sleeping", "playful", "celebrating", "reminder"].includes(state);

  return (
    <div
      className={`pet-sprite-wrap state-${state} ${motion ? `motion-${motion}` : ""} ${className}`}
      style={{ width: dimensions.width, height: dimensions.height }}
      role="img"
      aria-label={`小满：${state}`}
    >
      {lookIndex === null ? (
        <SpritePlayer
          className="pet-sprite pet-sprite-base"
          spec={animation}
          frameRate={settings.animationFrameRate}
          paused={reducedMotion}
          onLoop={() => {
            loopsRef.current += 1;
            if (!motion && state !== "idle" && !settledRef.current && loopsRef.current >= 3) {
              settledRef.current = true;
              setSettled(true);
            }
          }}
          style={baseSprite}
        />
      ) : (
        <div
          className="pet-sprite pet-look-layer"
          style={lookLayerStyle(lookIndex)}
          aria-hidden="true"
        />
      )}
      {decorated && (
        <span className="pet-mood-glyph">
          <MoodGlyph state={state} />
        </span>
      )}
      {state === "sleeping" && <span className="sleep-drift">z z</span>}
    </div>
  );
}
