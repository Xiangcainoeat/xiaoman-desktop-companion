import { describe, expect, it } from "vitest";
import {
  activeTabAfterClose,
  closeArticleGameTab,
  normalizeArticleGameTab,
  openArticleGameTab,
} from "./workspace";

describe("article game workspace tabs", () => {
  it("opens a game once and keeps the existing tab order", () => {
    const tabs = ["react-tetris", "snake"] as const;
    expect(openArticleGameTab(tabs, "snake")).toEqual(["react-tetris", "snake"]);
    expect(openArticleGameTab(tabs, "2048")).toEqual(["react-tetris", "snake", "2048"]);
  });

  it("selects the previous tab, then the next tab, when closing the active tab", () => {
    const tabs = ["react-tetris", "snake", "2048"] as const;
    expect(activeTabAfterClose("snake", tabs, "snake")).toBe("react-tetris");
    expect(activeTabAfterClose("react-tetris", tabs, "react-tetris")).toBe("snake");
    expect(activeTabAfterClose("2048", tabs, "2048")).toBe("snake");
    expect(closeArticleGameTab(tabs, "snake")).toEqual(["react-tetris", "2048"]);
  });

  it("falls back to the home tab if an active game is no longer open", () => {
    expect(normalizeArticleGameTab("snake", ["2048"])).toBe("home");
    expect(normalizeArticleGameTab("home", [])).toBe("home");
  });
});
