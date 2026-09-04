import { URL } from "node:url";
import { WebSocketServer } from "ws";
import { asAppError } from "./errors.js";
import { moveInput } from "./game-protocol.js";
import { hashSessionToken } from "./security.js";

function parseCookies(header) {
  const cookies = {};
  for (const chunk of String(header ?? "").split(";")) {
    const separator = chunk.indexOf("=");
    if (separator < 0) continue;
    const key = chunk.slice(0, separator).trim();
    const value = chunk.slice(separator + 1).trim();
    if (!key) continue;
    try { cookies[key] = decodeURIComponent(value); } catch { /* ignore malformed cookies */ }
  }
  return cookies;
}

function envelopeFor(event) {
  switch (event.type) {
    case "friend-request.created":
    case "friend-request.updated":
      return { version: 1, type: event.type, payload: { request: event.request } };
    case "chat.message":
      return { version: 1, type: event.type, payload: { message: event.message } };
    case "invite.created":
    case "invite.updated":
      return { version: 1, type: event.type, payload: { invite: event.invite } };
    case "room.updated":
      return { version: 1, type: event.type, payload: { room: event.room } };
    case "game.move":
      return {
        version: 1,
        type: event.type,
        requestId: event.requestId,
        roomId: event.move.roomId,
        seq: event.move.seq,
        payload: { move: event.move },
      };
    case "game.resync":
      return {
        version: 1,
        type: event.type,
        roomId: event.roomId,
        seq: event.seq,
        payload: { position: event.position, turn: event.turn },
      };
    case "error":
      return {
        version: 1,
        type: event.type,
        requestId: event.requestId,
        payload: { code: event.code, message: event.message },
      };
    default:
      return null;
  }
}

export class RealtimeHub {
  constructor({ store, now = Date.now } = {}) {
    this.store = store;
    this.now = now;
    this.clients = new Map();
    this.server = null;
    this.wss = null;
  }

  attach(server) {
    this.server = server;
    this.wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (request, socket, head) => {
      let pathname = "";
      try { pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname; } catch { socket.destroy(); return; }
      if (pathname !== "/api/v1/realtime") {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (websocket) => this.accept(websocket, request));
    });
  }

  accept(websocket, request) {
    const client = { websocket, userId: null, authTimer: null };
    client.authTimer = setTimeout(() => {
      if (!client.userId) {
        this.sendError(websocket, "UNAUTHORIZED", "实时连接需要登录");
        websocket.close(4001, "authentication required");
      }
    }, 10_000);
    websocket.on("message", (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { this.sendError(websocket, "INVALID_INPUT", "实时消息格式无效"); return; }
      if (message?.version !== 1 || typeof message.type !== "string") {
        this.sendError(websocket, "INVALID_INPUT", "实时消息格式无效", message?.requestId);
        return;
      }

      if (message.type === "auth") {
        const token = typeof message.payload?.token === "string" && message.payload.token.trim()
          ? message.payload.token.trim()
          : parseCookies(request.headers.cookie).xiaoman_session;
        const user = token ? this.store.userForSession(hashSessionToken(token), this.now()) : null;
        if (!user) {
          this.sendError(websocket, "UNAUTHORIZED", "登录状态已失效，请重新登录", message.requestId);
          websocket.close(4001, "unauthorized");
          return;
        }
        if (client.userId && client.userId !== user.id) this.removeClient(client);
        client.userId = user.id;
        clearTimeout(client.authTimer);
        client.authTimer = null;
        let set = this.clients.get(user.id);
        if (!set) {
          set = new Set();
          this.clients.set(user.id, set);
        }
        set.add(client);
        const connectedRooms = this.store.setRoomUserConnected(user.id, true, this.now()) ?? [];
        this.send(websocket, { version: 1, type: "session.ready", payload: { user, serverAt: this.now() } });
        for (const room of connectedRooms) this.broadcastToRoom(room, { type: "room.updated", room });
        return;
      }

      if (!client.userId) {
        this.sendError(websocket, "UNAUTHORIZED", "实时连接需要登录", message.requestId);
        return;
      }

      if (message.type === "ping") {
        this.send(websocket, { version: 1, type: "pong", requestId: message.requestId, payload: { serverAt: this.now() } });
        return;
      }

      if (message.type !== "game.move.submit") {
        this.sendError(websocket, "INVALID_INPUT", "不支持的实时操作", message.requestId);
        return;
      }

      const requestId = typeof message.requestId === "string" ? message.requestId.slice(0, 100) : "";
      try {
        if (!requestId) {
          this.sendError(websocket, "INVALID_INPUT", "实时操作缺少请求编号");
          return;
        }
        const roomId = typeof message.roomId === "string" ? message.roomId : "";
        const move = moveInput(message.payload?.move);
        move.roomId = roomId;
        const result = this.store.sendMove(roomId, client.userId, move, this.now());
        // The move delta is the live path. The full snapshot follows as an
        // authoritative reconciliation and supports older connected clients.
        this.broadcastToRoom(result.room, { type: "game.move", move: result.move, requestId });
        this.broadcastToRoom(result.room, { type: "room.updated", room: result.room });
      } catch (error) {
        const safe = asAppError(error);
        this.sendError(websocket, safe.code, safe.message, requestId || message.requestId);
      }
    });
    websocket.on("close", () => this.removeClient(client));
    websocket.on("error", () => this.removeClient(client));
  }

  removeClient(client) {
    if (client.authTimer) clearTimeout(client.authTimer);
    client.authTimer = null;
    if (!client.userId) return;
    const set = this.clients.get(client.userId);
    set?.delete(client);
    if (set && set.size === 0) {
      this.clients.delete(client.userId);
      const disconnectedRooms = this.store.setRoomUserConnected(client.userId, false, this.now()) ?? [];
      for (const room of disconnectedRooms) this.broadcastToRoom(room, { type: "room.updated", room });
    }
    client.userId = null;
  }

  activeUserIds() {
    return new Set(this.clients.keys());
  }

  send(websocket, value) {
    if (websocket.readyState === websocket.OPEN || websocket.readyState === 1) {
      try { websocket.send(JSON.stringify(value)); } catch { /* the close handler removes dead sockets */ }
    }
  }

  sendError(websocket, code, message, requestId) {
    this.send(websocket, { version: 1, type: "error", requestId, payload: { code, message } });
  }

  broadcastToUsers(userIds, event) {
    const envelope = envelopeFor(event);
    if (!envelope) return;
    const uniqueIds = new Set(userIds.filter(Boolean));
    for (const userId of uniqueIds) {
      for (const client of this.clients.get(userId) ?? []) this.send(client.websocket, envelope);
    }
  }

  broadcastToRoom(room, event) {
    const userIds = Object.values(room.players ?? {}).map((player) => player?.user?.id).filter(Boolean);
    this.broadcastToUsers(userIds, event);
  }

  close() {
    for (const clients of this.clients.values()) {
      for (const client of clients) {
        if (client.authTimer) clearTimeout(client.authTimer);
        client.websocket.terminate();
      }
    }
    this.clients.clear();
    if (this.wss) {
      try { this.wss.close(); } catch { /* already closed */ }
    }
    this.wss = null;
    this.server = null;
  }
}

export { envelopeFor };
