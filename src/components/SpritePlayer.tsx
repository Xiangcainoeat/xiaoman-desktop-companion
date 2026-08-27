import { useEffect, useRef, useState, type CSSProperties } from "react";
import { advanceFrameByDelta, atlasFramePosition, type AnimationSpec } from "../shared/animation";

export interface SpritePlayerProps {
  spec: AnimationSpec;
  frameRate: 30 | 60;
  paused?: boolean;
  onLoop?: () => void;
  onComplete?: () => void;
  className?: string;
  style?: CSSProperties;
}

export function SpritePlayer({
  spec,
  frameRate: _frameRate,
  paused = false,
  onLoop,
  onComplete,
  className = "",
  style,
}: SpritePlayerProps) {
  const [frame, setFrame] = useState(0);
  const clockRef = useRef({ frame: 0, remainderMs: 0 });
  const completedRef = useRef(false);
  const onLoopRef = useRef(onLoop);
  const onCompleteRef = useRef(onComplete);

  onLoopRef.current = onLoop;
  onCompleteRef.current = onComplete;

  useEffect(() => {
    clockRef.current = { frame: 0, remainderMs: 0 };
    completedRef.current = false;
    setFrame(0);
  }, [spec]);

  useEffect(() => {
    if (paused) return undefined;

    let animationFrame = 0;
    let previousTime: number | null = null;
    const animate = (time: number) => {
      if (previousTime === null) {
        previousTime = time;
      } else {
        const result = advanceFrameByDelta(clockRef.current, time - previousTime, spec);
        previousTime = time;
        clockRef.current = result.clock;
        if (result.looped) {
          if (spec.loop === false) {
            if (!completedRef.current) {
              completedRef.current = true;
              setFrame(spec.frames - 1);
              onCompleteRef.current?.();
            }
          } else {
            onLoopRef.current?.();
          }
        } else if (result.frameChanged && !completedRef.current) {
          setFrame(result.clock.frame);
        }
      }
      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [paused, spec]);

  const position = atlasFramePosition(
    { row: spec.row ?? 0, frames: spec.frames, columns: spec.columns ?? spec.frames },
    frame,
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
