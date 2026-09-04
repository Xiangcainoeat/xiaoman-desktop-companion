import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ONLINE_GAME_CATALOG } from "./OnlineGamesView";

const source = readFileSync(new URL("./OnlineGamesView.tsx", import.meta.url), "utf8");

describe("online game lobby", () => {
  it("exposes the complete reference catalog in Chinese", () => {
    expect(ONLINE_GAME_CATALOG).toHaveLength(16);
    expect(ONLINE_GAME_CATALOG.map((game) => game.id)).toEqual([
      "gomoku",
      "tic-tac-toe",
      "chess",
      "reversi",
      "checkers",
      "xiangqi",
      "go",
      "shogi",
      "connect6",
      "ludo",
      "animal-chess",
      "army-chess",
      "backgammon",
      "dots-and-boxes",
      "mancala",
      "chinese-checkers",
    ]);
    expect(ONLINE_GAME_CATALOG.every((game) => game.label.length > 0 && game.description.length > 0)).toBe(true);
  });

  it("routes room actions through the authenticated SocialClient", () => {
    for (const method of ["createRoom", "joinRoom"]) {
      expect(source).toContain(`client.${method}`);
    }
    expect(source).toContain("创建房间");
    expect(source).toContain("加入房间");
    expect(source).toContain('snapshot.session.authState === "authenticated"');
    expect(source).not.toContain("本地测试对手");
  });

  it("keeps the room list lightweight and uses local catalog marks", () => {
    expect(source).toContain("GameArtMark");
    expect(source).toContain("查看我的房间");
    expect(source).toContain("创建后进入“我的房间”");
    expect(source).toContain("房间只通过房间号");
    expect(source).not.toContain("ROOM_FILTERS");
    expect(source).not.toContain("visibleRooms");
    expect(source).not.toContain("online-games-rooms");
  });
});
