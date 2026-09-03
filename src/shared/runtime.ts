import type { CenterTab } from "./types";

export type RuntimeSurface = "desktop" | "web";

/** Workspaces that are safe to render in the downloaded desktop app. */
export const DESKTOP_CENTER_TABS = [
  "features",
  "care",
  "games",
  "online",
  "social",
  "codex",
  "overview",
  "reminders",
  "events",
  "settings",
] as const satisfies readonly CenterTab[];

/** The public server is intentionally a games and social surface only. */
export const WEB_CENTER_TABS = ["games", "online", "social"] as const satisfies readonly CenterTab[];

export function runtimeSurface(hasDesktopBridge: boolean): RuntimeSurface {
  return hasDesktopBridge ? "desktop" : "web";
}

export function centerTabsForSurface(surface: RuntimeSurface): readonly CenterTab[] {
  return surface === "desktop" ? DESKTOP_CENTER_TABS : WEB_CENTER_TABS;
}

export function canUseCenterTab(tab: CenterTab, surface: RuntimeSurface): boolean {
  return centerTabsForSurface(surface).includes(tab);
}

export function defaultCenterTabForSurface(surface: RuntimeSurface): CenterTab {
  return surface === "desktop" ? "features" : "games";
}

export function normalizeCenterTab(tab: CenterTab | undefined, surface: RuntimeSurface): CenterTab {
  return tab && canUseCenterTab(tab, surface) ? tab : defaultCenterTabForSurface(surface);
}
