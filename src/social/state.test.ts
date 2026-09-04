import { describe, expect, it } from "vitest";
import {
  acceptFriendRequest,
  SocialError,
  acceptInvite,
  applyRoomMove,
  assertFriendRequestAllowed,
  assignRoomSeat,
  canApplyMove,
  declineFriendRequest,
  declineInvite,
  normalizeMessageBody,
} from "./state";
import type { FriendRequest, GameInvite, GameMove, GameRoom, SocialUser } from "./types";
import { applyGomokuMove, boardFromString, boardToString, createGomokuBoard, type GomokuPlayer } from "../gomoku/logic";

const alice: SocialUser = {
  id: "user-alice",
  username: "alice",
  displayName: "Alice",
  avatarUrl: null,
};

const bob: SocialUser = {
  id: "user-bob",
  username: "bob",
  displayName: "Bob",
  avatarUrl: null,
};

function createRoom(overrides: Partial<GameRoom> = {}): GameRoom {
  return {
    id: "room-1",
    code: "ABCD12",
    gameId: "xiangqi",
    hostUserId: alice.id,
    players: {
      red: { user: alice, seat: "red", ready: true },
      black: { user: bob, seat: "black", ready: true },
    },
    status: "playing",
    turn: "red",
    seq: 0,
    position: "initial",
    lastMove: null,
    winner: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createInvite(overrides: Partial<GameInvite> = {}): GameInvite {
  return {
    id: "invite-1",
    gameId: "xiangqi",
    from: alice,
    to: bob,
    roomId: null,
    status: "pending",
    createdAt: 100,
    expiresAt: 1_000,
    ...overrides,
  };
}

function createFriendRequest(overrides: Partial<FriendRequest> = {}): FriendRequest {
  return {
    id: "request-1",
    from: alice,
    to: bob,
    status: "pending",
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

function createMove(overrides: Partial<GameMove> = {}): GameMove {
  return {
    roomId: "room-1",
    gameId: "xiangqi",
    seat: "red",
    from: { x: 0, y: 0 },
    to: { x: 0, y: 1 },
    captured: null,
    position: "after-red-1",
    seq: 1,
    createdAt: 2,
    ...overrides,
  };
}

function createGomokuRoom(overrides: Partial<GameRoom> = {}): GameRoom {
  return {
    id: "gomoku-room-1",
    code: "XMG12345",
    gameId: "gomoku",
    hostUserId: alice.id,
    players: {
      red: { user: alice, seat: "red", ready: true },
      black: { user: bob, seat: "black", ready: true },
    },
    status: "playing",
    turn: "red",
    seq: 0,
    position: boardToString(createGomokuBoard()),
    lastMove: null,
    winner: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function gomokuMove(room: GameRoom, seat: "red" | "black", row: number, col: number): GameMove {
  const player: GomokuPlayer = seat === "red" ? 1 : 2;
  const board = boardFromString(room.position);
  const next = applyGomokuMove(board, { row, col }, player);
  if (!next) throw new Error("test move is not legal");
  const point = { x: col, y: row };
  return {
    roomId: room.id,
    gameId: "gomoku",
    seat,
    from: point,
    to: point,
    captured: null,
    position: boardToString(next),
    seq: room.seq + 1,
    createdAt: room.updatedAt + 1,
  };
}

describe("social domain rules", () => {
  it("normalizes messages and rejects empty or oversized content", () => {
    expect(normalizeMessageBody("  你好，小满  ")).toBe("你好，小满");
    expect(() => normalizeMessageBody(" \n\t ")).toThrowError(SocialError);
    expect(() => normalizeMessageBody("x".repeat(2_001))).toThrowError(SocialError);
  });

  it("accepts and declines only live pending invites", () => {
    expect(acceptInvite(createInvite(), 500).status).toBe("accepted");
    expect(declineInvite(createInvite(), 500).status).toBe("declined");
    expect(() => acceptInvite(createInvite({ expiresAt: 100 }), 101)).toThrowError(/过期/);
    expect(() => declineInvite(createInvite({ status: "accepted" }), 500)).toThrowError(/状态/);
  });

  it("accepts and declines pending friend requests immutably", () => {
    const request = createFriendRequest();
    expect(acceptFriendRequest(request, bob.id).status).toBe("accepted");
    expect(declineFriendRequest(request, bob.id).status).toBe("declined");
    expect(request.status).toBe("pending");
    expect(() => acceptFriendRequest(request, alice.id)).toThrowError(/接收方/);
    expect(() => declineFriendRequest(createFriendRequest({ status: "accepted" }), bob.id)).toThrowError(/状态/);
  });

  it("rejects self, duplicate and existing-friend requests", () => {
    expect(() => assertFriendRequestAllowed(alice.id, alice.id, [], [])).toThrowError(/自己/);
    expect(() => assertFriendRequestAllowed(alice.id, bob.id, [createFriendRequest()], [])).toThrowError(/重复/);
    expect(() => assertFriendRequestAllowed(alice.id, bob.id, [], [bob.id])).toThrowError(/好友/);
    expect(() => assertFriendRequestAllowed(alice.id, bob.id, [], [])).not.toThrow();
  });

  it("assigns a returning user to the existing seat and fills red before black", () => {
    const emptyRoom = createRoom({
      players: { red: null, black: null },
      status: "waiting",
    });
    expect(assignRoomSeat(emptyRoom, alice).seat).toBe("red");
    expect(assignRoomSeat({ ...emptyRoom, players: { red: { user: alice, seat: "red", ready: false }, black: null } }, bob).seat).toBe("black");
    expect(assignRoomSeat(createRoom(), bob).seat).toBe("black");
    expect(() => assignRoomSeat(createRoom(), { ...alice, id: "user-carol" })).toThrowError(/已满/);
  });

  it("requires a matching room, turn and contiguous sequence before applying a move", () => {
    const room = createRoom();
    expect(canApplyMove(room, createMove())).toBe(true);
    expect(canApplyMove(room, createMove({ roomId: "other-room" }))).toBe(false);
    expect(canApplyMove(room, createMove({ seat: "black" }))).toBe(false);
    expect(canApplyMove(room, createMove({ seq: 3 }))).toBe(false);
    expect(canApplyMove(room, createMove({ gameId: "gomoku" }))).toBe(false);
    expect(canApplyMove(createRoom({ status: "finished" }), createMove())).toBe(false);
  });

  it("applies an accepted move immutably and advances the opposing turn", () => {
    const room = createRoom();
    const next = applyRoomMove(room, createMove());
    expect(next).not.toBe(room);
    expect(next.seq).toBe(1);
    expect(next.turn).toBe("black");
    expect(next.position).toBe("after-red-1");
    expect(next.lastMove?.from).toEqual({ x: 0, y: 0 });
    expect(room.seq).toBe(0);
    expect(() => applyRoomMove(room, createMove({ seq: 2 }))).toThrowError(/序号/);
  });

  it("validates a 15 by 15 Gomoku move and marks a five-in-a-row as finished", () => {
    const room = createGomokuRoom();
    const first = gomokuMove(room, "red", 7, 3);
    expect(canApplyMove(room, first)).toBe(true);
    expect(canApplyMove(room, { ...first, position: first.position.replace("1", "2") })).toBe(false);
    const afterFirst = applyRoomMove(room, first);
    expect(afterFirst.position).toHaveLength(225);
    expect(afterFirst.turn).toBe("black");

    let current = afterFirst;
    const sequence: Array<{ seat: "red" | "black"; row: number; col: number }> = [
      { seat: "black", row: 6, col: 0 },
      { seat: "red", row: 7, col: 4 },
      { seat: "black", row: 6, col: 1 },
      { seat: "red", row: 7, col: 5 },
      { seat: "black", row: 6, col: 2 },
      { seat: "red", row: 7, col: 6 },
      { seat: "black", row: 6, col: 3 },
      { seat: "red", row: 7, col: 7 },
    ];
    for (const step of sequence) {
      const move = gomokuMove(current, step.seat, step.row, step.col);
      expect(canApplyMove(current, move)).toBe(true);
      current = applyRoomMove(current, move);
    }
    expect(current.status).toBe("finished");
    expect(current.winner).toBe("red");
    expect(current.seq).toBe(9);
    expect(canApplyMove(current, gomokuMove(current, "black", 5, 5))).toBe(false);
  });
});
