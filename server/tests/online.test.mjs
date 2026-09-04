import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import WebSocket from "ws";
import { createSocialServer } from "../src/app.js";
import { ONLINE_GAME_IDS } from "../src/online-game-rules.js";
import { ROOM_IDLE_TTL_MS } from "../src/store.js";

async function start() {
  const directory = await mkdtemp(join(tmpdir(), "xiaoman-social-online-"));
  const runtime = createSocialServer({ dbPath: join(directory, "social.sqlite"), staticDir: null, logger: false, roomCleanupIntervalMs: 0 });
  await new Promise((resolve) => runtime.server.listen(0, "127.0.0.1", resolve));
  const address = runtime.server.address();
  return {
    runtime,
    directory,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stop(context) {
  await context.runtime.close();
  await rm(context.directory, { recursive: true, force: true });
}

async function request(baseUrl, path, { token, body, method = "GET" } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { response, payload: text ? JSON.parse(text) : null };
}

async function register(baseUrl, username) {
  const result = await request(baseUrl, "/api/v1/auth/register", {
    method: "POST",
    body: { username, password: `${username}-password`, displayName: username },
  });
  assert.equal(result.response.status, 200);
  return result.payload.data;
}

function waitForMessage(socket, predicate, timeout = 2_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("等待实时消息超时"));
    }, timeout);
    const onMessage = (raw) => {
      let value;
      try { value = JSON.parse(raw.toString()); } catch { return; }
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(value);
    };
    socket.on("message", onMessage);
  });
}

async function connect(baseUrl, token) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/api/v1/realtime`);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(JSON.stringify({ version: 1, type: "auth", payload: { token } }));
  await waitForMessage(socket, (message) => message.type === "session.ready");
  return socket;
}

async function connectWithCookie(baseUrl, cookie) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/api/v1/realtime`, {
    headers: { cookie },
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(JSON.stringify({ version: 1, type: "auth", payload: { token: null } }));
  await waitForMessage(socket, (message) => message.type === "session.ready");
  return socket;
}

function gomokuPosition(moves = []) {
  const board = Array(15 * 15).fill("0");
  for (const move of moves) board[move.y * 15 + move.x] = move.seat === "red" ? "1" : "2";
  return board.join("");
}

function gomokuMove(room, seat, x, y, moves) {
  const nextMoves = [...moves, { seat, x, y }];
  return {
    roomId: room.id,
    gameId: "gomoku",
    seat,
    from: { x, y },
    to: { x, y },
    captured: null,
    position: gomokuPosition(nextMoves),
    seq: room.seq + 1,
    createdAt: Date.now(),
  };
}

function armyChessMove(room, seat, from, to) {
  const state = JSON.parse(room.position);
  const board = state.board.split("");
  const revealed = new Set(Array.isArray(state.revealed) ? state.revealed : []);
  const fromIndex = from.y * 5 + from.x;
  const toIndex = to.y * 5 + to.x;
  const captured = state.board[toIndex] === "0" ? null : to;
  board[toIndex] = board[fromIndex];
  board[fromIndex] = "0";
  revealed.delete(fromIndex);
  revealed.delete(toIndex);
  revealed.add(toIndex);
  return {
    roomId: room.id,
    gameId: "army-chess",
    seat,
    from,
    to,
    captured,
    position: JSON.stringify({
      ...state,
      board: board.join(""),
      turn: seat === "red" ? "black" : "red",
      revealed: [...revealed].sort((left, right) => left - right),
      lastAction: "move",
      lastCapture: captured,
    }),
    seq: room.seq + 1,
    createdAt: Date.now(),
  };
}

function armyChessReveal(room, seat, point) {
  const state = JSON.parse(room.position);
  const index = point.y * 5 + point.x;
  const revealed = Array.isArray(state.revealed) ? state.revealed : [];
  return {
    roomId: room.id,
    gameId: "army-chess",
    seat,
    from: point,
    to: point,
    captured: null,
    position: JSON.stringify({
      ...state,
      revealed: [...revealed, index].sort((left, right) => left - right),
      turn: seat === "red" ? "black" : "red",
      lastAction: "reveal",
    }),
    seq: room.seq + 1,
    createdAt: Date.now(),
  };
}

test("authenticated realtime clients receive friend requests and direct messages", async () => {
  const context = await start();
  const sockets = [];
  try {
    const alice = await register(context.baseUrl, "alicews");
    const bob = await register(context.baseUrl, "bobws");
    const bobSocket = await connect(context.baseUrl, bob.token);
    sockets.push(bobSocket);

    const requestCreated = waitForMessage(bobSocket, (message) => message.type === "friend-request.created");
    const created = await request(context.baseUrl, "/api/v1/friend-requests", {
      method: "POST",
      token: alice.token,
      body: { userId: bob.session.user.id },
    });
    assert.equal(created.response.status, 200);
    const friendRequest = created.payload.data;
    const friendEvent = await requestCreated;
    assert.equal(friendEvent.payload.request.id, friendRequest.id);

    const accepted = await request(context.baseUrl, `/api/v1/friend-requests/${friendRequest.id}`, {
      method: "PATCH",
      token: bob.token,
      body: { response: "accept" },
    });
    assert.equal(accepted.response.status, 204);

    const messageReceived = waitForMessage(bobSocket, (message) => message.type === "chat.message");
    const sent = await request(context.baseUrl, "/api/v1/messages", {
      method: "POST",
      token: alice.token,
      body: { scope: { kind: "direct", friendId: bob.session.user.id }, body: "服务器收到" },
    });
    assert.equal(sent.response.status, 200);
    const chatEvent = await messageReceived;
    assert.equal(chatEvent.payload.message.body, "服务器收到");
  } finally {
    for (const socket of sockets) socket.close();
    await stop(context);
  }
});

test("an authenticated HttpOnly cookie can establish the realtime connection without a bearer token", async () => {
  const context = await start();
  let socket;
  try {
    const registered = await request(context.baseUrl, "/api/v1/auth/register", {
      method: "POST",
      body: { username: "wscookieuser", password: "wscookieuser-password", displayName: "WS Cookie 用户" },
    });
    assert.equal(registered.response.status, 200);
    const setCookie = registered.response.headers.get("set-cookie");
    assert.match(setCookie ?? "", /^xiaoman_session=[^;]+;/);
    socket = await connectWithCookie(context.baseUrl, setCookie.split(";", 1)[0]);
    assert.equal(socket.readyState, WebSocket.OPEN);
  } finally {
    socket?.close();
    await stop(context);
  }
});

test("two authenticated users can create, join, ready, and advance a Xiangqi room", async () => {
  const context = await start();
  try {
    const alice = await register(context.baseUrl, "roomalice");
    const bob = await register(context.baseUrl, "roombob");
    const created = await request(context.baseUrl, "/api/v1/game-rooms", { method: "POST", token: alice.token, body: { gameId: "xiangqi" } });
    assert.equal(created.response.status, 200);
    const room = created.payload.data;
    assert.equal(room.players.red.user.username, "roomalice");

    const joined = await request(context.baseUrl, `/api/v1/game-rooms/${room.code}/join`, { method: "POST", token: bob.token, body: {} });
    assert.equal(joined.response.status, 200);
    assert.equal(joined.payload.data.players.black.user.username, "roombob");
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/ready`, { method: "POST", token: alice.token, body: { ready: true } });
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/ready`, { method: "POST", token: bob.token, body: { ready: true } });

    const move = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/moves`, {
      method: "POST",
      token: alice.token,
      body: {
        roomId: room.id,
        gameId: "xiangqi",
        seat: "red",
        from: { x: 0, y: 0 },
        to: { x: 0, y: 1 },
        captured: null,
        position: "after-1",
        seq: 1,
        createdAt: Date.now(),
      },
    });
    assert.equal(move.response.status, 204);
    const bobRooms = await request(context.baseUrl, "/api/v1/game-rooms", { token: bob.token });
    assert.equal(bobRooms.payload.data.items[0].seq, 1);
    assert.equal(bobRooms.payload.data.items[0].turn, "black");
  } finally {
    await stop(context);
  }
});

test("idle rooms expire after one hour and are removed from the participant list", async () => {
  const context = await start();
  try {
    const alice = await register(context.baseUrl, "expiryuser");
    const created = await request(context.baseUrl, "/api/v1/game-rooms", {
      method: "POST",
      token: alice.token,
      body: { gameId: "gomoku" },
    });
    assert.equal(created.response.status, 200);
    const room = created.payload.data;
    assert.equal(room.expiresAt, room.updatedAt + ROOM_IDLE_TTL_MS);

    const removed = context.runtime.store.cleanupExpiredRooms(room.expiresAt);
    assert.deepEqual(removed, [room.id]);

    const rooms = await request(context.baseUrl, "/api/v1/game-rooms", { token: alice.token });
    assert.equal(rooms.response.status, 200);
    assert.deepEqual(rooms.payload.data.items, []);

    const restored = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: alice.token });
    assert.equal(restored.response.status, 404);
    assert.equal(restored.payload.error.code, "ROOM_NOT_FOUND");
  } finally {
    await stop(context);
  }
});

test("online rooms require opponent confirmation before undoing the latest move", async () => {
  const context = await start();
  try {
    const alice = await register(context.baseUrl, "undoalice");
    const bob = await register(context.baseUrl, "undobob");
    const created = await request(context.baseUrl, "/api/v1/game-rooms", {
      method: "POST",
      token: alice.token,
      body: { gameId: "gomoku" },
    });
    const room = created.payload.data;
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/join`, { method: "POST", token: bob.token, body: {} });
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/ready`, { method: "POST", token: alice.token, body: { ready: true } });
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/ready`, { method: "POST", token: bob.token, body: { ready: true } });

    let current = (await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: alice.token })).payload.data;
    const moves = [];
    const firstMove = gomokuMove(current, "red", 7, 7, moves);
    const moved = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/moves`, {
      method: "POST",
      token: alice.token,
      body: firstMove,
    });
    assert.equal(moved.response.status, 204);
    moves.push({ seat: "red", x: 7, y: 7 });

    const wrongRequester = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/undo-request`, {
      method: "POST",
      token: bob.token,
      body: {},
    });
    assert.equal(wrongRequester.response.status, 409);

    const requested = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/undo-request`, {
      method: "POST",
      token: alice.token,
      body: {},
    });
    assert.equal(requested.response.status, 204);
    current = (await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: bob.token })).payload.data;
    assert.equal(current.undoRequest.requestedByUserId, alice.session.user.id);

    const blockedMove = gomokuMove(current, "black", 8, 8, moves);
    const blocked = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/moves`, {
      method: "POST",
      token: bob.token,
      body: blockedMove,
    });
    assert.equal(blocked.response.status, 409);

    const accepted = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/undo-response`, {
      method: "POST",
      token: bob.token,
      body: { accept: true },
    });
    assert.equal(accepted.response.status, 204);
    current = (await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: alice.token })).payload.data;
    assert.equal(current.seq, 0);
    assert.equal(current.turn, "red");
    assert.equal(current.position, "0".repeat(225));
    assert.equal(current.lastMove, null);
    assert.equal(current.undoRequest, null);

    const replacementMove = gomokuMove(current, "red", 6, 6, []);
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/moves`, { method: "POST", token: alice.token, body: replacementMove });
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/undo-request`, { method: "POST", token: alice.token, body: {} });
    const rejected = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/undo-response`, {
      method: "POST",
      token: bob.token,
      body: { accept: false },
    });
    assert.equal(rejected.response.status, 204);
    current = (await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: bob.token })).payload.data;
    assert.equal(current.seq, 1);
    assert.equal(current.position, replacementMove.position);
    assert.equal(current.undoRequest, null);
  } finally {
    await stop(context);
  }
});

test("Gomoku rematches require acceptance and alternate the black-playing red seat", async () => {
  const context = await start();
  const sockets = [];
  try {
    const alice = await register(context.baseUrl, "rematchalice");
    const bob = await register(context.baseUrl, "rematchbob");
    const aliceSocket = await connect(context.baseUrl, alice.token);
    const bobSocket = await connect(context.baseUrl, bob.token);
    sockets.push(aliceSocket, bobSocket);

    const created = await request(context.baseUrl, "/api/v1/game-rooms", {
      method: "POST",
      token: alice.token,
      body: { gameId: "gomoku" },
    });
    const room = created.payload.data;
    assert.equal(room.turn, "red");
    assert.equal(room.players.red.user.id, alice.session.user.id);
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/join`, { method: "POST", token: bob.token, body: {} });
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/ready`, { method: "POST", token: alice.token, body: { ready: true } });
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/ready`, { method: "POST", token: bob.token, body: { ready: true } });

    const finishedEvent = waitForMessage(bobSocket, (message) => message.type === "room.updated" && message.payload.room.status === "finished");
    const resigned = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/resign`, {
      method: "POST",
      token: alice.token,
      body: {},
    });
    assert.equal(resigned.response.status, 204);
    const finished = (await finishedEvent).payload.room;
    assert.equal(finished.winner, "black");
    assert.equal(finished.players.red.ready, false);
    assert.equal(finished.players.black.ready, false);
    assert.equal(finished.rematchRequest, null);
    context.runtime.store.setRoomUserConnected(bob.session.user.id, false);

    const requestEvent = waitForMessage(bobSocket, (message) => message.type === "room.updated" && message.payload.room.rematchRequest?.requestedByUserId === alice.session.user.id);
    const requested = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/rematch`, {
      method: "POST",
      token: alice.token,
      body: {},
    });
    assert.equal(requested.response.status, 204);
    const pending = (await requestEvent).payload.room;
    assert.equal(pending.status, "finished");
    assert.equal(pending.players.red.ready, true);
    assert.equal(pending.players.black.ready, false);
    assert.equal(pending.rematchRequest.requestedByUserId, alice.session.user.id);

    const startedForAlice = waitForMessage(aliceSocket, (message) => message.type === "room.updated" && message.payload.room.status === "playing" && message.payload.room.seq === 0);
    const accepted = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/rematch`, {
      method: "POST",
      token: bob.token,
      body: {},
    });
    assert.equal(accepted.response.status, 204);
    const restarted = (await startedForAlice).payload.room;
    assert.equal(restarted.status, "playing");
    assert.equal(restarted.turn, "red");
    assert.equal(restarted.seq, 0);
    assert.equal(restarted.position, "0".repeat(225));
    assert.equal(restarted.winner, null);
    assert.equal(restarted.rematchRequest, null);
    assert.equal(restarted.players.red.ready, true);
    assert.equal(restarted.players.black.ready, true);
    assert.equal(restarted.players.red.user.id, bob.session.user.id);
    assert.equal(restarted.players.red.connected, false);
    assert.equal(restarted.players.black.user.id, alice.session.user.id);
    assert.equal(restarted.players.black.connected, true);

    const secondResign = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/resign`, {
      method: "POST",
      token: alice.token,
      body: {},
    });
    assert.equal(secondResign.response.status, 204);

    const secondRequest = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/rematch`, {
      method: "POST",
      token: bob.token,
      body: {},
    });
    assert.equal(secondRequest.response.status, 204);
    const secondAccept = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/rematch`, {
      method: "POST",
      token: alice.token,
      body: {},
    });
    assert.equal(secondAccept.response.status, 204);

    const secondRestartedResponse = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: alice.token });
    assert.equal(secondRestartedResponse.response.status, 200);
    const secondRestarted = secondRestartedResponse.payload.data;
    assert.equal(secondRestarted.status, "playing");
    assert.equal(secondRestarted.turn, "red");
    assert.equal(secondRestarted.seq, 0);
    assert.equal(secondRestarted.position, "0".repeat(225));
    assert.equal(secondRestarted.winner, null);
    assert.equal(secondRestarted.rematchRequest, null);
    assert.equal(secondRestarted.players.red.user.id, alice.session.user.id);
    assert.equal(secondRestarted.players.red.ready, true);
    assert.equal(secondRestarted.players.red.connected, true);
    assert.equal(secondRestarted.players.black.user.id, bob.session.user.id);
    assert.equal(secondRestarted.players.black.ready, true);
    assert.equal(secondRestarted.players.black.connected, false);
  } finally {
    for (const socket of sockets) socket.close();
    await stop(context);
  }
});

test("two authenticated users can invite, restore, and play a server-backed Gomoku room", async () => {
  const context = await start();
  const sockets = [];
  try {
    const alice = await register(context.baseUrl, "gomokualice");
    const bob = await register(context.baseUrl, "gomokubob");
    const aliceSocket = await connect(context.baseUrl, alice.token);
    const bobSocket = await connect(context.baseUrl, bob.token);
    sockets.push(aliceSocket, bobSocket);

    const friendRequest = await request(context.baseUrl, "/api/v1/friend-requests", {
      method: "POST",
      token: alice.token,
      body: { userId: bob.session.user.id },
    });
    assert.equal(friendRequest.response.status, 200);
    const acceptedFriend = await request(context.baseUrl, `/api/v1/friend-requests/${friendRequest.payload.data.id}`, {
      method: "PATCH",
      token: bob.token,
      body: { response: "accept" },
    });
    assert.equal(acceptedFriend.response.status, 204);

    const created = await request(context.baseUrl, "/api/v1/game-rooms", {
      method: "POST",
      token: alice.token,
      body: { gameId: "gomoku" },
    });
    assert.equal(created.response.status, 200);
    const room = created.payload.data;
    assert.equal(room.gameId, "gomoku");
    assert.equal(room.position, "0".repeat(225));

    const inviteEvent = waitForMessage(bobSocket, (message) => message.type === "invite.created");
    const createdInvite = await request(context.baseUrl, "/api/v1/invites", {
      method: "POST",
      token: alice.token,
      body: { gameId: "gomoku", toUserId: bob.session.user.id, roomId: room.id },
    });
    assert.equal(createdInvite.response.status, 200);
    const invite = createdInvite.payload.data;
    assert.equal((await inviteEvent).payload.invite.roomId, room.id);

    const inviterRoomEvent = waitForMessage(aliceSocket, (message) => message.type === "room.updated" && message.payload.room.id === room.id);
    const accepted = await request(context.baseUrl, `/api/v1/invites/${invite.id}`, {
      method: "PATCH",
      token: bob.token,
      body: { response: "accept" },
    });
    assert.equal(accepted.response.status, 204);
    assert.equal((await inviterRoomEvent).payload.room.id, room.id);

    const bobInvites = await request(context.baseUrl, "/api/v1/invites", { token: bob.token });
    const acceptedInvite = bobInvites.payload.data.items.find((item) => item.id === invite.id);
    assert.equal(acceptedInvite.status, "accepted");
    assert.equal(acceptedInvite.roomId, room.id);

    const bobJoined = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/join`, {
      method: "POST",
      token: bob.token,
      body: {},
    });
    assert.equal(bobJoined.response.status, 200);
    assert.equal(bobJoined.payload.data.players.black.user.username, "gomokubob");

    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/ready`, { method: "POST", token: alice.token, body: { ready: true } });
    const playingEvent = waitForMessage(bobSocket, (message) => message.type === "room.updated" && message.payload.room.status === "playing");
    const bobReady = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/ready`, { method: "POST", token: bob.token, body: { ready: true } });
    assert.equal(bobReady.response.status, 204);
    assert.equal((await playingEvent).payload.room.status, "playing");

    const moves = [];
    const sequence = [
      ["red", 3, 7], ["black", 0, 6],
      ["red", 4, 7], ["black", 1, 6],
      ["red", 5, 7], ["black", 2, 6],
      ["red", 6, 7], ["black", 3, 6],
      ["red", 7, 7],
    ];
    let currentRoom = (await request(context.baseUrl, "/api/v1/game-rooms", { token: alice.token })).payload.data.items.find((item) => item.id === room.id);
    for (const [seat, x, y] of sequence) {
      const move = gomokuMove(currentRoom, seat, x, y, moves);
      if (seat === "red") {
        const remoteEvent = waitForMessage(bobSocket, (message) => message.type === "room.updated" && message.payload.room.id === room.id && message.payload.room.seq === move.seq);
        const result = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/moves`, { method: "POST", token: alice.token, body: move });
        assert.equal(result.response.status, 204);
        await remoteEvent;
      } else {
        const remoteEvent = waitForMessage(aliceSocket, (message) => message.type === "room.updated" && message.payload.room.id === room.id && message.payload.room.seq === move.seq);
        const result = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/moves`, { method: "POST", token: bob.token, body: move });
        assert.equal(result.response.status, 204);
        await remoteEvent;
      }
      moves.push({ seat, x, y });
      currentRoom = (await request(context.baseUrl, "/api/v1/game-rooms", { token: alice.token })).payload.data.items.find((item) => item.id === room.id);
    }

    assert.equal(currentRoom.status, "finished");
    assert.equal(currentRoom.winner, "red");
    assert.equal(currentRoom.seq, 9);
    assert.equal(currentRoom.position, gomokuPosition(moves));

    const restore = await request(context.baseUrl, "/api/v1/game-rooms", { token: bob.token });
    const restoredRoom = restore.payload.data.items.find((item) => item.id === room.id);
    assert.equal(restoredRoom.status, "finished");
    assert.equal(restoredRoom.position, currentRoom.position);
    assert.equal(restoredRoom.lastMove.from.x, 7);
    assert.equal(restoredRoom.lastMove.from.y, 7);
  } finally {
    for (const socket of sockets) socket.close();
    await stop(context);
  }
});

test("two WebSocket clients exchange Gomoku moves with request IDs and strict sequence ordering", async () => {
  const context = await start();
  const sockets = [];
  try {
    const alice = await register(context.baseUrl, "wsgomokualice");
    const bob = await register(context.baseUrl, "wsgomokubob");
    const aliceSocket = await connect(context.baseUrl, alice.token);
    const bobSocket = await connect(context.baseUrl, bob.token);
    sockets.push(aliceSocket, bobSocket);

    const created = await request(context.baseUrl, "/api/v1/game-rooms", {
      method: "POST",
      token: alice.token,
      body: { gameId: "gomoku" },
    });
    assert.equal(created.response.status, 200);
    const room = created.payload.data;
    const joined = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/join`, {
      method: "POST",
      token: bob.token,
      body: {},
    });
    assert.equal(joined.response.status, 200);
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/ready`, {
      method: "POST",
      token: alice.token,
      body: { ready: true },
    });
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/ready`, {
      method: "POST",
      token: bob.token,
      body: { ready: true },
    });

    const firstMove = gomokuMove({ ...room, seq: 0 }, "red", 7, 7, []);
    const firstRequestId = "ws-gomoku-red-1";
    const firstAliceMove = waitForMessage(aliceSocket, (message) => message.type === "game.move"
      && message.requestId === firstRequestId && message.payload?.move?.seq === 1, 1_000);
    const firstBobMove = waitForMessage(bobSocket, (message) => message.type === "game.move"
      && message.requestId === firstRequestId && message.payload?.move?.seq === 1, 1_000);
    const firstAliceRoom = waitForMessage(aliceSocket, (message) => message.type === "room.updated"
      && message.payload?.room?.id === room.id && message.payload.room.seq === 1, 1_000);
    const firstBobRoom = waitForMessage(bobSocket, (message) => message.type === "room.updated"
      && message.payload?.room?.id === room.id && message.payload.room.seq === 1, 1_000);

    aliceSocket.send(JSON.stringify({
      version: 1,
      type: "game.move.submit",
      requestId: firstRequestId,
      roomId: room.id,
      seq: firstMove.seq,
      payload: { move: firstMove },
    }));

    const [firstAliceMoveEvent, firstBobMoveEvent, firstAliceRoomEvent, firstBobRoomEvent] = await Promise.all([
      firstAliceMove,
      firstBobMove,
      firstAliceRoom,
      firstBobRoom,
    ]);
    assert.equal(firstAliceMoveEvent.requestId, firstRequestId);
    assert.equal(firstBobMoveEvent.requestId, firstRequestId);
    assert.deepEqual(firstAliceMoveEvent.payload.move, firstMove);
    assert.deepEqual(firstBobMoveEvent.payload.move, firstMove);
    assert.equal(firstAliceRoomEvent.payload.room.turn, "black");
    assert.equal(firstBobRoomEvent.payload.room.seq, 1);

    const rejectedRequestId = "ws-gomoku-stale-1";
    const staleMove = {
      ...gomokuMove({ ...room, seq: 1 }, "black", 0, 0, [{ seat: "red", x: 7, y: 7 }]),
      seq: 1,
    };
    const rejected = waitForMessage(bobSocket, (message) => message.type === "error"
      && message.requestId === rejectedRequestId, 1_000);
    bobSocket.send(JSON.stringify({
      version: 1,
      type: "game.move.submit",
      requestId: rejectedRequestId,
      roomId: room.id,
      seq: staleMove.seq,
      payload: { move: staleMove },
    }));
    const rejectedEvent = await rejected;
    assert.equal(rejectedEvent.requestId, rejectedRequestId);
    assert.equal(rejectedEvent.payload.code, "MOVE_REJECTED");
    const afterRejected = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: bob.token });
    assert.equal(afterRejected.response.status, 200);
    assert.equal(afterRejected.payload.data.seq, 1);
    assert.equal(afterRejected.payload.data.position, firstMove.position);

    const secondMove = gomokuMove({ ...room, seq: 1 }, "black", 0, 0, [{ seat: "red", x: 7, y: 7 }]);
    const secondRequestId = "ws-gomoku-black-2";
    const secondAliceMove = waitForMessage(aliceSocket, (message) => message.type === "game.move"
      && message.requestId === secondRequestId && message.payload?.move?.seq === 2, 1_000);
    const secondBobMove = waitForMessage(bobSocket, (message) => message.type === "game.move"
      && message.requestId === secondRequestId && message.payload?.move?.seq === 2, 1_000);
    const secondAliceRoom = waitForMessage(aliceSocket, (message) => message.type === "room.updated"
      && message.payload?.room?.id === room.id && message.payload.room.seq === 2, 1_000);
    const secondBobRoom = waitForMessage(bobSocket, (message) => message.type === "room.updated"
      && message.payload?.room?.id === room.id && message.payload.room.seq === 2, 1_000);

    bobSocket.send(JSON.stringify({
      version: 1,
      type: "game.move.submit",
      requestId: secondRequestId,
      roomId: room.id,
      seq: secondMove.seq,
      payload: { move: secondMove },
    }));
    const [secondAliceMoveEvent, secondBobMoveEvent, secondAliceRoomEvent, secondBobRoomEvent] = await Promise.all([
      secondAliceMove,
      secondBobMove,
      secondAliceRoom,
      secondBobRoom,
    ]);
    assert.equal(secondAliceMoveEvent.requestId, secondRequestId);
    assert.equal(secondBobMoveEvent.requestId, secondRequestId);
    assert.deepEqual(secondAliceMoveEvent.payload.move, secondMove);
    assert.deepEqual(secondBobMoveEvent.payload.move, secondMove);
    assert.equal(secondAliceRoomEvent.payload.room.seq, 2);
    assert.equal(secondBobRoomEvent.payload.room.turn, "red");
  } finally {
    for (const socket of sockets) socket.close();
    await stop(context);
  }
});

test("Army Chess move turns are server-owned and strictly alternate between players", async () => {
  const context = await start();
  try {
    const alice = await register(context.baseUrl, "armyturnalice");
    const bob = await register(context.baseUrl, "armyturnbob");
    const created = await request(context.baseUrl, "/api/v1/game-rooms", {
      method: "POST",
      token: alice.token,
      body: { gameId: "army-chess" },
    });
    assert.equal(created.response.status, 200);
    let room = created.payload.data;
    const joined = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/join`, {
      method: "POST",
      token: bob.token,
      body: {},
    });
    assert.equal(joined.response.status, 200);
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/ready`, {
      method: "POST",
      token: alice.token,
      body: { ready: true },
    });
    const started = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/ready`, {
      method: "POST",
      token: bob.token,
      body: { ready: true },
    });
    assert.equal(started.response.status, 204);

    room = (await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: alice.token })).payload.data;
    assert.equal(room.status, "playing");
    assert.equal(room.turn, "red");

    const redReveal = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/moves`, {
      method: "POST",
      token: alice.token,
      body: armyChessReveal(room, "red", { x: 0, y: 7 }),
    });
    assert.equal(redReveal.response.status, 204);
    room = (await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: bob.token })).payload.data;

    const blackReveal = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/moves`, {
      method: "POST",
      token: bob.token,
      body: armyChessReveal(room, "black", { x: 0, y: 2 }),
    });
    assert.equal(blackReveal.response.status, 204);
    room = (await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: alice.token })).payload.data;
    assert.equal(room.seq, 2);
    assert.equal(room.turn, "red");

    const firstMove = armyChessMove(room, "red", { x: 0, y: 7 }, { x: 1, y: 7 });
    const first = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/moves`, {
      method: "POST",
      token: alice.token,
      body: firstMove,
    });
    assert.equal(first.response.status, 204);

    room = (await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: bob.token })).payload.data;
    assert.equal(room.seq, 3);
    assert.equal(room.turn, "black");
    assert.equal(JSON.parse(room.position).turn, "black");
    const positionAfterFirstMove = room.position;

    const consecutiveMove = armyChessMove(room, "red", { x: 2, y: 7 }, { x: 3, y: 7 });
    const rejected = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/moves`, {
      method: "POST",
      token: alice.token,
      body: consecutiveMove,
    });
    assert.equal(rejected.response.status, 409);
    assert.equal(rejected.payload.error.code, "MOVE_REJECTED");

    room = (await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: bob.token })).payload.data;
    assert.equal(room.seq, 3);
    assert.equal(room.turn, "black");
    assert.equal(room.position, positionAfterFirstMove);

    const secondMove = armyChessMove(room, "black", { x: 0, y: 2 }, { x: 1, y: 2 });
    const second = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/moves`, {
      method: "POST",
      token: bob.token,
      body: secondMove,
    });
    assert.equal(second.response.status, 204);

    room = (await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: alice.token })).payload.data;
    assert.equal(room.seq, 4);
    assert.equal(room.turn, "red");
    assert.equal(JSON.parse(room.position).turn, "red");
  } finally {
    await stop(context);
  }
});

test("Army Chess reveals consume the same alternating turn as piece moves", async () => {
  const context = await start();
  try {
    const alice = await register(context.baseUrl, "armyrevealalice");
    const bob = await register(context.baseUrl, "armyrevealbob");
    const created = await request(context.baseUrl, "/api/v1/game-rooms", {
      method: "POST",
      token: alice.token,
      body: { gameId: "army-chess" },
    });
    assert.equal(created.response.status, 200);
    let room = created.payload.data;
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/join`, {
      method: "POST",
      token: bob.token,
      body: {},
    });
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/ready`, {
      method: "POST",
      token: alice.token,
      body: { ready: true },
    });
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/ready`, {
      method: "POST",
      token: bob.token,
      body: { ready: true },
    });
    room = (await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: alice.token })).payload.data;

    const firstReveal = armyChessReveal(room, "red", { x: 0, y: 6 });
    const first = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/moves`, {
      method: "POST",
      token: alice.token,
      body: firstReveal,
    });
    assert.equal(first.response.status, 204);

    room = (await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: bob.token })).payload.data;
    assert.equal(room.seq, 1);
    assert.equal(room.turn, "black");
    assert.equal(JSON.parse(room.position).turn, "black");
    assert.deepEqual(JSON.parse(room.position).revealed, [30]);
    const positionAfterFirstReveal = room.position;

    const consecutiveReveal = armyChessReveal(room, "red", { x: 1, y: 6 });
    const rejected = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/moves`, {
      method: "POST",
      token: alice.token,
      body: consecutiveReveal,
    });
    assert.equal(rejected.response.status, 409);
    assert.equal(rejected.payload.error.code, "MOVE_REJECTED");

    room = (await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: bob.token })).payload.data;
    assert.equal(room.seq, 1);
    assert.equal(room.position, positionAfterFirstReveal);

    const secondReveal = armyChessReveal(room, "black", { x: 0, y: 0 });
    const second = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/moves`, {
      method: "POST",
      token: bob.token,
      body: secondReveal,
    });
    assert.equal(second.response.status, 204);

    room = (await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: alice.token })).payload.data;
    assert.equal(room.seq, 2);
    assert.equal(room.turn, "red");
    assert.equal(JSON.parse(room.position).turn, "red");
    assert.deepEqual(JSON.parse(room.position).revealed, [0, 30]);
  } finally {
    await stop(context);
  }
});

test("accepting a roomless Gomoku invite creates a room that the inviter can restore", async () => {
  const context = await start();
  try {
    const alice = await register(context.baseUrl, "autoinvitealice");
    const bob = await register(context.baseUrl, "autoinvitebob");
    const friendRequest = await request(context.baseUrl, "/api/v1/friend-requests", {
      method: "POST",
      token: alice.token,
      body: { userId: bob.session.user.id },
    });
    await request(context.baseUrl, `/api/v1/friend-requests/${friendRequest.payload.data.id}`, {
      method: "PATCH",
      token: bob.token,
      body: { response: "accept" },
    });
    const created = await request(context.baseUrl, "/api/v1/invites", {
      method: "POST",
      token: alice.token,
      body: { gameId: "gomoku", toUserId: bob.session.user.id },
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.payload.data.roomId, null);

    const accepted = await request(context.baseUrl, `/api/v1/invites/${created.payload.data.id}`, {
      method: "PATCH",
      token: bob.token,
      body: { response: "accept" },
    });
    assert.equal(accepted.response.status, 204);
    const aliceInvites = await request(context.baseUrl, "/api/v1/invites", { token: alice.token });
    const acceptedInvite = aliceInvites.payload.data.items.find((item) => item.id === created.payload.data.id);
    assert.equal(acceptedInvite.status, "accepted");
    assert.match(acceptedInvite.roomId, /^room-/);

    const aliceRooms = await request(context.baseUrl, "/api/v1/game-rooms", { token: alice.token });
    const restored = aliceRooms.payload.data.items.find((item) => item.id === acceptedInvite.roomId);
    assert.equal(restored.gameId, "gomoku");
    assert.equal(restored.players.red.user.username, "autoinvitealice");
    assert.equal(restored.players.black, null);
  } finally {
    await stop(context);
  }
});

test("the complete public online-game catalog can create and restore rooms", async () => {
  const context = await start();
  try {
    const user = await register(context.baseUrl, "cataloguser");
    for (const gameId of ONLINE_GAME_IDS) {
      const created = await request(context.baseUrl, "/api/v1/game-rooms", {
        method: "POST",
        token: user.token,
        body: { gameId },
      });
      assert.equal(created.response.status, 200, gameId);
      assert.equal(created.payload.data.gameId, gameId);
      assert.equal(created.payload.data.players.red.user.username, "cataloguser");
    }
    const rooms = await request(context.baseUrl, "/api/v1/game-rooms", { token: user.token });
    assert.equal(rooms.response.status, 200);
    assert.equal(rooms.payload.data.items.length, ONLINE_GAME_IDS.length);
    assert.deepEqual(new Set(rooms.payload.data.items.map((room) => room.gameId)), new Set(ONLINE_GAME_IDS));
  } finally {
    await stop(context);
  }
});

test("a structured room advances a WebSocket-compatible tic-tac-toe position", async () => {
  const context = await start();
  try {
    const alice = await register(context.baseUrl, "tictacalice");
    const bob = await register(context.baseUrl, "tictacbob");
    const created = await request(context.baseUrl, "/api/v1/game-rooms", { method: "POST", token: alice.token, body: { gameId: "tic-tac-toe" } });
    const room = created.payload.data;
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/join`, { method: "POST", token: bob.token, body: {} });
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/ready`, { method: "POST", token: alice.token, body: { ready: true } });
    await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/ready`, { method: "POST", token: bob.token, body: { ready: true } });
    const current = JSON.parse(room.position);
    current.board = `1${current.board.slice(1)}`;
    current.turn = "black";
    const move = {
      roomId: room.id,
      gameId: "tic-tac-toe",
      seat: "red",
      from: { x: 0, y: 0 },
      to: { x: 0, y: 0 },
      captured: null,
      position: JSON.stringify(current),
      seq: 1,
      createdAt: Date.now(),
    };
    const result = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}/moves`, { method: "POST", token: alice.token, body: move });
    assert.equal(result.response.status, 204);
    const restored = await request(context.baseUrl, `/api/v1/game-rooms/${room.id}`, { token: bob.token });
    assert.equal(restored.payload.data.position, move.position);
    assert.equal(restored.payload.data.turn, "black");
  } finally {
    await stop(context);
  }
});
