import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./OnlineXiangqiBoard.tsx", import.meta.url), "utf8");
const bridgeSource = readFileSync(new URL("../../public/article-games/xiangqi-h5/xiaoman-xiangqi-bridge.js", import.meta.url), "utf8");
const playSource = readFileSync(new URL("../../public/article-games/xiangqi-h5/js/play.js", import.meta.url), "utf8");

describe("online xiangqi bridge contract", () => {
  it("keeps room, seat, turn, and sequence in the iframe handshake", () => {
    expect(source).toContain('channel: "xiaoman-xiangqi-mode"');
    expect(source).toContain("roomId: room.id");
    expect(source).toContain("status: room.status");
    expect(source).toContain('channel: "xiaoman-xiangqi-room-state"');
    expect(source).toContain("seq: room.seq");
  });

  it("rejects stale or foreign moves before sending them to a transport", () => {
    expect(source).toContain('channel !== "xiaoman-xiangqi-move"');
    expect(source).toContain("move.seq !== room.seq + 1");
    expect(source).toContain("seat !== move.seat");
  });

  it("provides an online-only move callback and disables the local AI loop", () => {
    expect(bridgeSource).toContain("xiaoman-xiangqi-move");
    expect(bridgeSource).toContain("xiaoman-xiangqi-remote-move");
    expect(bridgeSource).toContain("xiaoman-xiangqi-room-state");
    expect(bridgeSource).toContain("__xiaomanSetOnlineMode");
    expect(bridgeSource).toContain("boardResourcesReady");
    expect(playSource).toContain("__xiaomanOnLocalMove");
    expect(playSource).toContain("__xiaomanOnline");
    expect(playSource).toContain("__xiaomanClickBound");
  });
});
