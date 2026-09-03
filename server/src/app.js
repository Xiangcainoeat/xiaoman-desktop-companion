import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { AppError, asAppError } from "./errors.js";
import { gameId, moveInput } from "./game-protocol.js";
import { createSessionToken, hashPassword, hashSessionToken, verifyPassword } from "./security.js";
import { RealtimeHub } from "./realtime.js";
import { SocialStore } from "./store.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_DISPLAY_NAME_LENGTH = 40;
const MAX_USERNAME_LENGTH = 32;
const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:61950",
  "http://127.0.0.1:61950",
  "http://47.97.219.242:18080",
  "null",
];

function now() { return Date.now(); }

function parseCookies(header) {
  const cookies = {};
  for (const chunk of String(header ?? "").split(";")) {
    const separator = chunk.indexOf("=");
    if (separator < 0) continue;
    const key = chunk.slice(0, separator).trim();
    if (!key) continue;
    try { cookies[key] = decodeURIComponent(chunk.slice(separator + 1).trim()); } catch { /* ignore malformed cookies */ }
  }
  return cookies;
}

function requestToken(request) {
  const authorization = request.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (bearer?.[1]) return bearer[1];
  return parseCookies(request.headers.cookie).xiaoman_session ?? null;
}

function originForRequest(request, configuredOrigin) {
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, "");
  const forwarded = String(request.get("x-forwarded-proto") ?? "").split(",")[0].trim();
  const protocol = forwarded || request.protocol || "http";
  return `${protocol}://${request.get("host")}`.replace(/\/$/, "");
}

function sessionUserFor(user) {
  if (!user || typeof user !== "object") return null;
  const value = user;
  const id = typeof value.id === "string" ? value.id : "";
  const username = typeof value.username === "string" ? value.username : "";
  const displayNameValue = typeof value.displayName === "string"
    ? value.displayName
    : typeof value.display_name === "string" ? value.display_name : "";
  const avatarValue = value.avatarUrl ?? value.avatar_url ?? null;
  if (!id || !username) return null;
  return {
    id,
    username,
    displayName: displayNameValue.trim() || username,
    avatarUrl: avatarValue === null || typeof avatarValue === "string" ? avatarValue : null,
  };
}

function sessionFor(user, request, timestamp, configuredOrigin) {
  return {
    authState: user ? "authenticated" : "guest",
    user: sessionUserFor(user),
    serverOrigin: originForRequest(request, configuredOrigin),
    transport: "server",
    connection: "connected",
    lastConnectedAt: timestamp,
  };
}

function parseAllowedOrigins(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const raw = String(value ?? "").trim();
  if (!raw) return DEFAULT_CORS_ORIGINS;
  return raw ? raw.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function applyCors(request, response, allowedOrigins) {
  const origin = request.get("origin");
  if (!origin) return;
  if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("access-control-allow-credentials", "true");
    response.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
    response.setHeader("access-control-allow-headers", "Accept, Content-Type, Authorization, X-Request-Id");
    response.setHeader("access-control-max-age", "600");
    response.setHeader("vary", "Origin");
  }
}

function setSessionCookie(response, token, secure) {
  const securePart = secure ? "; Secure" : "";
  response.setHeader("set-cookie", `xiaoman_session=${encodeURIComponent(token)}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/; HttpOnly; SameSite=Lax${securePart}`);
}

function clearSessionCookie(response, secure) {
  const securePart = secure ? "; Secure" : "";
  response.setHeader("set-cookie", `xiaoman_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${securePart}`);
}

function text(value, field, maxLength) {
  if (typeof value !== "string") throw new AppError("INVALID_INPUT", `${field}格式无效`, 400);
  const result = value.trim();
  if (!result || result.length > maxLength) throw new AppError("INVALID_INPUT", `${field}不能为空且不能超过 ${maxLength} 个字符`, 400);
  return result;
}

function username(value) {
  const result = text(value, "账号", MAX_USERNAME_LENGTH);
  if (result.length < 3 || !/^[\p{L}\p{N}_][\p{L}\p{N}_-]*$/u.test(result)) {
    throw new AppError("INVALID_INPUT", "账号需为 3-32 位字母、数字、下划线或短横线", 400);
  }
  return result;
}

function password(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new AppError("INVALID_INPUT", "密码长度需要为 8-128 位", 400);
  }
  return value;
}

function displayName(value) {
  return text(value, "显示名称", MAX_DISPLAY_NAME_LENGTH);
}

function bodyObject(request) {
  return request.body && typeof request.body === "object" && !Array.isArray(request.body) ? request.body : {};
}

function scopeFromQuery(value) {
  if (typeof value !== "string") throw new AppError("INVALID_INPUT", "聊天范围无效", 400);
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) throw new AppError("INVALID_INPUT", "聊天范围无效", 400);
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (kind === "direct") return { kind: "direct", friendId: id };
  if (kind === "group") return { kind: "group", groupId: id };
  throw new AppError("INVALID_INPUT", "聊天范围无效", 400);
}

function scopeFromBody(value) {
  if (!value || typeof value !== "object") throw new AppError("INVALID_INPUT", "聊天范围无效", 400);
  if (value.kind === "direct" && typeof value.friendId === "string" && value.friendId) return { kind: "direct", friendId: value.friendId };
  if (value.kind === "group" && typeof value.groupId === "string" && value.groupId) return { kind: "group", groupId: value.groupId };
  throw new AppError("INVALID_INPUT", "聊天范围无效", 400);
}

function booleanField(value, field) {
  if (typeof value !== "boolean") throw new AppError("INVALID_INPUT", `${field}格式无效`, 400);
  return value;
}

export function createSocialServer(options = {}) {
  const timestamp = options.now ?? now;
  const dbPath = options.dbPath ?? process.env.SOCIAL_DB_PATH ?? "/data/social.sqlite";
  const staticDir = options.staticDir === undefined
    ? resolve(dirname(fileURLToPath(import.meta.url)), "../public")
    : options.staticDir;
  const configuredOrigin = String(options.publicOrigin ?? process.env.SOCIAL_PUBLIC_ORIGIN ?? "").trim() || null;
  const allowedOrigins = parseAllowedOrigins(options.corsOrigins ?? process.env.SOCIAL_CORS_ORIGINS ?? DEFAULT_CORS_ORIGINS);
  const cookieSecure = options.cookieSecure ?? process.env.SOCIAL_COOKIE_SECURE === "true";
  const logger = options.logger === false ? null : options.logger ?? console;
  const store = options.store ?? new SocialStore(dbPath);
  const hub = options.hub ?? new RealtimeHub({ store, now: timestamp });
  const roomCleanupIntervalMs = options.roomCleanupIntervalMs ?? 60_000;
  const roomCleanupTimer = roomCleanupIntervalMs > 0
    ? setInterval(() => {
      try {
        store.cleanupExpiredRooms?.(timestamp());
      } catch (error) {
        logger?.error?.(`[xiaoman-social] room cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, roomCleanupIntervalMs)
    : null;
  roomCleanupTimer?.unref?.();
  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    applyCors(request, response, allowedOrigins);
    if (request.method === "OPTIONS") { response.status(204).end(); return; }
    const requestId = request.get("x-request-id")?.slice(0, 80) || `req_${randomUUID()}`;
    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);
    const started = timestamp();
    response.on("finish", () => {
      if (logger?.info) logger.info(`[xiaoman-social] ${request.method} ${request.originalUrl} ${response.statusCode} ${timestamp() - started}ms`);
    });
    next();
  });
  app.use(express.json({ limit: "256kb" }));

  const authenticate = (request) => {
    const token = requestToken(request);
    if (!token) return null;
    const user = store.userForSession(hashSessionToken(token), timestamp());
    if (!user) return null;
    return { user, token, tokenHash: hashSessionToken(token) };
  };

  const requireAuth = (request, _response, next) => {
    const auth = authenticate(request);
    if (!auth) { next(new AppError("UNAUTHORIZED", "请先登录后使用联机房间功能", 401)); return; }
    request.auth = auth;
    next();
  };

  const cleanupRooms = (_request, _response, next) => {
    try {
      store.cleanupExpiredRooms?.(timestamp());
      next();
    } catch (error) {
      next(error);
    }
  };

  const sendData = (response, data, status = 200) => response.status(status).json({ data });
  const sendError = (response, error) => {
    const safe = asAppError(error);
    response.status(safe.status).json({ error: { code: safe.code, message: safe.message } });
  };

  app.get("/healthz", (_request, response) => response.json({ ok: true, service: "xiaoman-social" }));

  app.get("/api/v1/session", (request, response) => {
    const auth = authenticate(request);
    sendData(response, sessionFor(auth?.user ?? null, request, timestamp(), configuredOrigin));
  });

  app.post("/api/v1/auth/register", (request, response, next) => {
    try {
      const input = bodyObject(request);
      const account = username(input.username);
      const secret = password(input.password);
      const name = displayName(input.displayName);
      const created = store.createUser({ username: account, displayName: name, passwordHash: hashPassword(secret), now: timestamp() });
      const token = createSessionToken();
      store.createSession(created.id, hashSessionToken(token), timestamp(), timestamp() + SESSION_TTL_MS);
      setSessionCookie(response, token, cookieSecure);
      sendData(response, { token, session: sessionFor(created, request, timestamp(), configuredOrigin) });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/login", (request, response, next) => {
    try {
      const input = bodyObject(request);
      const account = username(input.username);
      const secret = password(input.password);
      const record = store.findUserByUsername(account);
      if (!record || !verifyPassword(secret, record.password_hash)) throw new AppError("INVALID_CREDENTIALS", "账号或密码错误", 401);
      const user = store.findUserById(record.id);
      const token = createSessionToken();
      const timestampNow = timestamp();
      store.createSession(user.id, hashSessionToken(token), timestampNow, timestampNow + SESSION_TTL_MS);
      setSessionCookie(response, token, cookieSecure);
      sendData(response, { token, session: sessionFor(user, request, timestampNow, configuredOrigin) });
    } catch (error) { next(error); }
  });

  app.post("/api/v1/auth/logout", (request, response) => {
    const token = requestToken(request);
    if (token) store.revokeSession(hashSessionToken(token));
    clearSessionCookie(response, cookieSecure);
    response.status(204).end();
  });

  app.use("/api/v1", requireAuth);
  app.use("/api/v1/game-rooms", cleanupRooms);
  app.use("/api/v1/invites", cleanupRooms);

  app.get("/api/v1/users/search", (request, response, next) => {
    try {
      const query = text(request.query.q ?? "", "搜索内容", 80);
      sendData(response, { items: store.searchUsers(query, request.auth.user.id) });
    } catch (error) { next(error); }
  });

  app.get("/api/v1/friends", (request, response) => {
    sendData(response, { items: store.listFriends(request.auth.user.id, timestamp(), hub.activeUserIds()) });
  });

  app.get("/api/v1/friend-requests", (request, response) => {
    sendData(response, { items: store.listFriendRequests(request.auth.user.id) });
  });

  app.post("/api/v1/friend-requests", (request, response, next) => {
    try {
      const targetId = text(bodyObject(request).userId, "用户", 100);
      const friendRequest = store.createFriendRequest(request.auth.user.id, targetId, timestamp());
      hub.broadcastToUsers([friendRequest.from.id, friendRequest.to.id], { type: "friend-request.created", request: friendRequest });
      sendData(response, friendRequest);
    } catch (error) { next(error); }
  });

  app.patch("/api/v1/friend-requests/:requestId", (request, response, next) => {
    try {
      const choice = bodyObject(request).response;
      const friendRequest = store.respondFriendRequest(request.params.requestId, request.auth.user.id, choice, timestamp());
      hub.broadcastToUsers([friendRequest.from.id, friendRequest.to.id], { type: "friend-request.updated", request: friendRequest });
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.get("/api/v1/groups", (request, response) => {
    sendData(response, { items: store.listGroups(request.auth.user.id) });
  });

  app.get("/api/v1/messages", (request, response, next) => {
    try { sendData(response, { items: store.listMessages(request.auth.user.id, scopeFromQuery(request.query.scope)) }); } catch (error) { next(error); }
  });

  app.post("/api/v1/messages", (request, response, next) => {
    try {
      const input = bodyObject(request);
      const body = text(input.body, "消息", MAX_MESSAGE_LENGTH);
      const scope = scopeFromBody(input.scope);
      const message = store.createMessage(request.auth.user.id, scope, body, timestamp());
      const recipients = scope.kind === "direct" ? [request.auth.user.id, scope.friendId] : store.groupMemberIds(scope.groupId);
      hub.broadcastToUsers(recipients, { type: "chat.message", message });
      sendData(response, message);
    } catch (error) { next(error); }
  });

  app.get("/api/v1/invites", (request, response) => {
    sendData(response, { items: store.listInvites(request.auth.user.id, timestamp()) });
  });

  app.post("/api/v1/invites", (request, response, next) => {
    try {
      const input = bodyObject(request);
      const invite = store.createInvite(request.auth.user.id, {
        gameId: gameId(input.gameId),
        toUserId: text(input.toUserId, "好友", 100),
        roomId: input.roomId === null || typeof input.roomId === "string" ? input.roomId ?? null : null,
      }, timestamp());
      hub.broadcastToUsers([invite.from.id, invite.to.id], { type: "invite.created", invite });
      sendData(response, invite);
    } catch (error) { next(error); }
  });

  app.patch("/api/v1/invites/:inviteId", (request, response, next) => {
    try {
      const invite = store.respondInvite(request.params.inviteId, request.auth.user.id, bodyObject(request).response, timestamp());
      hub.broadcastToUsers([invite.from.id, invite.to.id], { type: "invite.updated", invite });
      // Accepting an invite without a pre-created room creates one for the host.
      // Publish that room immediately so the inviter can restore it without polling.
      if (invite.status === "accepted" && invite.roomId) {
        const room = store.roomById(invite.roomId);
        if (room) hub.broadcastToRoom(room, { type: "room.updated", room });
      }
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.get("/api/v1/game-rooms", (request, response) => {
    sendData(response, { items: store.listRooms(request.auth.user.id, timestamp()) });
  });

  app.get("/api/v1/game-rooms/:roomId", (request, response, next) => {
    try {
      store.assertRoomPlayer(request.params.roomId, request.auth.user.id);
      const room = store.roomById(request.params.roomId);
      if (!room) throw new AppError("ROOM_NOT_FOUND", "找不到这个游戏房间", 404);
      sendData(response, room);
    } catch (error) { next(error); }
  });

  app.post("/api/v1/game-rooms", (request, response, next) => {
    try {
      const room = store.createRoom(request.auth.user.id, gameId(bodyObject(request).gameId), timestamp());
      hub.broadcastToRoom(room, { type: "room.updated", room });
      sendData(response, room);
    } catch (error) { next(error); }
  });

  app.post("/api/v1/game-rooms/:roomId/join", (request, response, next) => {
    try {
      const room = store.joinRoom(request.auth.user.id, request.params.roomId, timestamp());
      hub.broadcastToRoom(room, { type: "room.updated", room });
      sendData(response, room);
    } catch (error) { next(error); }
  });

  app.post("/api/v1/game-rooms/:roomId/ready", (request, response, next) => {
    try {
      const room = store.setReady(request.params.roomId, request.auth.user.id, booleanField(bodyObject(request).ready, "准备状态"), timestamp());
      hub.broadcastToRoom(room, { type: "room.updated", room });
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.post("/api/v1/game-rooms/:roomId/moves", (request, response, next) => {
    try {
      const move = moveInput(bodyObject(request));
      move.roomId = request.params.roomId;
      const result = store.sendMove(request.params.roomId, request.auth.user.id, move, timestamp());
      hub.broadcastToRoom(result.room, { type: "room.updated", room: result.room });
      hub.broadcastToRoom(result.room, { type: "game.move", move: result.move });
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.post("/api/v1/game-rooms/:roomId/undo-request", (request, response, next) => {
    try {
      const room = store.requestUndo(request.params.roomId, request.auth.user.id, timestamp());
      hub.broadcastToRoom(room, { type: "room.updated", room });
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.post("/api/v1/game-rooms/:roomId/undo-response", (request, response, next) => {
    try {
      const accept = booleanField(bodyObject(request).accept, "悔棋决定");
      const room = store.respondUndo(request.params.roomId, request.auth.user.id, accept, timestamp());
      hub.broadcastToRoom(room, { type: "room.updated", room });
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.post("/api/v1/game-rooms/:roomId/resign", (request, response, next) => {
    try {
      const room = store.resign(request.params.roomId, request.auth.user.id, timestamp());
      hub.broadcastToRoom(room, { type: "room.updated", room });
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.delete("/api/v1/game-rooms/:roomId", (request, response, next) => {
    try {
      const room = store.leaveRoom(request.params.roomId, request.auth.user.id, timestamp());
      hub.broadcastToRoom(room, { type: "room.updated", room });
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.post("/api/v1/game-rooms/:roomId/rematch", (request, response, next) => {
    try {
      const room = store.rematch(request.params.roomId, request.auth.user.id, timestamp());
      hub.broadcastToRoom(room, { type: "room.updated", room });
      response.status(204).end();
    } catch (error) { next(error); }
  });

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: "index.html", fallthrough: true }));
    app.use((request, response, next) => {
      if (request.method === "GET" && !request.path.startsWith("/api/") && request.path !== "/healthz") {
        response.sendFile(join(staticDir, "index.html"), (error) => { if (error) next(error); });
      } else next();
    });
  }

  app.use((request, response) => {
    if (request.path.startsWith("/api/")) { sendError(response, new AppError("NOT_FOUND", "找不到这个接口", 404)); return; }
    response.status(404).type("text").send("Not found");
  });
  app.use((error, _request, response, _next) => {
    if (response.headersSent) return;
    sendError(response, error);
  });

  const server = createServer(app);
  hub.attach(server);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    if (roomCleanupTimer) clearInterval(roomCleanupTimer);
    hub.close();
    await new Promise((resolveClose) => {
      if (!server.listening) { resolveClose(); return; }
      server.close(() => resolveClose());
    });
    store.close();
  };
  return { app, server, store, hub, close };
}
