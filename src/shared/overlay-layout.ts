import type { OverlayPanelMode } from "./types";

export const QUICK_TASK_PANEL_WIDTH = 356;
export const QUICK_TASK_PANEL_MIN_HEIGHT = 430;

export interface OverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function overlayDimensions(
  petSize: number,
  panel: boolean | OverlayPanelMode | null,
): { width: number; height: number } {
  const petWidth = Math.max(260, Math.round(petSize + 80));
  const spriteHeight = Math.round((petSize * 208) / 192);
  const petHeight = Math.max(320, spriteHeight + 100);
  const panelOpen = panel !== false && panel !== null;
  return {
    width: petWidth + (panelOpen ? QUICK_TASK_PANEL_WIDTH : 0),
    height: panelOpen ? Math.max(petHeight, QUICK_TASK_PANEL_MIN_HEIGHT) : petHeight,
  };
}

export function persistedOverlayPosition(bounds: OverlayBounds, petSize: number): { x: number; y: number } {
  const collapsed = overlayDimensions(petSize, false);
  return {
    x: bounds.x + Math.max(0, bounds.width - collapsed.width),
    y: bounds.y + Math.max(0, bounds.height - collapsed.height),
  };
}
