export interface AnimationClock {
  frame: number;
  remainderMs: number;
}

export interface AtlasFrameSpec {
  row: number;
  frames: number;
  columns: number;
}

export interface AnimationSpec {
  frames: number;
  fps: number;
  atlas?: "standard" | "idle" | "sleeping" | "care";
  row?: number;
  columns?: number;
  atlasRows?: number;
  loop?: boolean;
}

export interface LookAtlasMetadata {
  frameCount: number;
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
  stepDegrees: number;
}

export type LookAtlasMetadataInput = Pick<
  LookAtlasMetadata,
  "frameCount" | "columns" | "frameWidth" | "frameHeight"
>;

const MAX_ELAPSED_MS = 250;

export function normalizeAnimationDelta(elapsedMs: number): number {
  return Number.isFinite(elapsedMs)
    ? Math.min(MAX_ELAPSED_MS, Math.max(0, elapsedMs))
    : 0;
}

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

function normalizeAnimationClock(clock: AnimationClock, frameCount: number): AnimationClock {
  return {
    frame: Number.isInteger(clock.frame) && clock.frame >= 0 && clock.frame < frameCount
      ? clock.frame
      : 0,
    remainderMs: Number.isFinite(clock.remainderMs) && clock.remainderMs >= 0 && clock.remainderMs < 1
      ? clock.remainderMs
      : 0,
  };
}

export function createLookAtlasMetadata(input: LookAtlasMetadataInput): LookAtlasMetadata {
  assertPositiveInteger(input.frameCount, "Look atlas frame count");
  assertPositiveInteger(input.columns, "Look atlas column count");
  assertPositiveInteger(input.frameWidth, "Look atlas frame width");
  assertPositiveInteger(input.frameHeight, "Look atlas frame height");

  return {
    ...input,
    rows: Math.ceil(input.frameCount / input.columns),
    stepDegrees: 360 / input.frameCount,
  };
}

export function parseLookAtlasMetadata(
  value: unknown,
  fallback: LookAtlasMetadata,
): LookAtlasMetadata {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fallback;
  const source = value as Record<string, unknown>;
  const frameCount = source.frameCount;
  const columns = source.columns;
  const frameWidth = source.frameWidth;
  const frameHeight = source.frameHeight;
  if (
    typeof frameCount !== "number"
    || typeof columns !== "number"
    || typeof frameWidth !== "number"
    || typeof frameHeight !== "number"
    || !Number.isInteger(frameCount)
    || !Number.isInteger(columns)
    || !Number.isInteger(frameWidth)
    || !Number.isInteger(frameHeight)
    || frameCount <= 0
    || columns <= 0
    || frameWidth <= 0
    || frameHeight <= 0
  ) {
    return fallback;
  }
  try {
    return createLookAtlasMetadata({ frameCount, columns, frameWidth, frameHeight });
  } catch {
    return fallback;
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

  const normalizedClock = normalizeAnimationClock(clock, frameCount);
  const safeElapsedMs = normalizeAnimationDelta(elapsedMs);
  const progress = normalizedClock.remainderMs + (safeElapsedMs * fps) / 1000;
  const frameAdvance = Math.floor(progress);
  const currentFrame = normalizedClock.frame;

  return {
    frame: (currentFrame + frameAdvance) % frameCount,
    remainderMs: progress - frameAdvance,
  };
}

export function advanceFrameByDelta(
  clock: AnimationClock,
  elapsedMs: number,
  spec: Pick<AnimationSpec, "frames" | "fps">,
): { clock: AnimationClock; frameChanged: boolean; looped: boolean } {
  assertPositiveFinite(spec.fps, "Animation fps");
  assertPositiveInteger(spec.frames, "Animation frame count");

  const normalizedClock = normalizeAnimationClock(clock, spec.frames);
  const safeElapsedMs = normalizeAnimationDelta(elapsedMs);
  const nextClock = advanceAnimationClock(normalizedClock, safeElapsedMs, spec.fps, spec.frames);
  const frameAdvance = Math.floor(normalizedClock.remainderMs + (safeElapsedMs * spec.fps) / 1000);
  const currentFrame = normalizedClock.frame;
  const frameChanged = nextClock.frame !== currentFrame;
  const looped = frameAdvance > 0 && currentFrame + frameAdvance >= spec.frames;
  return { clock: nextClock, frameChanged, looped };
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
