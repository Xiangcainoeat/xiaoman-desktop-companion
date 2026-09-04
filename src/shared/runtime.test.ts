import { describe, expect, it } from "vitest";
import {
  DESKTOP_CENTER_TABS,
  WEB_CENTER_TABS,
  canUseCenterTab,
  centerTabsForSurface,
  defaultCenterTabForSurface,
  runtimeSurface,
} from "./runtime";

describe("runtime surface", () => {
  it("keeps the browser surface limited to games and social", () => {
    expect(runtimeSurface(false)).toBe("web");
    expect(centerTabsForSurface("web")).toEqual(WEB_CENTER_TABS);
    expect(defaultCenterTabForSurface("web")).toBe("games");
    expect(canUseCenterTab("games", "web")).toBe(true);
    expect(canUseCenterTab("online", "web")).toBe(true);
    expect(canUseCenterTab("social", "web")).toBe(true);
    expect(canUseCenterTab("codex", "web")).toBe(false);
    expect(canUseCenterTab("settings", "web")).toBe(false);
  });

  it("keeps all local workspaces available on the desktop surface", () => {
    expect(runtimeSurface(true)).toBe("desktop");
    expect(centerTabsForSurface("desktop")).toEqual(DESKTOP_CENTER_TABS);
    expect(defaultCenterTabForSurface("desktop")).toBe("features");
    expect(canUseCenterTab("codex", "desktop")).toBe(true);
    expect(canUseCenterTab("settings", "desktop")).toBe(true);
  });
});
