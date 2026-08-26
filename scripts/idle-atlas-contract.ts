export const IDLE_ATLAS_ACTIONS = ["idle-lick", "idle-blink", "idle-scratch"] as const;
export const IDLE_ATLAS_COLUMNS = 10;
export const IDLE_ATLAS_ROWS = 9;
export const IDLE_ATLAS_FRAMES_PER_ACTION = 30;
export const IDLE_ATLAS_EDGE_CONTAMINATION_LIMIT = 4;
export const IDLE_ATLAS_RED_PINK_EDGE_LIMIT = 4;
export const IDLE_ATLAS_COLOR_DRIFT_LIMIT = 22;
export const IDLE_ATLAS_AREA_JUMP_LIMIT = 0.45;

interface ReportRecord {
  [key: string]: unknown;
}

function record(value: unknown): ReportRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ReportRecord
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function validateIdleAtlasReport(report: unknown): { ok: boolean; errors: string[] } {
  const root = record(report);
  const errors: string[] = [];
  if (!root) return { ok: false, errors: ["report must be an object"] };

  if ("grid" in root) errors.push("legacy grid field is not allowed");
  if (root.columns !== IDLE_ATLAS_COLUMNS) errors.push(`atlas must have ${IDLE_ATLAS_COLUMNS} columns`);
  if (root.rows !== IDLE_ATLAS_ROWS) errors.push(`atlas must have ${IDLE_ATLAS_ROWS} rows`);

  const actions = record(root.actions);
  for (const action of IDLE_ATLAS_ACTIONS) {
    const summary = record(actions?.[action]);
    if (!summary) {
      errors.push(`${action} report is missing`);
      continue;
    }
    if (summary.frames !== IDLE_ATLAS_FRAMES_PER_ACTION) {
      errors.push(`${action} must contain ${IDLE_ATLAS_FRAMES_PER_ACTION} frames`);
    }
    const emptyFrames = finiteNumber(summary.emptyFrames);
    if (emptyFrames === null || emptyFrames > 0) errors.push(`${action} contains empty frames`);
    const hiddenRgbPixels = finiteNumber(summary.hiddenRgbPixels);
    if (hiddenRgbPixels === null || hiddenRgbPixels > 0) errors.push(`${action} contains hidden RGB pixels`);
    const contaminatedEdgePixels = finiteNumber(summary.contaminatedEdgePixels);
    if (
      contaminatedEdgePixels === null
      || contaminatedEdgePixels > IDLE_ATLAS_EDGE_CONTAMINATION_LIMIT
    ) {
      errors.push(`${action} exceeds the edge contamination limit`);
    }

    const redPinkEdgePixels = finiteNumber(summary.redPinkEdgePixels);
    if (redPinkEdgePixels === null || redPinkEdgePixels > IDLE_ATLAS_RED_PINK_EDGE_LIMIT) {
      errors.push(`${action} exceeds the red/pink edge limit`);
    }
    const maxColorDrift = finiteNumber(summary.maxColorDrift);
    if (maxColorDrift === null || maxColorDrift > IDLE_ATLAS_COLOR_DRIFT_LIMIT) {
      errors.push(`${action} exceeds the color drift limit`);
    }

    const registration = record(summary.registration);
    const scale = finiteNumber(registration?.scale);
    const sharedScale = registration?.sharedScale;
    const areaJump = finiteNumber(registration?.maxAdjacentAreaDeltaRatio);
    if (
      scale === null || scale <= 0
      || sharedScale !== true
      || areaJump === null || areaJump > IDLE_ATLAS_AREA_JUMP_LIMIT
    ) {
      errors.push(`${action} exceeds the registration continuity limit`);
    }
    if (!registration) errors.push(`${action} is missing continuity metrics`);
    if (redPinkEdgePixels === null || maxColorDrift === null) {
      errors.push(`${action} is missing color metrics`);
    }
  }

  return { ok: errors.length === 0, errors };
}
