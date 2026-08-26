import { describe, expect, it } from "vitest";
import { createLookAtlasMetadata } from "./animation";
import {
  DEFAULT_SETTINGS,
  createDefaultData,
  normalizeCompanionSettings,
  normalizePersistedData,
} from "./domain";
import {
  interpolateLookDirection,
  shortestAngleDelta,
  smoothAngle,
} from "./gaze";
import type { CompanionSettings } from "./types";

describe("Task 5 companion settings contract", () => {
  it("uses enhanced rendering and native replies without changing gaze defaults", () => {
    const settings = createDefaultData().settings;

    expect(settings).toMatchObject({
      petProfile: "enhanced",
      codexReplyTransport: "native",
      gazeEnabled: true,
      gazeRange: "full-360",
      gazeFrameRate: 60,
      animationFrameRate: 30,
    });
  });

  it("adds the new defaults to legacy data while preserving existing settings", () => {
    const data = createDefaultData(100);
    const legacySettings = {
      ...DEFAULT_SETTINGS,
      gazeEnabled: false,
      gazeRange: "upper-180",
      gazeFrameRate: 30,
      animationFrameRate: 60,
    } as Partial<CompanionSettings>;
    delete legacySettings.petProfile;
    delete legacySettings.codexReplyTransport;

    const settings = normalizePersistedData({
      ...data,
      version: 1,
      settings: legacySettings,
    }).settings;

    expect(settings).toMatchObject({
      petProfile: "enhanced",
      codexReplyTransport: "native",
      gazeEnabled: false,
      gazeRange: "upper-180",
      gazeFrameRate: 30,
      animationFrameRate: 60,
    });
  });

  it("normalizes unsupported profile and reply transport values", () => {
    const settings = normalizeCompanionSettings({
      petProfile: "classic",
      codexReplyTransport: "shell",
    });

    expect(settings.petProfile).toBe("enhanced");
    expect(settings.codexReplyTransport).toBe("native");
  });

  it("preserves supported native profile and CLI compatibility choices", () => {
    const settings = normalizeCompanionSettings({
      petProfile: "native",
      codexReplyTransport: "cli",
    });

    expect(settings.petProfile).toBe("native");
    expect(settings.codexReplyTransport).toBe("cli");
  });
});

describe("Task 5 look atlas contract", () => {
  it("derives layout and angular steps from the atlas frame count", () => {
    const enhanced = createLookAtlasMetadata({
      frameCount: 90,
      columns: 10,
      frameWidth: 192,
      frameHeight: 208,
    });

    expect(enhanced).toEqual({
      frameCount: 90,
      columns: 10,
      rows: 9,
      frameWidth: 192,
      frameHeight: 208,
      stepDegrees: 4,
    });
    expect(interpolateLookDirection(359, enhanced.frameCount)).toEqual({
      first: 89,
      second: 0,
      blend: 0.75,
    });
    expect(createLookAtlasMetadata({
      frameCount: 16,
      columns: 8,
      frameWidth: 192,
      frameHeight: 208,
    })).toMatchObject({
      frameCount: 16,
      columns: 8,
      rows: 2,
      stepDegrees: 22.5,
    });
  });
});

describe("Task 5 gaze direction contract", () => {
  it("interpolates a 90-direction atlas in four-degree steps", () => {
    expect(interpolateLookDirection(6, 90)).toEqual({ first: 1, second: 2, blend: 0.5 });
    expect(interpolateLookDirection(180, 90)).toEqual({ first: 45, second: 46, blend: 0 });
    expect(interpolateLookDirection(359, 90)).toEqual({ first: 89, second: 0, blend: 0.75 });
  });

  it("keeps the existing 16-direction default unchanged", () => {
    expect(interpolateLookDirection(359)).toEqual(interpolateLookDirection(359, 16));
    expect(interpolateLookDirection(180)).toEqual({ first: 8, second: 9, blend: 0 });
  });

  it("rejects direction counts that cannot describe a finite atlas", () => {
    expect(() => interpolateLookDirection(0, 0)).toThrow("positive integer");
    expect(() => interpolateLookDirection(0, 90.5)).toThrow("positive integer");
    expect(() => interpolateLookDirection(0, Number.POSITIVE_INFINITY)).toThrow("positive integer");
  });

  it("takes the shortest path in both directions across the lower half", () => {
    expect(shortestAngleDelta(135, 225)).toBe(90);
    expect(shortestAngleDelta(225, 135)).toBe(-90);
    expect(shortestAngleDelta(91, 269)).toBe(178);
    expect(shortestAngleDelta(269, 91)).toBe(-178);

    const clockwise = smoothAngle(135, 225, 100, 300);
    const counterClockwise = smoothAngle(225, 135, 100, 300);
    expect(clockwise).toBeGreaterThan(135);
    expect(clockwise).toBeLessThan(225);
    expect(counterClockwise).toBeLessThan(225);
    expect(counterClockwise).toBeGreaterThan(135);
  });
});
