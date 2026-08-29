import { useEffect, useMemo, useRef, useState } from "react";
import { Bath, BellRing, Fish, Heart, Moon, Sparkles, Utensils } from "lucide-react";
import {
  atlasFramePosition,
  parseLookAtlasMetadata,
  type LookAtlasMetadata,
} from "../shared/animation";
import {
  buildClosedFrameSequence,
  SpritePlayer,
  type SpriteAnimationSpec,
} from "./SpritePlayer";
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
import { findPetPackAsset, resolvePetAssetUrl } from "../pet-pack/runtime";
import { usePetPackRuntime } from "../useCompanion";
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

interface PetAnimationSpec extends SpriteAnimationSpec {
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

const NATURAL_ACTION_PLAYBACK_FRAMES = 30;
const NATURAL_BATH_SOURCE_FRAMES = STANDARD_ATLAS_FRAME_COUNTS[0];
const NATURAL_BATH_FRAME_SEQUENCE = buildClosedFrameSequence(
  NATURAL_BATH_SOURCE_FRAMES,
  NATURAL_ACTION_PLAYBACK_FRAMES,
);
const NATURAL_FEED_FRAME_SEQUENCE = buildClosedFrameSequence(30, NATURAL_ACTION_PLAYBACK_FRAMES);
const NATURAL_SLEEP_FRAME_SEQUENCE = buildClosedFrameSequence(30, NATURAL_ACTION_PLAYBACK_FRAMES);

// Keep the native fur palette and silhouette; the tiny compositor motion
// supplies a calm cue without an oversized generated prop.
const NATURAL_BATH_BASE_SPEC: PetAnimationSpec = {
  atlas: "standard",
  row: 0,
  frames: NATURAL_ACTION_PLAYBACK_FRAMES,
  atlasFrames: NATURAL_BATH_SOURCE_FRAMES,
  frameSequence: NATURAL_BATH_FRAME_SEQUENCE,
  fps: 4.8,
  columns: 8,
  atlasRows: 11,
  playback: "natural",
  naturalMotion: { amplitudeY: 0.35, rotationDeg: 0.05, scaleAmplitude: 0.001, periodMs: 1_800 },
};

// The cleaned native-colored lick row reads as feeding when replayed as a
// closed loop, without introducing the old warm/orange prop artwork.
const NATURAL_FEED_BASE_SPEC: PetAnimationSpec = {
  atlas: "idle",
  row: 0,
  frames: NATURAL_ACTION_PLAYBACK_FRAMES,
  atlasFrames: 30,
  frameSequence: NATURAL_FEED_FRAME_SEQUENCE,
  fps: 5.6,
  columns: 10,
  atlasRows: 9,
  playback: "natural",
  naturalMotion: { amplitudeY: 0.25, rotationDeg: 0.04, scaleAmplitude: 0.001, periodMs: 1_500 },
};

const CARE_MOTION_SPEC: Record<CareMotion, PetAnimationSpec> = {
  "care-bath": NATURAL_BATH_BASE_SPEC,
  "care-feed": NATURAL_FEED_BASE_SPEC,
};

const NATURAL_SLEEPING_SPEC: PetAnimationSpec = {
  atlas: "sleeping",
  row: 0,
  frames: NATURAL_ACTION_PLAYBACK_FRAMES,
  atlasFrames: 30,
  frameSequence: NATURAL_SLEEP_FRAME_SEQUENCE,
  fps: 3.8,
  columns: 10,
  atlasRows: 3,
  playback: "natural",
  naturalMotion: { amplitudeY: 0.35, scaleAmplitude: 0.006, periodMs: 3_200 },
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

// Keep the canonical fallback names explicit so older packaged renderers and
// asset-contract checks can still discover the built-in resources.
const ENHANCED_LOOK_METADATA_NAME = "look-96.json";
const ENHANCED_LOOK_ATLAS_NAME = "look-96.webp";
const ENHANCED_LOOK_ATLAS_FALLBACK = `./pet/${ENHANCED_LOOK_ATLAS_NAME}`;
const SLEEPING_ATLAS_FALLBACK = './pet/sleeping-30.webp';
const CARE_ATLAS_FALLBACK = './pet/care-actions-30.webp';

function runtimeLookMetadata(
  runtime: ReturnType<typeof usePetPackRuntime>,
  profile: PetProfile,
  fallback: LookAtlasMetadata,
): LookAtlasMetadata {
  const asset = findPetPackAsset(runtime, profile === "native" ? "native-look-atlas" : "enhanced-look-atlas");
  if (!asset || !asset.width || !asset.height || !asset.columns || !asset.rows || !asset.frameCount) return fallback;
  return {
    frameCount: asset.frameCount,
    columns: asset.columns,
    rows: asset.rows,
    frameWidth: Math.round(asset.width / asset.columns),
    frameHeight: Math.round(asset.height / asset.rows),
    stepDegrees: 360 / asset.frameCount,
  };
}

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
  const petPackRuntime = usePetPackRuntime();
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
    const fallback = runtimeLookMetadata(petPackRuntime, profile, LOOK_ATLAS_FALLBACKS[profile]);
    const metadataId = profile === "native" ? "native-look-metadata" : "enhanced-look-metadata";
    const metadataFallback = profile === "native" ? "./pet/native/look-16.json" : `./pet/${ENHANCED_LOOK_METADATA_NAME}`;
    const metadataUrl = resolvePetAssetUrl(petPackRuntime, metadataId, metadataFallback);
    let cancelled = false;
    setLookMetadata(fallback);
    if (metadataUrl.startsWith("file:")) return () => {
      cancelled = true;
    };
    void fetch(metadataUrl)
      .then((response) => response.ok ? response.json() as Promise<unknown> : null)
      .then((value) => {
        if (!cancelled && value) setLookMetadata(parseLookAtlasMetadata(value, fallback));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [petPackRuntime, settings.petProfile]);

  useEffect(() => {
    loopsRef.current = 0;
    settledRef.current = false;
    setSettled((value) => value ? false : value);
  }, [motion, state]);

  const animation = useMemo<PetAnimationSpec>(() => {
    if (motion?.startsWith("care-")) {
      return CARE_MOTION_SPEC[motion as CareMotion];
    }
    if (motion && !(settings.petProfile === "native" && motion.startsWith("idle-"))) {
      return MOTION_SPEC[motion as PetMotion];
    }
    if (settings.petProfile === "enhanced" && state === "sleeping") {
      return NATURAL_SLEEPING_SPEC;
    }
    if (settings.petProfile === "enhanced" && state === "bathing") {
      return CARE_MOTION_SPEC["care-bath"];
    }
    if (settings.petProfile === "enhanced" && state === "eating") {
      return CARE_MOTION_SPEC["care-feed"];
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
    const standardId = settings.petProfile === "native" ? "codex-spritesheet" : "enhanced-spritesheet";
    const standardFallback = settings.petProfile === "native" ? "./pet/native/spritesheet.webp" : "./pet/spritesheet.webp";
    const atlasUrl = animation.atlas === "idle"
      ? resolvePetAssetUrl(petPackRuntime, "idle-actions", "./pet/idle-actions-30.webp")
      : animation.atlas === "sleeping"
        ? resolvePetAssetUrl(petPackRuntime, "sleeping-actions", SLEEPING_ATLAS_FALLBACK)
        : animation.atlas === "care"
          ? resolvePetAssetUrl(petPackRuntime, "care-actions", CARE_ATLAS_FALLBACK)
          : resolvePetAssetUrl(petPackRuntime, standardId, standardFallback);
    return {
      width: dimensions.width,
      height: dimensions.height,
      backgroundImage: `url('${atlasUrl}')`,
      backgroundSize: `${size * animation.columns}px ${dimensions.height * animation.atlasRows}px`,
    };
  }, [animation, dimensions.height, dimensions.width, petPackRuntime, settings.petProfile, size]);

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

  const lookAssetId = settings.petProfile === "native" ? "native-look-atlas" : "enhanced-look-atlas";
  const lookFallbackUrl = settings.petProfile === "native" ? "./pet/native/look-16.webp" : ENHANCED_LOOK_ATLAS_FALLBACK;
  const lookLayerStyle = (index: number) => ({
    width: dimensions.width,
    height: dimensions.height,
    backgroundImage: `url('${resolvePetAssetUrl(petPackRuntime, lookAssetId, lookFallbackUrl)}')`,
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
            if (!motion && state !== "idle" && state !== "sleeping" && !settledRef.current && loopsRef.current >= 3) {
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
