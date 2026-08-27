import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  advanceFrameByDelta,
  atlasFramePosition,
  normalizeAnimationDelta,
  type AnimationClock,
  type AnimationSpec,
} from "../shared/animation";

export interface SpritePlayerProps {
  spec: AnimationSpec;
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
  setPaused: (paused: boolean) => void;
  setFrameRate: (frameRate: 30 | 60) => void;
  replaceSpec: (spec: AnimationSpec) => void;
}

interface SpritePlayerControllerOptions {
  onLoop?: () => void;
  onComplete?: () => void;
}

export function createSpritePlayerController(
  initialSpec: AnimationSpec,
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

  const reset = () => {
    clock = { frame: 0, remainderMs: 0 };
    frame = 0;
    completed = false;
    previousTime = null;
    presentationElapsedMs = 0;
  };

  const state = (): SpritePlayerControllerState => ({
    clock: { ...clock },
    frame,
    completed,
  });

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
  }, [spec]);

  useEffect(() => {
    controller.setFrameRate(frameRate);
    controller.setPaused(paused);
    setFrame(controller.state().frame);
    if (paused) return undefined;

    let animationFrame = 0;
    const animate = (time: number) => {
      const result = controller.tick(time);
      if (result.presentationChanged) {
        setFrame(result.frame);
      }
      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [controller, frameRate, paused, spec]);

  const displayFrame = paused ? 0 : Math.max(0, Math.min(frame, spec.frames - 1));
  const position = atlasFramePosition(
    { row: spec.row ?? 0, frames: spec.frames, columns: spec.columns ?? spec.frames },
    displayFrame,
  );
  const frameWidth = typeof style?.width === "number" ? style.width : 0;
  const frameHeight = typeof style?.height === "number" ? style.height : 0;
  return (
    <div
      className={className}
      aria-hidden="true"
      style={{
        ...style,
        backgroundPosition: `${-position.column * frameWidth}px ${-position.row * frameHeight}px`,
      }}
    />
  );
}
