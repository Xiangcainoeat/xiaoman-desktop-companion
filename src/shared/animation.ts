export interface AnimationClock {
  frame: number;
  remainderMs: number;
}

export interface AtlasFrameSpec {
  row: number;
  frames: number;
  columns: number;
}

const MAX_ELAPSED_MS = 250;

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive number`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  assertPositiveFinite(value, name);
  if (!Number.isInteger(value)) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

export function advanceAnimationClock(
  clock: AnimationClock,
  elapsedMs: number,
  fps: number,
  frameCount: number,
): AnimationClock {
  assertPositiveFinite(fps, "Animation fps");
  assertPositiveInteger(frameCount, "Animation frame count");

  const safeElapsedMs = Number.isFinite(elapsedMs)
    ? Math.min(MAX_ELAPSED_MS, Math.max(0, elapsedMs))
    : 0;
  const remainder = Number.isFinite(clock.remainderMs) && clock.remainderMs >= 0
    ? clock.remainderMs
    : 0;
  const progress = remainder + (safeElapsedMs * fps) / 1000;
  const frameAdvance = Math.floor(progress);
  const currentFrame = Number.isInteger(clock.frame) ? clock.frame : 0;

  return {
    frame: (currentFrame + frameAdvance) % frameCount,
    remainderMs: progress - frameAdvance,
  };
}

export function atlasFramePosition(
  spec: AtlasFrameSpec,
  frame: number,
): { column: number; row: number } {
  assertPositiveInteger(spec.frames, "Atlas frame count");
  assertPositiveInteger(spec.columns, "Atlas column count");
  if (!Number.isInteger(spec.row) || spec.row < 0) {
    throw new RangeError("Atlas row must be a non-negative integer");
  }
  if (!Number.isInteger(frame) || frame < 0 || frame >= spec.frames) {
    throw new RangeError(`Animation frame must be an integer between 0 and ${spec.frames - 1}`);
  }

  return {
    column: frame % spec.columns,
    row: spec.row + Math.floor(frame / spec.columns),
  };
}
