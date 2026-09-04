import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateIdleAtlasReport } from "../scripts/idle-atlas-contract";

const realReport = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/idle-actions-30-report.json"), "utf8"));

const cleanActionMetrics = {
  frames: 30,
  emptyFrames: 0,
  hiddenRgbPixels: 0,
  contaminatedEdgePixels: 0,
  redPinkEdgePixels: 0,
  backgroundHolePixelsRemoved: 1,
  maxColorDrift: 8,
  registration: {
    scale: 0.84,
    sharedScale: true,
    neutralSubjectSize: [124, 178],
    maxAdjacentAreaDeltaRatio: 0.2,
    maxAdjacentCenterDelta: 4,
    maxAdjacentBottomDelta: 4,
  },
};

describe("30-frame idle atlas contract", () => {
  it("accepts a complete clean 10x9 report", () => {
    expect(validateIdleAtlasReport({
      columns: 10,
      rows: 9,
      backgroundHolePixelsRemoved: 3,
      regressions: {
        enclosedBackgroundHoleRemoved: true,
        enclosedGreenPixelPreserved: true,
      },
      actions: {
        "idle-lick": cleanActionMetrics,
        "idle-blink": { ...cleanActionMetrics, contaminatedEdgePixels: 1 },
        "idle-scratch": cleanActionMetrics,
      },
    })).toEqual({ ok: true, errors: [] });
  });

  it("accepts the real generated report using the shared columns/rows schema", () => {
    expect(realReport.grid).toBeUndefined();
    expect(validateIdleAtlasReport(realReport)).toEqual({ ok: true, errors: [] });
    const actions = Object.values(realReport.actions) as Array<{
      registration: { neutralSubjectSize: [number, number] };
    }>;
    const neutralHeights = actions.map(
      (action) => action.registration.neutralSubjectSize[1],
    );
    expect(Math.max(...neutralHeights) - Math.min(...neutralHeights)).toBeLessThanOrEqual(4);
    expect(realReport.backgroundHolePixelsRemoved).toBeGreaterThan(0);
  });

  it("rejects a legacy grid-only report and missing continuity/color metrics", () => {
    const result = validateIdleAtlasReport({
      grid: [10, 9],
      actions: {
        "idle-lick": { frames: 30, emptyFrames: 0, hiddenRgbPixels: 0, contaminatedEdgePixels: 0 },
        "idle-blink": { frames: 30, emptyFrames: 0, hiddenRgbPixels: 0, contaminatedEdgePixels: 0 },
        "idle-scratch": { frames: 30, emptyFrames: 0, hiddenRgbPixels: 0, contaminatedEdgePixels: 0 },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "atlas must have 10 columns",
      "atlas must have 9 rows",
      "idle-lick is missing continuity metrics",
      "idle-lick is missing color metrics",
    ]));
  });

  it("rejects empty frames and a missing action", () => {
    const result = validateIdleAtlasReport({
      columns: 10,
      rows: 6,
      actions: {
        "idle-lick": { frames: 30, emptyFrames: 1, hiddenRgbPixels: 0, contaminatedEdgePixels: 0 },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "atlas must have 9 rows",
      "idle-lick contains empty frames",
      "idle-blink report is missing",
      "idle-scratch report is missing",
    ]));
  });
});
