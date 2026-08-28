import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  advanceFrameByDelta,
  atlasFramePosition,
  normalizeAnimationDelta,
  type AnimationClock,
  type AnimationSpec,
} from "../shared/animation";

export type SpritePlaybackMode = "discrete" | "natural";

export interface SpriteNaturalMotion {
  amplitudeX?: number;
  amplitudeY?: number;
  rotationDeg?: number;
  scaleAmplitude?: number;
  periodMs?: number;
  phase?: number;
}

export interface SpriteAnimationSpec extends AnimationSpec {
  /** Number of physical frames in the source atlas when it differs from the playback sequence. */
  atlasFrames?: number;
  /** Optional logical-to-physical frame map. It never blends pixels between frames. */
  frameSequence?: readonly number[];
  playback?: SpritePlaybackMode;
  naturalMotion?: SpriteNaturalMotion;
}

export interface SpritePresentation {
  translateX: number;
  translateY: number;
  rotate: number;
  scale: number;
}

const IDENTITY_PRESENTATION: SpritePresentation = {
  translateX: 0,
  translateY: 0,
  rotate: 0,
  scale: 1,
};
const TAU = Math.PI * 2;
const DEFAULT_NATURAL_PERIOD_MS = 1_800;

function finiteAtLeastZero(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

/**
 * Creates a triangular, closed sequence. The first and last logical frames
 * are the same, so a looping action never jumps at its seam. Each item is a
 * real atlas frame; this deliberately does not interpolate image pixels.
 */
export function buildClosedFrameSequence(sourceFrameCount: number, playbackFrameCount: number): number[] {
  if (!Number.isInteger(sourceFrameCount) || sourceFrameCount <= 0) {
    throw new RangeError("Source frame count must be a positive integer");
  }
  if (!Number.isInteger(playbackFrameCount) || playbackFrameCount <= 0) {
    throw new RangeError("Playback frame count must be a positive integer");
  }
  if (sourceFrameCount === 1 || playbackFrameCount === 1) {
    return new Array(playbackFrameCount).fill(0);
  }

  return Array.from({ length: playbackFrameCount }, (_, index) => {
    const progress = index / (playbackFrameCount - 1);
    const travel = progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
    return Math.round(travel * (sourceFrameCount - 1));
  });
}

/** Resolve a logical player frame to one physical atlas frame. */
export function resolveSpriteAtlasFrame(spec: SpriteAnimationSpec, frame: number): number {
  if (!Number.isInteger(spec.frames) || spec.frames <= 0) {
    throw new RangeError("Playback frame count must be a positive integer");
  }
  if (!Number.isInteger(frame) || frame < 0 || frame >= spec.frames) {
    throw new RangeError(`Playback frame must be an integer between 0 and ${spec.frames - 1}`);
  }

  const atlasFrames = spec.atlasFrames ?? spec.frames;
  if (!Number.isInteger(atlasFrames) || atlasFrames <= 0) {
    throw new RangeError("Atlas frame count must be a positive integer");
  }
  if (spec.frameSequence && spec.frameSequence.length !== spec.frames) {
    throw new RangeError("Frame sequence length must match playback frame count");
  }

  const atlasFrame = spec.frameSequence?.[frame] ?? frame;
  if (!Number.isInteger(atlasFrame) || atlasFrame < 0 || atlasFrame >= atlasFrames) {
    throw new RangeError(`Atlas frame must be an integer between 0 and ${atlasFrames - 1}`);
  }
  return atlasFrame;
}

/**
 * Return a small compositor-friendly motion arc for natural actions. The
 * cosine envelope has zero velocity at both ends of the cycle, avoiding the
 * visible snap that a sawtooth or timer-based jump would introduce.
 */
export function naturalPresentationAt(
  profile: SpriteNaturalMotion = {},
  elapsedMs = 0,
): SpritePresentation {
  const periodMs = typeof profile.periodMs === "number" && Number.isFinite(profile.periodMs)
    ? Math.max(1, profile.periodMs)
    : DEFAULT_NATURAL_PERIOD_MS;
  const safeElapsed = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const cycleElapsed = ((safeElapsed % periodMs) + periodMs) % periodMs;
  const phase = cycleElapsed / periodMs * TAU + (Number.isFinite(profile.phase) ? profile.phase ?? 0 : 0);
  const lift = (1 - Math.cos(phase)) / 2;

  return {
    translateX: Math.sin(phase) * finiteAtLeastZero(profile.amplitudeX, 0),
    translateY: lift === 0 ? 0 : -lift * finiteAtLeastZero(profile.amplitudeY, 0),
    rotate: Math.sin(phase) * finiteAtLeastZero(profile.rotationDeg, 0),
    scale: 1 + lift * finiteAtLeastZero(profile.scaleAmplitude, 0),
  };
}

function composePresentationTransform(
  baseTransform: CSSProperties["transform"],
  presentation: SpritePresentation,
): string {
  const base = typeof baseTransform === "string" && baseTransform !== "none"
    ? `${baseTransform} `
    : "";
  return `${base}translate3d(${presentation.translateX.toFixed(3)}px, ${presentation.translateY.toFixed(3)}px, 0) rotate(${presentation.rotate.toFixed(3)}deg) scale(${presentation.scale.toFixed(5)})`;
}

export interface SpritePlayerProps {
  spec: SpriteAnimationSpec;
  frameRate: 30 | 60;
  paused?: boolean;
  onLoop?: () => void;
  onComplete?: () => void;
  className?: string;
  style?: CSSProperties;
}

export interface SpritePlayerControllerState {
  clock: AnimationClock;
  frame: number;
  completed: boolean;
}

export interface SpritePlayerTick extends SpritePlayerControllerState {
  frameChanged: boolean;
  presentationChanged: boolean;
  looped: boolean;
}

export interface SpritePlayerController {
  tick: (time: number) => SpritePlayerTick;
  state: () => SpritePlayerControllerState;
  presentation: () => SpritePresentation;
  setPaused: (paused: boolean) => void;
  setFrameRate: (frameRate: 30 | 60) => void;
  replaceSpec: (spec: SpriteAnimationSpec) => void;
}

interface SpritePlayerControllerOptions {
  onLoop?: () => void;
  onComplete?: () => void;
}

export function createSpritePlayerController(
  initialSpec: SpriteAnimationSpec,
  initialFrameRate: 30 | 60,
  options: SpritePlayerControllerOptions = {},
): SpritePlayerController {
  let spec = initialSpec;
  let frameRate = initialFrameRate;
  let clock: AnimationClock = { frame: 0, remainderMs: 0 };
  let frame = 0;
  let completed = false;
  let paused = false;
  let previousTime: number | null = null;
  let presentationElapsedMs = 0;
  let motionElapsedMs = 0;
  let currentPresentation = { ...IDENTITY_PRESENTATION };

  const reset = () => {
    clock = { frame: 0, remainderMs: 0 };
    frame = 0;
    completed = false;
    previousTime = null;
    presentationElapsedMs = 0;
    motionElapsedMs = 0;
    currentPresentation = { ...IDENTITY_PRESENTATION };
  };

  const state = (): SpritePlayerControllerState => ({
    clock: { ...clock },
    frame,
    completed,
  });

  const presentation = (): SpritePresentation => ({ ...currentPresentation });

  return {
    tick(time) {
      const beforeClock = clock;
      if (previousTime === null) {
        previousTime = Number.isFinite(time) ? time : 0;
        return { ...state(), frameChanged: false, presentationChanged: false, looped: false };
      }

      const elapsedMs = Number.isFinite(time) && Number.isFinite(previousTime)
        ? normalizeAnimationDelta(time - previousTime)
        : 0;
      previousTime = Number.isFinite(time) ? time : previousTime;
      if (paused || completed) {
        return { ...state(), frameChanged: false, presentationChanged: false, looped: false };
      }

      if (spec.playback === "natural") {
        motionElapsedMs += elapsedMs;
        currentPresentation = naturalPresentationAt(spec.naturalMotion, motionElapsedMs);
      } else {
        currentPresentation = { ...IDENTITY_PRESENTATION };
      }

      const result = advanceFrameByDelta(beforeClock, elapsedMs, spec);
      clock = result.clock;
      presentationElapsedMs += elapsedMs;
      let presentationChanged = false;

      if (result.looped && spec.loop === false) {
        completed = true;
        if (frame !== spec.frames - 1) {
          frame = spec.frames - 1;
          presentationChanged = true;
        }
        options.onComplete?.();
      } else {
        const presentationIntervalMs = 1000 / frameRate;
        if (presentationElapsedMs >= presentationIntervalMs - Number.EPSILON) {
          presentationElapsedMs %= presentationIntervalMs;
          if (spec.playback === "natural") presentationChanged = true;
          if (result.frameChanged && frame !== result.clock.frame) {
            frame = result.clock.frame;
            presentationChanged = true;
          }
        }
        if (result.looped) options.onLoop?.();
      }

      return {
        ...state(),
        frameChanged: result.frameChanged,
        presentationChanged,
        looped: result.looped,
      };
    },
    state,
    presentation,
    setPaused(nextPaused) {
      if (paused === nextPaused) return;
      paused = nextPaused;
      reset();
    },
    setFrameRate(nextFrameRate) {
      frameRate = nextFrameRate;
      presentationElapsedMs = 0;
    },
    replaceSpec(nextSpec) {
      spec = nextSpec;
      reset();
    },
  };
}

export function SpritePlayer({
  spec,
  frameRate,
  paused = false,
  onLoop,
  onComplete,
  className = "",
  style,
}: SpritePlayerProps) {
  const [frame, setFrame] = useState(0);
  const [presentation, setPresentation] = useState<SpritePresentation>(IDENTITY_PRESENTATION);
  const onLoopRef = useRef(onLoop);
  const onCompleteRef = useRef(onComplete);
  const controllerRef = useRef<SpritePlayerController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createSpritePlayerController(spec, frameRate, {
      onLoop: () => onLoopRef.current?.(),
      onComplete: () => onCompleteRef.current?.(),
    });
  }
  const controller = controllerRef.current;

  onLoopRef.current = onLoop;
  onCompleteRef.current = onComplete;

  useEffect(() => {
    controller.replaceSpec(spec);
    setFrame(controller.state().frame);
    setPresentation(controller.presentation());
  }, [spec]);

  useEffect(() => {
    controller.setFrameRate(frameRate);
    controller.setPaused(paused);
    setFrame(controller.state().frame);
    setPresentation(controller.presentation());
    if (paused) return undefined;

    let animationFrame = 0;
    const animate = (time: number) => {
      const result = controller.tick(time);
      if (result.presentationChanged) {
        setFrame(result.frame);
        setPresentation(controller.presentation());
      }
      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [controller, frameRate, paused, spec]);

  const displayFrame = paused ? 0 : Math.max(0, Math.min(frame, spec.frames - 1));
  const atlasFrame = resolveSpriteAtlasFrame(spec, displayFrame);
  const position = atlasFramePosition(
    { row: spec.row ?? 0, frames: spec.atlasFrames ?? spec.frames, columns: spec.columns ?? spec.atlasFrames ?? spec.frames },
    atlasFrame,
  );
  const frameWidth = typeof style?.width === "number" ? style.width : 0;
  const frameHeight = typeof style?.height === "number" ? style.height : 0;
  const presentationTransform = spec.playback === "natural"
    ? composePresentationTransform(style?.transform, paused ? IDENTITY_PRESENTATION : presentation)
    : style?.transform;
  return (
    <div
      className={className}
      aria-hidden="true"
      style={{
        ...style,
        backgroundPosition: `${-position.column * frameWidth}px ${-position.row * frameHeight}px`,
        ...(spec.playback === "natural" ? {
          transform: presentationTransform,
          willChange: style?.willChange ?? "background-position, transform",
        } : {}),
      }}
    />
  );
}
