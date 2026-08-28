import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

globalThis.window = {} as Window & typeof globalThis;

const {
  QUICK_CARE_ACTIONS,
  QUICK_INTERACTION_ACTIONS,
  parseQuickViewMode,
} = await import("./QuickActionsView");

const quickSource = readFileSync(new URL("./QuickActionsView.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("quick window routing", () => {
  it("accepts only the two compact window modes", () => {
    expect(parseQuickViewMode("care")).toBe("care");
    expect(parseQuickViewMode("interaction")).toBe("interaction");
    expect(parseQuickViewMode(null)).toBeNull();
    expect(parseQuickViewMode("center")).toBeNull();
    expect(parseQuickViewMode("settings")).toBeNull();
  });

  it("routes quick URLs to a compact view instead of the full center", () => {
    expect(appSource).toContain('view === "quick"');
    expect(appSource).toContain("QuickActionsView");
    expect(appSource).toContain("parseQuickViewMode");
    expect(appSource).toContain("QuickRouteError");
    expect(appSource).toContain('return mode ? <QuickActionsView mode={mode} /> : <QuickRouteError />;');
  });
});

describe("quick action ownership", () => {
  it("keeps care actions in the compact care mode", () => {
    expect(QUICK_CARE_ACTIONS.map((action) => action.id)).toEqual([
      "feed",
      "bath",
      "gift",
      "job",
      "quest",
    ]);
  });

  it("keeps desktop play actions separate from care and settings", () => {
    expect(QUICK_INTERACTION_ACTIONS.map((action) => action.id)).toEqual([
      "bubble",
      "pet",
      "games",
    ]);
  });

  it("uses the shared companion bridge and exposes compact feedback", () => {
    expect(quickSource).toContain("useCompanion");
    expect(quickSource).toContain("aria-live");
    expect(quickSource).toContain("bridge.feedFood");
    expect(quickSource).toContain("bridge.bathePet");
    expect(quickSource).toContain("bridge.openGiftBox");
    expect(quickSource).toContain("bridge.startPetJob");
    expect(quickSource).toContain("bridge.claimDailyQuest");
    expect(quickSource).toContain("bridge.startDesktopBubbleSession");
    expect(quickSource).toContain("bridge.interact(\"pet\")");
    expect(quickSource).toContain("bridge.showCenter");
    expect(quickSource).toContain("try");
    expect(quickSource).toContain("catch");
  });

  it("offers an explicit close control for the frameless quick window", () => {
    expect(quickSource).toContain('title="关闭快捷窗口"');
    expect(quickSource).toContain('aria-label="关闭快捷窗口"');
    expect(quickSource).toContain("window.close()");
  });

  it("marks only the header as draggable so the controls remain clickable", () => {
    const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(styles).toContain(".quick-header");
    expect(styles).toContain("-webkit-app-region: no-drag");
    expect(styles).toContain(".quick-header-actions");
    expect(styles).toContain("-webkit-app-region: no-drag");
    expect(quickSource).toContain("bridge.moveQuickWindowBy");
    expect(quickSource).toContain("setPointerCapture");
  });

  it("moves the frameless quick window from the header without dragging controls", () => {
    expect(quickSource).toContain("const quickDragRef = useRef");
    expect(quickSource).toContain("onPointerMove={quickHeaderPointerMove}");
    expect(quickSource).toContain("onPointerUp={quickHeaderPointerUp}");
    expect(quickSource).toContain("onLostPointerCapture={quickHeaderPointerCancel}");
  });

  it("does not leak Codex, CLI, gaze, notification, or settings controls into quick views", () => {
    for (const forbidden of ["ControlCenter", "Codex", "CLI", "注视", "通知", "updateSettings"]) {
      expect(quickSource).not.toContain(forbidden);
    }
  });
});
