import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

globalThis.window = {} as Window & typeof globalThis;

import { createDesktopBubble } from "../shared/desktop-interaction";
const {
  advanceDesktopBubbles,
  desktopBubblePhaseClass,
} = await import("./DesktopBubbleLayer");

const source = readFileSync(new URL("./DesktopBubbleLayer.tsx", import.meta.url), "utf8");
const quickSource = readFileSync(new URL("./QuickActionsView.tsx", import.meta.url), "utf8");
const overlaySource = readFileSync(new URL("./Overlay.tsx", import.meta.url), "utf8");

const bounds = { width: 320, height: 220 };

describe("desktop bubble renderer physics", () => {
  it("keeps 30Hz and 60Hz positions equal for the same elapsed time", () => {
    const initial = createDesktopBubble("bubble-1", bounds, () => 0.25, 0);
    const at30 = advanceDesktopBubbles([initial], 1_000 / 30, bounds)[0];
    const at60 = advanceDesktopBubbles([initial], 1_000 / 60, bounds)[0];
    let bubbles30 = [initial];
    let bubbles60 = [initial];

    for (let index = 0; index < 30; index += 1) {
      bubbles30 = advanceDesktopBubbles(bubbles30, 1_000 / 30, bounds);
    }
    for (let index = 0; index < 60; index += 1) {
      bubbles60 = advanceDesktopBubbles(bubbles60, 1_000 / 60, bounds);
    }

    expect(at30?.x).toBeDefined();
    expect(at60?.y).toBeDefined();
    expect(bubbles30[0]?.x).toBeCloseTo(bubbles60[0]?.x ?? 0, 6);
    expect(bubbles30[0]?.y).toBeCloseTo(bubbles60[0]?.y ?? 0, 6);
  });

  it("removes a bubble when the shared expiry is reached", () => {
    const bubble = createDesktopBubble("bubble-2", bounds, () => 0.5, 0);
    expect(advanceDesktopBubbles([bubble], 19_999, bounds)).toHaveLength(1);
    expect(advanceDesktopBubbles([bubble], 20_000, bounds)).toHaveLength(0);
  });

  it("maps lifecycle phases to discrete classes without a fade contract", () => {
    expect(desktopBubblePhaseClass("entering")).toBe("desktop-bubble is-entering");
    expect(desktopBubblePhaseClass("active")).toBe("desktop-bubble is-active");
    expect(desktopBubblePhaseClass("hitting")).toBe("desktop-bubble is-hitting");
    expect(desktopBubblePhaseClass("exiting")).toBe("desktop-bubble is-exiting");
  });
});

describe("desktop bubble interaction contract", () => {
  it("uses the shared physics and the dedicated desktop session bridge", () => {
    for (const required of [
      "createDesktopBubble",
      "advanceDesktopBubble",
      "requestAnimationFrame",
      "hitDesktopBubble",
      "stopDesktopBubbleSession",
      "stopPropagation",
      "preventDefault",
      "onInteractiveChange",
    ]) {
      expect(source).toContain(required);
    }
    expect(quickSource).toContain("startDesktopBubbleSession");
    for (const forbidden of ["moveOverlayBy", "opacity", "blur", "afterimage"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("keeps the bubble layer outside the pet drag hitbox and adds quick entries", () => {
    expect(overlaySource).toContain("<DesktopBubbleLayer");
    expect(overlaySource).toContain('bridge.showQuickWindow("care")');
    expect(overlaySource).toContain('bridge.showQuickWindow("interaction")');
    expect(overlaySource).toContain("stopPropagation");
    expect(overlaySource).toContain("setOverlayMouseMode");
  });

  it("gives each target its physical diameter and isolates context menus", () => {
    expect(source).toContain("width: entry.bubble.radius * 2");
    expect(source).toContain("height: entry.bubble.radius * 2");
    expect(source).toContain("onContextMenu");
  });
});
