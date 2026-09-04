import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ArticleGameId } from "../article-games/registry";
import { articleGameMobileControlProfile } from "./ArticleGameView";

const source = readFileSync(new URL("./ArticleGameView.tsx", import.meta.url), "utf8");

function actionsFor(gameId: ArticleGameId) {
  return articleGameMobileControlProfile(gameId).actions ?? [];
}

describe("ArticleGameView mobile keyboard audit", () => {
  it("provides Enter for Pac-Man title, pause, and result screens", () => {
    expect(actionsFor("pacman")).toContainEqual(expect.objectContaining({
      id: "confirm",
      label: "开始 / 暂停 / 重开",
      key: "Enter",
      code: "Enter",
      keyCode: 13,
    }));
  });

  it("keeps the existing Tetris Space hard-drop action exactly once", () => {
    const spaceActions = actionsFor("react-tetris").filter((action) => action.keyCode === 32);
    expect(spaceActions).toEqual([
      expect.objectContaining({ id: "drop", label: "硬降", code: "Space" }),
    ]);
  });

  it("restores Star Battle's real WASD and Space controls", () => {
    const profile = articleGameMobileControlProfile("star-battle");
    expect(profile.kind).toBe("buttons");
    expect(profile.directions?.map(({ code, keyCode }) => [code, keyCode])).toEqual([
      ["KeyW", 87],
      ["KeyD", 68],
      ["KeyS", 83],
      ["KeyA", 65],
    ]);
    expect(profile.actions).toContainEqual(expect.objectContaining({
      id: "fire",
      label: "发射",
      key: " ",
      code: "Space",
      keyCode: 32,
    }));
  });

  it("labels Space Invaders according to its actual start and restart behavior", () => {
    expect(actionsFor("space-invaders")).toContainEqual(expect.objectContaining({
      id: "start-restart",
      label: "开始 / 重开",
      code: "Space",
      keyCode: 32,
    }));
  });

  it("does not add Space or Enter to games that do not listen for them", () => {
    const unaffectedGames: ArticleGameId[] = [
      "battle-city",
      "snake",
      "super-mario-bros",
      "2048",
      "sliding-puzzle",
      "xiangqi-h5",
    ];
    for (const gameId of unaffectedGames) {
      expect(actionsFor(gameId).filter((action) => action.keyCode === 13 || action.keyCode === 32)).toEqual([]);
    }
  });

  it("wires every mobile icon button to keydown and keyup messages", () => {
    expect(source).toContain("onPointerDown={press}");
    expect(source).toContain("onPointerUp={release}");
    expect(source).toContain('sendControlKey(action, "keydown")');
    expect(source).toContain('sendControlKey(action, "keyup")');
    expect(source).toContain('channel: "xiaoman-game-key"');
  });
});
