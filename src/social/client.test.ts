import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOCIAL_SERVER_ORIGIN,
  SocialClient,
  createSocialClient,
  resolveDefaultSocialOrigin,
} from "./client";
import { GuestLocalTransport } from "./local-transport";
import { ServerSocialTransport } from "./server-transport";
import { SocialError } from "./state";
import type { ChatScope, FriendRequest, GameMoveInput, SendMessageInput, SocialSession, SocialUser } from "./types";

const directScope: ChatScope = { kind: "direct", friendId: "friend-lin" };

class FailingMessageTransport extends GuestLocalTransport {
  override async sendMessage(_input: SendMessageInput): Promise<never> {
    throw new SocialError("NETWORK", "消息发送失败");
  }
}

class RefreshTrackingTransport extends GuestLocalTransport {
  collectionReads = 0;

  override async listFriends() {
    this.collectionReads += 1;
    return super.listFriends();
  }

  override async listFriendRequests() {
    this.collectionReads += 1;
    return super.listFriendRequests();
  }

  override async listGroups() {
    this.collectionReads += 1;
    return super.listGroups();
  }

  override async listInvites() {
    this.collectionReads += 1;
    return super.listInvites();
  }

  override async listRooms() {
    this.collectionReads += 1;
    return super.listRooms();
  }
}

class MoveRecoveryTrackingTransport extends RefreshTrackingTransport {
  targetedRoomReads = 0;

  override async getRoom(roomId: string) {
    this.targetedRoomReads += 1;
    return super.getRoom(roomId);
  }
}

class RejectedMoveTransport extends MoveRecoveryTrackingTransport {
  override async sendMove(_input: GameMoveInput): Promise<void> {
    throw new SocialError("MOVE_REJECTED", "服务端拒绝了这次落子");
  }
}

class DeferredMoveTransport extends GuestLocalTransport {
  lastMove: GameMoveInput | null = null;
  private releasePendingMove: (() => void) | null = null;

  override sendMove(input: GameMoveInput): Promise<void> {
    this.lastMove = input;
    return new Promise((resolve) => { this.releasePendingMove = resolve; });
  }

  confirmMove(): void {
    this.releasePendingMove?.();
    this.releasePendingMove = null;
  }
}

class DeferredSessionTransport extends GuestLocalTransport {
  private readonly pendingSession: Promise<SocialSession>;
  private releaseSession!: (session: SocialSession) => void;

  constructor() {
    super({ storage: null, now: () => 1_750 });
    this.pendingSession = new Promise((resolve) => { this.releaseSession = resolve; });
  }

  override getSession(): Promise<SocialSession> { return this.pendingSession; }
  resolveInitialization(session: SocialSession): void { this.releaseSession(session); }
}

describe("SocialClient", () => {
  it("uses the server IP as the stable default origin", () => {
    expect(DEFAULT_SOCIAL_SERVER_ORIGIN).toBe("http://47.97.219.242:18080");
    expect(resolveDefaultSocialOrigin()).toBe("http://47.97.219.242:18080");
  });

  it("uses the server transport by default instead of exposing a local mode", () => {
    const client = createSocialClient();
    expect(client.getSnapshot().session.transport).toBe("server");
    expect(client.getSnapshot().session.authState).toBe("connecting");
    client.dispose();
  });

  it("settles an initial connection failure instead of leaving a connecting session", async () => {
    const client = new SocialClient(new ServerSocialTransport("http://47.97.219.242:18080", {
      fetchImpl: async () => { throw new Error("connect refused"); },
    }));
    await client.initialize();
    expect(client.getSnapshot().session).toMatchObject({ authState: "guest", connection: "error" });
    expect(client.getSnapshot().error).toContain("connect refused");
    client.dispose();
  });

  it("starts as a guest and refreshes into an authenticated snapshot", async () => {
    const client = createSocialClient({
      transport: new GuestLocalTransport({ storage: null, now: () => 1_000 }),
    });
    expect(client.getSnapshot().session.authState).toBe("guest");
    await client.initialize();
    expect(client.getSnapshot().rooms).toEqual([]);
    await client.login({ username: "alice", password: "secret" });
    expect(client.getSnapshot().session.authState).toBe("authenticated");
    expect(client.getSnapshot().session.user?.username).toBe("alice");
    client.dispose();
  });

  it("reloads only server-backed rooms after login", async () => {
    const transport = new RefreshTrackingTransport({ storage: null, now: () => 1_500 });
    const client = new SocialClient(transport);
    await client.initialize();
    const readsBeforeLogin = transport.collectionReads;

    await client.login({ username: "alice", password: "secret" });

    expect(transport.collectionReads - readsBeforeLogin).toBe(1);
    expect(client.getSnapshot().initialized).toBe(true);
    client.dispose();
  });

  it("does not let an older initialize request overwrite a newer login", async () => {
    const transport = new DeferredSessionTransport();
    const client = new SocialClient(transport);
    const initializing = client.initialize();
    await client.login({ username: "new-user", password: "secret" });
    transport.resolveInitialization({
      authState: "guest",
      user: null,
      serverOrigin: null,
      transport: "local",
      connection: "local",
      lastConnectedAt: 1_750,
    });
    await initializing;
    expect(client.getSnapshot().session.authState).toBe("authenticated");
    expect(client.getSnapshot().session.user?.username).toBe("new-user");
    expect(client.getSnapshot().loading).toBe(false);
    client.dispose();
  });

  it("keeps a message draft when the transport rejects a send", async () => {
    const client = new SocialClient(new FailingMessageTransport({ storage: null, now: () => 2_000 }));
    await client.initialize();
    client.setDraft(directScope, "稍后重试");
    await expect(client.sendMessage({ scope: directScope, body: "发送失败" })).rejects.toThrow("消息发送失败");
    expect(client.getSnapshot().drafts["direct:friend-lin"]).toBe("稍后重试");
    expect(client.getSnapshot().error).toBe("消息发送失败");
    client.dispose();
  });

  it("updates the active room from transport events without a page reload", async () => {
    const transport = new GuestLocalTransport({ storage: null, now: () => 3_000 });
    const client = new SocialClient(transport);
    await client.initialize();
    const room = await client.createRoom({ gameId: "xiangqi" });
    await client.addTestOpponent(room.id);
    await client.setReady(room.id, true);
    expect(client.getRoom(room.id)?.status).toBe("playing");
    await client.sendMove({
      roomId: room.id,
      gameId: "xiangqi",
      seat: "red",
      from: { x: 0, y: 0 },
      to: { x: 0, y: 1 },
      captured: null,
      position: "after-1",
      seq: 1,
      createdAt: 3_001,
    });
    expect(client.getRoom(room.id)?.seq).toBe(1);
    expect(client.getRoom(room.id)?.turn).toBe("black");
    client.dispose();
  });

  it("does not reload the full room collection after a successful move", async () => {
    const transport = new RefreshTrackingTransport({ storage: null, now: () => 3_200 });
    const client = new SocialClient(transport);
    await client.initialize();
    const room = await client.createRoom({ gameId: "xiangqi" });
    await client.addTestOpponent(room.id);
    await client.setReady(room.id, true);
    const collectionReadsBeforeMove = transport.collectionReads;

    await client.sendMove({
      roomId: room.id,
      gameId: "xiangqi",
      seat: "red",
      from: { x: 0, y: 0 },
      to: { x: 0, y: 1 },
      captured: null,
      position: "after-1",
      seq: 1,
      createdAt: 3_201,
    });

    expect(transport.collectionReads).toBe(collectionReadsBeforeMove);
    client.dispose();
  });

  it("publishes a move before the realtime acknowledgement resolves", async () => {
    const transport = new DeferredMoveTransport({ storage: null, now: () => 3_250 });
    const client = new SocialClient(transport);
    await client.initialize();
    const room = await client.createRoom({ gameId: "xiangqi" });
    await client.addTestOpponent(room.id);
    await client.setReady(room.id, true);
    const move: GameMoveInput = {
      roomId: room.id,
      gameId: "xiangqi",
      seat: "red",
      from: { x: 0, y: 0 },
      to: { x: 0, y: 1 },
      captured: null,
      position: "after-1",
      seq: 1,
      createdAt: 3_251,
    };

    const pending = client.sendMove(move);

    expect(transport.lastMove).toEqual(move);
    expect(client.getRoom(room.id)).toMatchObject({ seq: 1, turn: "black", position: "after-1" });
    transport.confirmMove();
    await expect(pending).resolves.toBeUndefined();
    client.dispose();
  });

  it("uses a targeted room read instead of a full refresh after a rejected move", async () => {
    const transport = new RejectedMoveTransport({ storage: null, now: () => 3_300 });
    const client = new SocialClient(transport);
    await client.initialize();
    const room = await client.createRoom({ gameId: "xiangqi" });
    await client.addTestOpponent(room.id);
    await client.setReady(room.id, true);
    const collectionReadsBeforeMove = transport.collectionReads;

    await expect(client.sendMove({
      roomId: room.id,
      gameId: "xiangqi",
      seat: "red",
      from: { x: 0, y: 0 },
      to: { x: 0, y: 1 },
      captured: null,
      position: "after-1",
      seq: 1,
      createdAt: 3_301,
    })).rejects.toMatchObject({ code: "MOVE_REJECTED" });

    expect(transport.targetedRoomReads).toBeGreaterThan(0);
    expect(transport.collectionReads).toBe(collectionReadsBeforeMove);
    client.dispose();
  });

  it("keeps a created room in the snapshot and clears private data on logout", async () => {
    const client = new SocialClient(new GuestLocalTransport({ storage: null, now: () => 3_500 }));
    await client.initialize();
    await client.login({ username: "alice", password: "secret" });
    const room = await client.createRoom({ gameId: "xiangqi" });
    expect(client.getRoom(room.id)?.id).toBe(room.id);
    await client.logout();
    expect(client.getSnapshot().activeRoomId).toBeNull();
    expect(client.getSnapshot().rooms).toEqual([]);
    expect(client.getSnapshot().friends).toEqual([]);
    client.dispose();
  });

  it("refreshes friend requests and search results through the client facade", async () => {
    const incomingFrom: SocialUser = { id: "friend-wu", username: "wu", displayName: "吴同学", avatarUrl: null };
    const incomingTo: SocialUser = { id: "local-alice", username: "alice", displayName: "alice", avatarUrl: null };
    const incoming: FriendRequest = {
      id: "incoming-request",
      from: incomingFrom,
      to: incomingTo,
      status: "pending",
      createdAt: 4_000,
      updatedAt: 4_000,
    };
    const client = new SocialClient(new GuestLocalTransport({ storage: null, now: () => 4_500, friendRequests: [incoming] }));
    await client.initialize();
    await client.login({ username: "alice", password: "secret" });
    expect((await client.searchUsers("林")).some((user) => user.id === "friend-lin")).toBe(true);
    const request = await client.sendFriendRequest("friend-zhou");
    expect(client.getSnapshot().friendRequests.some((item) => item.id === request.id)).toBe(true);
    await client.respondFriendRequest({ requestId: incoming.id, response: "accept" });
    expect(client.getSnapshot().friendRequests.find((item) => item.id === incoming.id)?.status).toBe("accepted");
    client.dispose();
  });

  it("stops forwarding transport events after disposal", async () => {
    const transport = new GuestLocalTransport({ storage: null, now: () => 4_000 });
    const client = new SocialClient(transport);
    await client.initialize();
    let updates = 0;
    const stop = client.subscribe(() => { updates += 1; });
    client.dispose();
    stop();
    await transport.login({ username: "after-dispose", password: "secret" });
    expect(updates).toBe(0);
  });
});
