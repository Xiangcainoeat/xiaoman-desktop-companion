import { describe, expect, it } from "vitest";
import { GuestLocalTransport } from "./local-transport";
import { ServerSocialTransport } from "./server-transport";
import type { GameMove, SocialEvent, SocialSession, SocialUser } from "./types";
import { SocialError } from "./state";

function serverSession(user: SocialUser | null, overrides: Partial<SocialSession> = {}): SocialSession {
  return {
    authState: user ? "authenticated" : "guest",
    user,
    serverOrigin: "https://example.test",
    transport: "server",
    connection: "connected",
    lastConnectedAt: 20,
    ...overrides,
  };
}

class FakeSocket {
  readonly OPEN = 1;
  readyState = this.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  sent: string[] = [];
  closed = false;

  send(data: string): void { this.sent.push(data); }
  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }
}

const storage = {
  values: new Map<string, string>(),
  getItem(key: string) { return this.values.get(key) ?? null; },
  setItem(key: string, value: string) { this.values.set(key, value); },
  removeItem(key: string) { this.values.delete(key); },
};

function realtimeGomokuMove(overrides: Partial<GameMove> = {}): GameMove {
  const from = overrides.from ?? { x: 7, y: 7 };
  const to = overrides.to ?? from;
  const seat = overrides.seat ?? "red";
  const board = Array(15 * 15).fill("0");
  board[from.y * 15 + from.x] = seat === "red" ? "1" : "2";
  return {
    roomId: "room-gomoku",
    gameId: "gomoku",
    seat,
    from,
    to,
    captured: null,
    position: board.join(""),
    seq: 1,
    createdAt: 20_001,
    ...overrides,
  };
}

function deliver(socket: FakeSocket, envelope: unknown): void {
  socket.onmessage?.({ data: JSON.stringify(envelope) } as MessageEvent<unknown>);
}

function createAuthenticatedServerTransport(
  socket: FakeSocket,
  calls: string[],
  listener: (event: SocialEvent) => void = () => undefined,
) {
  const user: SocialUser = {
    id: "server-user",
    username: "server-user",
    displayName: "服务器用户",
    avatarUrl: null,
  };
  const transport = new ServerSocialTransport("https://example.test", {
    webSocketFactory: () => socket,
    fetchImpl: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/v1/auth/login")) {
        return new Response(JSON.stringify({ data: { token: "memory-token", session: serverSession(user) } }), { status: 200 });
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });
  const unsubscribe = transport.subscribe(listener);
  return { transport, unsubscribe, user };
}

describe("GuestLocalTransport", () => {
  it("supports guest data, messages, invites, a two-seat room and ordered moves", async () => {
    const events: SocialEvent[] = [];
    const transport = new GuestLocalTransport({ storage, now: () => 10_000 });
    const unsubscribe = transport.subscribe((event) => events.push(event));

    expect((await transport.getSession()).authState).toBe("guest");
    const session = await transport.login({ username: "demo", password: "not-persisted" });
    expect(session.authState).toBe("authenticated");
    expect(session.transport).toBe("local");

    const friends = await transport.listFriends();
    expect(friends.length).toBeGreaterThan(0);
    const scope = { kind: "direct" as const, friendId: friends[0].user.id };
    const sent = await transport.sendMessage({ scope, body: "  你好  " });
    expect(sent.body).toBe("你好");
    expect((await transport.listMessages(scope)).some((message) => message.id === sent.id)).toBe(true);

    const invite = await transport.createGameInvite({ gameId: "xiangqi", toUserId: friends[0].user.id });
    expect(invite.status).toBe("pending");
    await transport.respondGameInvite({ inviteId: invite.id, response: "accept" });
    expect((await transport.listInvites()).find((item) => item.id === invite.id)?.status).toBe("accepted");

    const room = await transport.createRoom({ gameId: "xiangqi" });
    expect(room.players.red?.user.username).toBe("demo");
    const withOpponent = await transport.addTestOpponent?.(room.id);
    expect(withOpponent?.players.black).not.toBeNull();
    await transport.setReady(room.id, true);
    const readyRoom = (await transport.listRooms()).find((item) => item.id === room.id);
    expect(readyRoom?.status).toBe("playing");

    const move: GameMove = {
      roomId: room.id,
      gameId: "xiangqi",
      seat: "red",
      from: { x: 0, y: 0 },
      to: { x: 0, y: 1 },
      captured: null,
      position: "after-1",
      seq: 1,
      createdAt: 10_001,
    };
    await transport.sendMove(move);
    const movedRoom = (await transport.listRooms()).find((item) => item.id === room.id);
    expect(movedRoom?.seq).toBe(1);
    expect(events.some((event) => event.type === "game.move")).toBe(true);

    unsubscribe();
    const eventCount = events.length;
    await transport.logout();
    expect(events.length).toBe(eventCount);
  });

  it("supports searching users and the friend-request lifecycle", async () => {
    const transport = new GuestLocalTransport({
      storage: null,
      now: () => 11_000,
      friendRequests: [{
        id: "incoming-request",
        from: { id: "friend-wu", username: "wu", displayName: "吴同学", avatarUrl: null },
        to: { id: "local-demo", username: "demo", displayName: "demo", avatarUrl: null },
        status: "pending",
        createdAt: 10_000,
        updatedAt: 10_000,
      }],
    });
    await transport.login({ username: "demo", password: "not-persisted" });
    const results = await transport.searchUsers("林");
    expect(results.some((user) => user.id === "friend-lin")).toBe(true);
    const request = await transport.sendFriendRequest("friend-zhou");
    expect(request.status).toBe("pending");
    expect((await transport.listFriendRequests()).some((item) => item.id === request.id)).toBe(true);
    await transport.respondFriendRequest({ requestId: "incoming-request", response: "accept" });
    expect((await transport.listFriendRequests()).find((item) => item.id === "incoming-request")?.status).toBe("accepted");
  });
});

describe("ServerSocialTransport", () => {
  it("times out a server request so an unavailable address cannot hang the UI", async () => {
    const transport = new ServerSocialTransport("http://47.97.219.242:18080", {
      requestTimeoutMs: 5,
      fetchImpl: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return new Response(JSON.stringify(serverSession(null)), { status: 200 });
      },
    });
    await expect(transport.getSession()).rejects.toMatchObject({
      code: "NETWORK",
      message: "服务器连接超时，请检查服务器地址或网络",
    });
    transport.dispose();
  });

  it("requires an explicit origin and maps session requests without persisting credentials", async () => {
    expect(() => new ServerSocialTransport("")).toThrowError(SocialError);

    const calls: Array<{ url: string; method: string }> = [];
    const user: SocialUser = {
      id: "server-user",
      username: "server-user",
      displayName: "服务器用户",
      avatarUrl: null,
    };
    const transport = new ServerSocialTransport("https://example.test/", {
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), method: init?.method ?? "GET" });
        return new Response(JSON.stringify({
          authState: "authenticated",
          user,
          serverOrigin: "https://example.test",
          transport: "server",
          connection: "connected",
          lastConnectedAt: 20,
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const session = await transport.getSession();
    expect(session.user?.id).toBe(user.id);
    expect(calls).toEqual([{ url: "https://example.test/api/v1/session", method: "GET" }]);
    expect(transport.kind).toBe("server");
  });

  it("unwraps data responses and only opens realtime after an authenticated session", async () => {
    const user: SocialUser = {
      id: "server-user",
      username: "server-user",
      displayName: "服务器用户",
      avatarUrl: null,
    };
    const socket = new FakeSocket();
    const sockets: FakeSocket[] = [];
    const transport = new ServerSocialTransport("https://example.test", {
      webSocketFactory: () => {
        sockets.push(socket);
        return socket;
      },
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/v1/session")) {
          return new Response(JSON.stringify({ data: serverSession(user, { authState: "guest" }) }), { status: 200 });
        }
        if (url.endsWith("/api/v1/auth/login")) {
          return new Response(JSON.stringify({ data: { token: "memory-token", session: serverSession(user) } }), { status: 200 });
        }
        if (url.endsWith("/api/v1/friends")) {
          expect(init?.headers).toBeInstanceOf(Headers);
          expect((init?.headers as Headers).get("authorization")).toBe("Bearer memory-token");
          return new Response(JSON.stringify({ data: { items: [] } }), { status: 200 });
        }
        if (url.endsWith("/api/v1/auth/logout")) return new Response(null, { status: 204 });
        throw new Error(`unexpected request: ${url}`);
      },
    });
    const unsubscribe = transport.subscribe(() => undefined);

    await transport.getSession();
    expect(sockets).toHaveLength(0);

    const session = await transport.login({ username: "server-user", password: "secret" });
    expect(session.authState).toBe("authenticated");
    expect(session.user?.id).toBe(user.id);
    expect(sockets).toHaveLength(1);
    socket.onopen?.(new Event("open"));
    expect(JSON.parse(socket.sent[0])).toEqual({ version: 1, type: "auth", payload: { token: "memory-token" } });

    const events: SocialEvent[] = [];
    const observe = transport.subscribe((event) => events.push(event));
    socket.onmessage?.({ data: JSON.stringify({ version: 1, type: "room.updated", payload: { room: { id: "malformed" } } }) } as MessageEvent<string>);
    expect(events).toEqual([]);
    observe();

    expect(await transport.listFriends()).toEqual([]);
    await transport.logout();
    expect(socket.closed).toBe(true);
    unsubscribe();
  });

  it("normalizes legacy snake_case user fields in auth responses", async () => {
    const socket = new FakeSocket();
    const transport = new ServerSocialTransport("https://example.test", {
      webSocketFactory: () => socket,
      fetchImpl: async (input) => {
        if (String(input).endsWith("/api/v1/auth/login")) {
          return new Response(JSON.stringify({ data: {
            token: "memory-token",
            session: {
              authState: "authenticated",
              user: {
                id: "legacy-user",
                username: "legacy-user",
                display_name: "旧字段用户",
                avatar_url: null,
              },
              connection: "connected",
              lastConnectedAt: 20,
            },
          } }), { status: 200 });
        }
        throw new Error(`unexpected request: ${String(input)}`);
      },
    });

    const session = await transport.login({ username: "legacy-user", password: "secret" });
    expect(session.user).toEqual({
      id: "legacy-user",
      username: "legacy-user",
      displayName: "旧字段用户",
      avatarUrl: null,
    });
    transport.dispose();
  });

  it("submits a move on the authenticated realtime socket with a correlated request envelope", async () => {
    const socket = new FakeSocket();
    const calls: string[] = [];
    const events: SocialEvent[] = [];
    const { transport, unsubscribe, user } = createAuthenticatedServerTransport(socket, calls, (event) => events.push(event));
    try {
      await transport.login({ username: "server-user", password: "secret" });
      socket.onopen?.(new Event("open"));
      deliver(socket, { version: 1, type: "session.ready", payload: { user } });

      const move = realtimeGomokuMove();
      const pending = transport.sendMove(move);
      await Promise.resolve();
      const submission = JSON.parse(socket.sent[socket.sent.length - 1] ?? "null") as Record<string, any>;

      expect(submission).toMatchObject({
        version: 1,
        type: "game.move.submit",
        roomId: move.roomId,
        seq: move.seq,
        payload: { move },
      });
      expect(submission.requestId).toEqual(expect.any(String));
      expect(submission.requestId.length).toBeGreaterThan(0);
      expect(calls.some((url) => url.endsWith("/moves"))).toBe(false);

      deliver(socket, {
        version: 1,
        type: "game.move",
        requestId: submission.requestId,
        roomId: move.roomId,
        seq: move.seq,
        payload: { move },
      });
      await expect(pending).resolves.toBeUndefined();
      expect(events).toContainEqual({ type: "game.move", move });
    } finally {
      unsubscribe();
      transport.dispose();
    }
  });

  it("routes a request-scoped realtime error to its matching move", async () => {
    const socket = new FakeSocket();
    const calls: string[] = [];
    const { transport, unsubscribe, user } = createAuthenticatedServerTransport(socket, calls);
    try {
      await transport.login({ username: "server-user", password: "secret" });
      socket.onopen?.(new Event("open"));
      deliver(socket, { version: 1, type: "session.ready", payload: { user } });

      const firstMove = realtimeGomokuMove();
      const firstPending = transport.sendMove(firstMove);
      await Promise.resolve();
      const firstSubmission = JSON.parse(socket.sent[socket.sent.length - 1] ?? "null") as Record<string, any>;

      const secondMove = realtimeGomokuMove({
        from: { x: 8, y: 8 },
        to: { x: 8, y: 8 },
        seq: 2,
      });
      const secondPending = transport.sendMove(secondMove);
      await Promise.resolve();
      const secondSubmission = JSON.parse(socket.sent[socket.sent.length - 1] ?? "null") as Record<string, any>;
      expect(secondSubmission.requestId).not.toBe(firstSubmission.requestId);

      deliver(socket, {
        version: 1,
        type: "error",
        requestId: firstSubmission.requestId,
        payload: { code: "MOVE_REJECTED", message: "走子序号不连续" },
      });
      deliver(socket, {
        version: 1,
        type: "game.move",
        requestId: secondSubmission.requestId,
        roomId: secondMove.roomId,
        seq: secondMove.seq,
        payload: { move: secondMove },
      });

      await expect(firstPending).rejects.toMatchObject({
        code: "MOVE_REJECTED",
        message: "走子序号不连续",
      });
      await expect(secondPending).resolves.toBeUndefined();
      expect(calls.some((url) => url.endsWith("/moves"))).toBe(false);
    } finally {
      unsubscribe();
      transport.dispose();
    }
  });

  it("accepts a wss realtime origin without putting credentials in the URL", async () => {
    const socket = new FakeSocket();
    let socketUrl = "";
    const user: SocialUser = {
      id: "server-user",
      username: "server-user",
      displayName: "服务器用户",
      avatarUrl: null,
    };
    const transport = new ServerSocialTransport("https://example.test", {
      webSocketOrigin: "wss://socket.example.test/base/",
      webSocketFactory: (url) => { socketUrl = url; return socket; },
      fetchImpl: async (input) => {
        if (String(input).endsWith("/api/v1/auth/login")) {
          return new Response(JSON.stringify(serverSession(user)), { status: 200 });
        }
        return new Response(JSON.stringify(serverSession(null)), { status: 200 });
      },
    });
    const unsubscribe = transport.subscribe(() => undefined);
    await transport.login({ username: "server-user", password: "secret" });
    expect(socketUrl).toBe("wss://socket.example.test/base/api/v1/realtime");
    expect(socketUrl).not.toContain("token");
    unsubscribe();
  });
});
