import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AppError } from "./errors.js";
import {
  initialPosition as initialOnlinePosition,
  SUPPORTED_GAME_IDS,
  validateAndApplyMove,
} from "./online-game-rules.js";

const DEFAULT_GROUP_ID = "group-pet-lab";
const DEFAULT_GROUP_NAME = "桌宠实验室";
const MAX_POSITION_LENGTH = 500_000;
const GOMOKU_SIZE = 15;
const GOMOKU_POSITION_LENGTH = GOMOKU_SIZE * GOMOKU_SIZE;
/** Rooms are retained for one hour after their last meaningful activity. */
const ROOM_IDLE_TTL_MS = 60 * 60 * 1000;

function initialPosition(gameId) { return initialOnlinePosition(gameId); }

function validGomokuPoint(point) {
  return Number.isInteger(point?.x) && Number.isInteger(point?.y)
    && point.x >= 0 && point.x < GOMOKU_SIZE && point.y >= 0 && point.y < GOMOKU_SIZE;
}

function validGomokuPosition(position) {
  return typeof position === "string"
    && position.length === GOMOKU_POSITION_LENGTH
    && /^[012]+$/.test(position);
}

function gomokuWinner(position, point, marker) {
  const indexAt = (x, y) => position[y * GOMOKU_SIZE + x];
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dx, dy] of directions) {
    let count = 1;
    for (const sign of [1, -1]) {
      let x = point.x + dx * sign;
      let y = point.y + dy * sign;
      while (x >= 0 && x < GOMOKU_SIZE && y >= 0 && y < GOMOKU_SIZE && indexAt(x, y) === marker) {
        count += 1;
        x += dx * sign;
        y += dy * sign;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}

function gomokuBoardFull(position) {
  return validGomokuPosition(position) && !position.includes("0");
}

const SCHEMA = `
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS friendships (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_id),
    CHECK (user_id <> friend_id)
  );
  CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY,
    from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK (from_user_id <> to_user_id)
  );
  CREATE INDEX IF NOT EXISTS friend_requests_from_idx ON friend_requests(from_user_id, status);
  CREATE INDEX IF NOT EXISTS friend_requests_to_idx ON friend_requests(to_user_id, status);
  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    accent TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('direct', 'group')),
    scope_id TEXT NOT NULL,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_scope_idx ON messages(scope_kind, scope_id, created_at);
  CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    CHECK (from_user_id <> to_user_id)
  );
  CREATE INDEX IF NOT EXISTS invites_user_idx ON invites(to_user_id, status, created_at);
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    game_id TEXT NOT NULL,
    host_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('waiting', 'ready', 'playing', 'paused', 'finished', 'left')),
    turn TEXT NOT NULL CHECK (turn IN ('red', 'black')),
    seq INTEGER NOT NULL,
    position TEXT NOT NULL,
    last_move_json TEXT,
    winner TEXT CHECK (winner IS NULL OR winner IN ('red', 'black')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rooms_updated_idx ON rooms(updated_at);
  CREATE TABLE IF NOT EXISTS room_players (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seat TEXT NOT NULL CHECK (seat IN ('red', 'black')),
    ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0, 1)),
    connected INTEGER NOT NULL DEFAULT 0 CHECK (connected IN (0, 1)),
    PRIMARY KEY (room_id, user_id),
    UNIQUE (room_id, seat)
  );
  CREATE INDEX IF NOT EXISTS room_players_user_idx ON room_players(user_id);
  CREATE TABLE IF NOT EXISTS room_moves (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    move_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, seq)
  );
  CREATE TABLE IF NOT EXISTS room_undo_requests (
    room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS room_rematch_requests (
    room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_at INTEGER NOT NULL
  );
`;

const PUBLIC_USER_COLUMNS = `
  u.id AS user_id,
  u.username AS user_username,
  u.display_name AS user_display_name,
  u.avatar_url AS user_avatar_url
`;

function publicUser(row, prefix = "user_") {
  return {
    id: row[`${prefix}id`],
    username: row[`${prefix}username`],
    displayName: row[`${prefix}display_name`],
    avatarUrl: row[`${prefix}avatar_url`] ?? null,
  };
}

function userFromPlainRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? null,
  };
}

function requestFromRow(row) {
  if (!row) return null;
  return {
    id: row.request_id,
    from: {
      id: row.from_id,
      username: row.from_username,
      displayName: row.from_display_name,
      avatarUrl: row.from_avatar_url ?? null,
    },
    to: {
      id: row.to_id,
      username: row.to_username,
      displayName: row.to_display_name,
      avatarUrl: row.to_avatar_url ?? null,
    },
    status: row.request_status,
    createdAt: row.request_created_at,
    updatedAt: row.request_updated_at,
  };
}

function directScopeId(left, right) {
  return [left, right].sort().join(":");
}

function parseJson(value, fallback = null) {
  if (typeof value !== "string" || !value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function bool(value) { return Number(value) === 1; }

export class SocialStore {
  constructor(dbPath = ":memory:") {
    if (dbPath !== ":memory:") mkdirSync(dirname(resolve(dbPath)), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
    this.db.exec(`INSERT OR IGNORE INTO groups (id, name, accent, created_at) VALUES ('${DEFAULT_GROUP_ID}', '${DEFAULT_GROUP_NAME}', 'sage', strftime('%s','now') * 1000)`);
  }

  close() {
    this.db.close();
  }

  transaction(callback) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve the original database error */ }
      throw error;
    }
  }

  exportAuthRowsForTest() {
    return this.db.prepare("SELECT username, password_hash FROM users ORDER BY username").all();
  }

  findUserByUsername(username) {
    return this.db.prepare("SELECT id, username, display_name, avatar_url, password_hash FROM users WHERE username = ? COLLATE NOCASE").get(username) ?? null;
  }

  findUserById(id) {
    const row = this.db.prepare("SELECT id, username, display_name, avatar_url FROM users WHERE id = ?").get(id) ?? null;
    return userFromPlainRow(row);
  }

  createUser({ username, displayName, passwordHash, now }) {
    const id = `user-${randomUUID()}`;
    try {
      this.transaction(() => {
        this.db.prepare("INSERT INTO users (id, username, display_name, avatar_url, password_hash, created_at, last_seen_at) VALUES (?, ?, ?, NULL, ?, ?, ?)").run(id, username, displayName, passwordHash, now, now);
        this.db.prepare("INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)").run(DEFAULT_GROUP_ID, id, now);
      });
    } catch (error) {
      if (String(error?.message ?? "").includes("UNIQUE constraint failed: users.username")) {
        throw new AppError("USERNAME_TAKEN", "这个账号已经注册", 409);
      }
      throw error;
    }
    return this.findUserById(id);
  }

  userForSession(tokenHash, now) {
    const row = this.db.prepare(`
      SELECT u.id, u.username, u.display_name, u.avatar_url
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(tokenHash, now) ?? null;
    if (!row) return null;
    this.db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(now, row.id);
    return userFromPlainRow({ ...row, display_name: row.display_name, avatar_url: row.avatar_url });
  }

  createSession(userId, tokenHash, now, expiresAt) {
    this.db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(tokenHash, userId, now, expiresAt);
  }

  revokeSession(tokenHash) {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  purgeExpiredSessions(now) {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  }

  searchUsers(query, currentUserId) {
    const pattern = `%${query.trim()}%`;
    const rows = this.db.prepare(`
      SELECT id, username, display_name, avatar_url
      FROM users
      WHERE id <> ? AND (username LIKE ? COLLATE NOCASE OR display_name LIKE ?)
      ORDER BY display_name COLLATE NOCASE, username COLLATE NOCASE
      LIMIT 30
    `).all(currentUserId, pattern, pattern);
    return rows.map(userFromPlainRow);
  }

  friendshipExists(userId, friendId) {
    return Boolean(this.db.prepare("SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?").get(userId, friendId)
      || this.db.prepare("SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?").get(friendId, userId));
  }

  listFriends(userId, now, onlineUserIds = new Set()) {
    const rows = this.db.prepare(`
      SELECT ${PUBLIC_USER_COLUMNS}, u.last_seen_at
      FROM friendships f JOIN users u ON u.id = f.friend_id
      WHERE f.user_id = ?
      ORDER BY u.display_name COLLATE NOCASE
    `).all(userId);
    return rows.map((row) => {
      const lastSeenAt = Number(row.last_seen_at) || null;
      const presence = onlineUserIds.has(row.user_id)
        ? "online"
        : lastSeenAt && now - lastSeenAt < 10 * 60_000 ? "away" : "offline";
      return {
        id: row.user_id,
        user: publicUser(row),
        presence,
        lastSeenAt,
        unreadCount: 0,
      };
    });
  }

  listFriendRequests(userId) {
    const rows = this.db.prepare(`
      SELECT
        fr.id AS request_id, fr.status AS request_status,
        fr.created_at AS request_created_at, fr.updated_at AS request_updated_at,
        fu.id AS from_id, fu.username AS from_username, fu.display_name AS from_display_name, fu.avatar_url AS from_avatar_url,
        tu.id AS to_id, tu.username AS to_username, tu.display_name AS to_display_name, tu.avatar_url AS to_avatar_url
      FROM friend_requests fr
      JOIN users fu ON fu.id = fr.from_user_id
      JOIN users tu ON tu.id = fr.to_user_id
      WHERE fr.from_user_id = ? OR fr.to_user_id = ?
      ORDER BY fr.updated_at DESC
    `).all(userId, userId);
    return rows.map(requestFromRow);
  }

  createFriendRequest(fromUserId, toUserId, now) {
    if (fromUserId === toUserId) throw new AppError("INVALID_INPUT", "不能给自己发送好友请求", 400);
    const target = this.findUserById(toUserId);
    if (!target) throw new AppError("FRIEND_NOT_FOUND", "找不到这个用户", 404);
    if (this.friendshipExists(fromUserId, toUserId)) throw new AppError("FRIEND_REQUEST_EXISTS", "你们已经是好友", 409);
    const existing = this.db.prepare(`
      SELECT id FROM friend_requests
      WHERE ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
        AND status IN ('pending', 'accepted')
      LIMIT 1
    `).get(fromUserId, toUserId, toUserId, fromUserId);
    if (existing) throw new AppError("FRIEND_REQUEST_EXISTS", "重复的好友请求已经存在或正在处理中", 409);
    const id = `friend-request-${randomUUID()}`;
    this.db.prepare("INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)").run(id, fromUserId, toUserId, now, now);
    return this.friendRequestById(id);
  }

  friendRequestById(id) {
    const row = this.db.prepare(`
      SELECT
        fr.id AS request_id, fr.status AS request_status,
        fr.created_at AS request_created_at, fr.updated_at AS request_updated_at,
        fu.id AS from_id, fu.username AS from_username, fu.display_name AS from_display_name, fu.avatar_url AS from_avatar_url,
        tu.id AS to_id, tu.username AS to_username, tu.display_name AS to_display_name, tu.avatar_url AS to_avatar_url
      FROM friend_requests fr
      JOIN users fu ON fu.id = fr.from_user_id
      JOIN users tu ON tu.id = fr.to_user_id
      WHERE fr.id = ?
    `).get(id) ?? null;
    return requestFromRow(row);
  }

  respondFriendRequest(id, actorId, response, now) {
    const row = this.db.prepare("SELECT id, from_user_id, to_user_id, status FROM friend_requests WHERE id = ?").get(id) ?? null;
    if (!row) throw new AppError("FRIEND_NOT_FOUND", "找不到这条好友请求", 404);
    if (row.to_user_id !== actorId || row.status !== "pending") {
      throw new AppError("INVALID_FRIEND_REQUEST_STATE", "只有接收方可以处理当前好友请求", 409);
    }
    if (response !== "accept" && response !== "decline") throw new AppError("INVALID_INPUT", "好友请求操作无效", 400);
    this.transaction(() => {
      this.db.prepare("UPDATE friend_requests SET status = ?, updated_at = ? WHERE id = ?").run(response === "accept" ? "accepted" : "declined", now, id);
      if (response === "accept") {
        this.db.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)").run(row.from_user_id, row.to_user_id, now);
        this.db.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)").run(row.to_user_id, row.from_user_id, now);
      }
    });
    return this.friendRequestById(id);
  }

  listGroups(userId) {
    const rows = this.db.prepare(`
      SELECT g.id, g.name, g.accent,
        (SELECT COUNT(*) FROM group_members gm2 WHERE gm2.group_id = g.id) AS member_count
      FROM groups g JOIN group_members gm ON gm.group_id = g.id
      WHERE gm.user_id = ?
      ORDER BY g.created_at, g.name
    `).all(userId);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      memberCount: Number(row.member_count),
      memberIds: this.db.prepare("SELECT user_id FROM group_members WHERE group_id = ? ORDER BY joined_at").all(row.id).map((member) => member.user_id),
      accent: row.accent,
      unreadCount: 0,
    }));
  }

  groupMember(groupId, userId) {
    return Boolean(this.db.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?").get(groupId, userId));
  }

  groupMemberIds(groupId) {
    return this.db.prepare("SELECT user_id FROM group_members WHERE group_id = ? ORDER BY joined_at").all(groupId).map((row) => row.user_id);
  }

  messageFromRow(row, currentUserId, directFriendId = null) {
    const scope = row.scope_kind === "group"
      ? { kind: "group", groupId: row.scope_id }
      : { kind: "direct", friendId: directFriendId ?? (row.sender_id === currentUserId ? row.other_user_id : row.sender_id) };
    return {
      id: row.message_id,
      scope,
      sender: {
        id: row.sender_id,
        username: row.sender_username,
        displayName: row.sender_display_name,
        avatarUrl: row.sender_avatar_url ?? null,
      },
      body: row.body,
      createdAt: row.created_at,
    };
  }

  listMessages(userId, scope) {
    let scopeId;
    let directFriendId = null;
    if (scope.kind === "direct") {
      directFriendId = scope.friendId;
      if (!this.friendshipExists(userId, directFriendId)) throw new AppError("INVALID_INPUT", "找不到这个好友", 404);
      scopeId = directScopeId(userId, directFriendId);
    } else if (scope.kind === "group") {
      if (!this.groupMember(scope.groupId, userId)) throw new AppError("INVALID_INPUT", "你不在这个群聊中", 403);
      scopeId = scope.groupId;
    } else {
      throw new AppError("INVALID_INPUT", "聊天范围无效", 400);
    }
    const rows = this.db.prepare(`
      SELECT
        m.id AS message_id, m.scope_kind, m.scope_id, m.sender_id, m.body, m.created_at,
        sender.username AS sender_username, sender.display_name AS sender_display_name, sender.avatar_url AS sender_avatar_url,
        CASE WHEN m.sender_id = ? THEN ? ELSE m.sender_id END AS other_user_id
      FROM messages m JOIN users sender ON sender.id = m.sender_id
      WHERE m.scope_kind = ? AND m.scope_id = ?
      ORDER BY m.created_at, m.id
      LIMIT 500
    `).all(userId, directFriendId, scope.kind, scopeId);
    return rows.map((row) => this.messageFromRow(row, userId, directFriendId));
  }

  createMessage(userId, scope, body, now) {
    let scopeId;
    if (scope.kind === "direct") {
      if (!this.friendshipExists(userId, scope.friendId)) throw new AppError("INVALID_INPUT", "找不到这个好友", 404);
      scopeId = directScopeId(userId, scope.friendId);
    } else if (scope.kind === "group") {
      if (!this.groupMember(scope.groupId, userId)) throw new AppError("INVALID_INPUT", "你不在这个群聊中", 403);
      scopeId = scope.groupId;
    } else {
      throw new AppError("INVALID_INPUT", "聊天范围无效", 400);
    }
    const id = `message-${randomUUID()}`;
    this.db.prepare("INSERT INTO messages (id, scope_kind, scope_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, scope.kind, scopeId, userId, body, now);
    const rows = this.db.prepare(`
      SELECT
        m.id AS message_id, m.scope_kind, m.scope_id, m.sender_id, m.body, m.created_at,
        sender.username AS sender_username, sender.display_name AS sender_display_name, sender.avatar_url AS sender_avatar_url,
        CASE WHEN m.sender_id = ? THEN ? ELSE m.sender_id END AS other_user_id
      FROM messages m JOIN users sender ON sender.id = m.sender_id WHERE m.id = ?
    `).get(userId, scope.kind === "direct" ? scope.friendId : null, id);
    return this.messageFromRow(rows, userId, scope.kind === "direct" ? scope.friendId : null);
  }

  listInvites(userId, now) {
    const rows = this.db.prepare(`
      SELECT i.*, fu.id AS from_id, fu.username AS from_username, fu.display_name AS from_display_name, fu.avatar_url AS from_avatar_url,
        tu.id AS to_id, tu.username AS to_username, tu.display_name AS to_display_name, tu.avatar_url AS to_avatar_url
      FROM invites i JOIN users fu ON fu.id = i.from_user_id JOIN users tu ON tu.id = i.to_user_id
      WHERE i.from_user_id = ? OR i.to_user_id = ? ORDER BY i.created_at DESC
    `).all(userId, userId);
    return rows.map((row) => ({
      id: row.id,
      gameId: row.game_id,
      from: { id: row.from_id, username: row.from_username, displayName: row.from_display_name, avatarUrl: row.from_avatar_url ?? null },
      to: { id: row.to_id, username: row.to_username, displayName: row.to_display_name, avatarUrl: row.to_avatar_url ?? null },
      roomId: row.room_id ?? null,
      status: row.status === "pending" && now >= row.expires_at ? "expired" : row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));
  }

  createInvite(userId, { gameId, toUserId, roomId = null }, now) {
    if (!SUPPORTED_GAME_IDS.has(gameId)) throw new AppError("INVALID_INPUT", "这个游戏暂不支持联机房间", 400);
    if (!this.friendshipExists(userId, toUserId)) throw new AppError("INVALID_INPUT", "只能邀请好友", 403);
    if (roomId !== null) {
      const room = this.db.prepare("SELECT id, game_id FROM rooms WHERE id = ?").get(roomId) ?? null;
      if (!room) throw new AppError("ROOM_NOT_FOUND", "找不到要邀请进入的房间", 404);
      if (room.game_id !== gameId) throw new AppError("INVALID_INPUT", "邀请的游戏类型与房间不匹配", 400);
      this.assertRoomPlayer(roomId, userId);
    }
    const id = `invite-${randomUUID()}`;
    const expiresAt = now + 30 * 60_000;
    this.db.prepare("INSERT INTO invites (id, game_id, from_user_id, to_user_id, room_id, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)").run(id, gameId, userId, toUserId, roomId, now, expiresAt);
    return this.inviteById(id, now);
  }

  inviteById(id, now = Date.now()) {
    const row = this.db.prepare(`
      SELECT i.*, fu.id AS from_id, fu.username AS from_username, fu.display_name AS from_display_name, fu.avatar_url AS from_avatar_url,
        tu.id AS to_id, tu.username AS to_username, tu.display_name AS to_display_name, tu.avatar_url AS to_avatar_url
      FROM invites i JOIN users fu ON fu.id = i.from_user_id JOIN users tu ON tu.id = i.to_user_id WHERE i.id = ?
    `).get(id) ?? null;
    if (!row) return null;
    return {
      id: row.id,
      gameId: row.game_id,
      from: { id: row.from_id, username: row.from_username, displayName: row.from_display_name, avatarUrl: row.from_avatar_url ?? null },
      to: { id: row.to_id, username: row.to_username, displayName: row.to_display_name, avatarUrl: row.to_avatar_url ?? null },
      roomId: row.room_id ?? null,
      status: row.status === "pending" && now >= row.expires_at ? "expired" : row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  respondInvite(id, actorId, response, now) {
    this.cleanupExpiredRooms(now);
    const row = this.db.prepare("SELECT id, from_user_id, to_user_id, game_id, room_id, status, expires_at FROM invites WHERE id = ?").get(id) ?? null;
    if (!row) throw new AppError("INVITE_NOT_FOUND", "找不到这条游戏邀请", 404);
    if (row.to_user_id !== actorId || row.status !== "pending") throw new AppError("INVALID_INVITE_STATE", "这条邀请当前不能处理", 409);
    if (now >= row.expires_at) {
      this.db.prepare("UPDATE invites SET status = 'expired' WHERE id = ?").run(id);
      throw new AppError("INVITE_EXPIRED", "这条邀请已经过期", 409);
    }
    if (response !== "accept" && response !== "decline") throw new AppError("INVALID_INPUT", "邀请操作无效", 400);
    this.transaction(() => {
      if (response === "accept" && !row.room_id) {
        const roomId = `room-${randomUUID()}`;
        const code = this.nextRoomCode();
        this.db.prepare("INSERT INTO rooms (id, code, game_id, host_user_id, status, turn, seq, position, last_move_json, winner, created_at, updated_at) VALUES (?, ?, ?, ?, 'waiting', 'red', 0, ?, NULL, NULL, ?, ?)").run(roomId, code, row.game_id, row.from_user_id, initialPosition(row.game_id), now, now);
        this.db.prepare("INSERT INTO room_players (room_id, user_id, seat, ready, connected) VALUES (?, ?, 'red', 0, 1)").run(roomId, row.from_user_id);
        this.db.prepare("UPDATE invites SET status = 'accepted', room_id = ? WHERE id = ?").run(roomId, id);
      } else {
        this.db.prepare("UPDATE invites SET status = ? WHERE id = ?").run(response === "accept" ? "accepted" : "declined", id);
      }
    });
    return this.inviteById(id, now);
  }

  nextRoomCode() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = `XM${Math.floor(100000 + Math.random() * 900000)}`;
      if (!this.db.prepare("SELECT 1 FROM rooms WHERE code = ?").get(code)) return code;
    }
    throw new AppError("ROOM_CREATE_FAILED", "暂时无法生成房间码", 500);
  }

  roomPlayerRows(roomId) {
    return this.db.prepare(`
      SELECT rp.seat, rp.ready, rp.connected,
        u.id AS user_id, u.username AS user_username, u.display_name AS user_display_name, u.avatar_url AS user_avatar_url
      FROM room_players rp JOIN users u ON u.id = rp.user_id WHERE rp.room_id = ? ORDER BY rp.seat
    `).all(roomId);
  }

  roomFromRow(row) {
    if (!row) return null;
    const players = { red: null, black: null };
    const undoRequest = this.db.prepare("SELECT requested_by_user_id, requested_at FROM room_undo_requests WHERE room_id = ?").get(row.id) ?? null;
    const rematchRequest = this.db.prepare("SELECT requested_by_user_id, requested_at FROM room_rematch_requests WHERE room_id = ?").get(row.id) ?? null;
    for (const player of this.roomPlayerRows(row.id)) {
      players[player.seat] = {
        user: { id: player.user_id, username: player.user_username, displayName: player.user_display_name, avatarUrl: player.user_avatar_url ?? null },
        seat: player.seat,
        ready: bool(player.ready),
        connected: bool(player.connected),
      };
    }
    return {
      id: row.id,
      code: row.code,
      gameId: row.game_id,
      hostUserId: row.host_user_id,
      players,
      status: row.status,
      turn: row.turn,
      seq: Number(row.seq),
      position: row.position,
      lastMove: parseJson(row.last_move_json),
      winner: row.winner ?? null,
      undoRequest: undoRequest ? {
        requestedByUserId: undoRequest.requested_by_user_id,
        requestedAt: Number(undoRequest.requested_at),
      } : null,
      rematchRequest: rematchRequest ? {
        requestedByUserId: rematchRequest.requested_by_user_id,
        requestedAt: Number(rematchRequest.requested_at),
      } : null,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      expiresAt: Number(row.updated_at) + ROOM_IDLE_TTL_MS,
    };
  }

  /**
   * Remove idle rooms in one transaction. Room children use foreign-key
   * cascades; invites use a nullable room reference, so they are removed
   * explicitly before the parent row.
   */
  cleanupExpiredRooms(now = Date.now()) {
    const cutoff = now - ROOM_IDLE_TTL_MS;
    const rows = this.db.prepare("SELECT id FROM rooms WHERE updated_at <= ?").all(cutoff);
    if (rows.length === 0) return [];
    const roomIds = rows.map((row) => row.id);
    const placeholders = roomIds.map(() => "?").join(",");
    this.transaction(() => {
      this.db.prepare(`DELETE FROM invites WHERE room_id IN (${placeholders})`).run(...roomIds);
      this.db.prepare(`DELETE FROM rooms WHERE id IN (${placeholders})`).run(...roomIds);
    });
    return roomIds;
  }

  roomById(id) {
    const row = this.db.prepare("SELECT * FROM rooms WHERE id = ?").get(id) ?? null;
    return this.roomFromRow(row);
  }

  roomRowByIdOrCode(value) {
    return this.db.prepare("SELECT * FROM rooms WHERE id = ? OR lower(code) = lower(?)").get(value, value) ?? null;
  }

  assertRoomPlayer(roomId, userId) {
    const room = this.db.prepare("SELECT id FROM rooms WHERE id = ?").get(roomId) ?? null;
    if (!room) throw new AppError("ROOM_NOT_FOUND", "找不到这个游戏房间", 404);
    const player = this.db.prepare("SELECT room_id, user_id, seat, ready, connected FROM room_players WHERE room_id = ? AND user_id = ?").get(roomId, userId) ?? null;
    if (!player) throw new AppError("UNAUTHORIZED", "你不在这个房间里", 403);
    return player;
  }

  roomParticipantIds(roomId) {
    return this.db.prepare("SELECT user_id FROM room_players WHERE room_id = ?").all(roomId).map((row) => row.user_id);
  }

  listRooms(userId, now = Date.now()) {
    this.cleanupExpiredRooms(now);
    const rows = this.db.prepare(`
      SELECT DISTINCT r.* FROM rooms r JOIN room_players rp ON rp.room_id = r.id
      WHERE rp.user_id = ? ORDER BY r.updated_at DESC LIMIT 50
    `).all(userId);
    return rows.map((row) => this.roomFromRow(row));
  }

  createRoom(userId, gameId, now) {
    this.cleanupExpiredRooms(now);
    if (!SUPPORTED_GAME_IDS.has(gameId)) throw new AppError("INVALID_INPUT", "这个游戏暂不支持联机房间", 400);
    const id = `room-${randomUUID()}`;
    const code = this.nextRoomCode();
    this.transaction(() => {
      this.db.prepare("INSERT INTO rooms (id, code, game_id, host_user_id, status, turn, seq, position, last_move_json, winner, created_at, updated_at) VALUES (?, ?, ?, ?, 'waiting', 'red', 0, ?, NULL, NULL, ?, ?)").run(id, code, gameId, userId, initialPosition(gameId), now, now);
      this.db.prepare("INSERT INTO room_players (room_id, user_id, seat, ready, connected) VALUES (?, ?, 'red', 0, 1)").run(id, userId);
    });
    return this.roomById(id);
  }

  joinRoom(userId, value, now) {
    this.cleanupExpiredRooms(now);
    const row = this.roomRowByIdOrCode(value);
    if (!row) throw new AppError("ROOM_NOT_FOUND", "找不到这个游戏房间", 404);
    if (!SUPPORTED_GAME_IDS.has(row.game_id)) throw new AppError("ROOM_NOT_FOUND", "这个游戏房间已不可用", 404);
    if (row.status === "left") throw new AppError("ROOM_NOT_FOUND", "这个游戏房间已结束", 404);
    const existing = this.db.prepare("SELECT seat FROM room_players WHERE room_id = ? AND user_id = ?").get(row.id, userId);
    if (!existing) {
      const black = this.db.prepare("SELECT 1 FROM room_players WHERE room_id = ? AND seat = 'black'").get(row.id);
      if (black) throw new AppError("ROOM_FULL", "这个房间的席位已满", 409);
      this.db.prepare("INSERT INTO room_players (room_id, user_id, seat, ready, connected) VALUES (?, ?, 'black', 0, 1)").run(row.id, userId);
    } else {
      this.db.prepare("UPDATE room_players SET connected = 1 WHERE room_id = ? AND user_id = ?").run(row.id, userId);
    }
    this.db.prepare("UPDATE rooms SET updated_at = ? WHERE id = ?").run(now, row.id);
    return this.roomById(row.id);
  }

  setReady(roomId, userId, ready, now) {
    this.cleanupExpiredRooms(now);
    this.assertRoomPlayer(roomId, userId);
    const room = this.roomById(roomId);
    if (!room || (room.status !== "waiting" && room.status !== "ready")) {
      throw new AppError("INVALID_ROOM_STATE", "当前房间不能更改准备状态", 409);
    }
    const value = ready ? 1 : 0;
    this.db.prepare("UPDATE room_players SET ready = ?, connected = 1 WHERE room_id = ? AND user_id = ?").run(value, roomId, userId);
    const players = this.roomPlayerRows(roomId);
    const bothReady = players.length === 2 && players.every((player) => bool(player.ready));
    const status = bothReady ? "playing" : value ? "ready" : players.some((player) => bool(player.ready)) ? "ready" : "waiting";
    this.db.prepare("UPDATE rooms SET status = ?, updated_at = ? WHERE id = ?").run(status, now, roomId);
    return this.roomById(roomId);
  }

  sendMove(roomId, userId, move, now) {
    this.cleanupExpiredRooms(now);
    return this.transaction(() => {
      // Re-read and validate inside the write transaction so two simultaneous clients
      // cannot both commit the same sequence number.
      const player = this.assertRoomPlayer(roomId, userId);
      const row = this.db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId) ?? null;
      if (!row) throw new AppError("ROOM_NOT_FOUND", "找不到这个游戏房间", 404);
      if (this.db.prepare("SELECT 1 FROM room_undo_requests WHERE room_id = ?").get(roomId)) {
        throw new AppError("INVALID_ROOM_STATE", "请先处理当前悔棋请求", 409);
      }
      if (row.game_id !== move.gameId || row.status !== "playing" || row.turn !== player.seat || move.seat !== player.seat || Number(row.seq) + 1 !== move.seq) {
        throw new AppError("MOVE_REJECTED", "走子序号或回合不匹配，请重新同步棋局", 409);
      }
      const applied = validateAndApplyMove(move.gameId, row.position, move, player.seat);
      const storedMove = { ...move, roomId, createdAt: Number.isFinite(move.createdAt) ? move.createdAt : now };
      this.db.prepare("UPDATE rooms SET status = ?, winner = ?, turn = ?, seq = ?, position = ?, last_move_json = ?, updated_at = ? WHERE id = ?").run(applied.finished ? "finished" : row.status, applied.winner, applied.nextTurn, move.seq, applied.position, JSON.stringify(storedMove), now, roomId);
      this.db.prepare("INSERT INTO room_moves (room_id, seq, move_json, created_at) VALUES (?, ?, ?, ?)").run(roomId, move.seq, JSON.stringify(storedMove), now);
      if (applied.finished) {
        this.db.prepare("UPDATE room_players SET ready = 0 WHERE room_id = ?").run(roomId);
        this.db.prepare("DELETE FROM room_undo_requests WHERE room_id = ?").run(roomId);
        this.db.prepare("DELETE FROM room_rematch_requests WHERE room_id = ?").run(roomId);
      }
      return { room: this.roomById(roomId), move: storedMove };
    });
  }

  requestUndo(roomId, userId, now) {
    this.cleanupExpiredRooms(now);
    return this.transaction(() => {
      const player = this.assertRoomPlayer(roomId, userId);
      const row = this.db.prepare("SELECT status, seq, last_move_json FROM rooms WHERE id = ?").get(roomId) ?? null;
      if (!row) throw new AppError("ROOM_NOT_FOUND", "找不到这个游戏房间", 404);
      const lastMove = parseJson(row.last_move_json);
      if (row.status !== "playing" || Number(row.seq) < 1 || !lastMove) {
        throw new AppError("INVALID_ROOM_STATE", "当前没有可以撤回的落子", 409);
      }
      if (lastMove.seat !== player.seat) {
        throw new AppError("INVALID_ROOM_STATE", "只能由最后落子的一方申请悔棋", 409);
      }
      const pending = this.db.prepare("SELECT requested_by_user_id FROM room_undo_requests WHERE room_id = ?").get(roomId) ?? null;
      if (pending) {
        if (pending.requested_by_user_id === userId) return this.roomById(roomId);
        throw new AppError("INVALID_ROOM_STATE", "已有待处理的悔棋请求", 409);
      }
      this.db.prepare("INSERT INTO room_undo_requests (room_id, requested_by_user_id, requested_at) VALUES (?, ?, ?)").run(roomId, userId, now);
      this.db.prepare("UPDATE rooms SET updated_at = ? WHERE id = ?").run(now, roomId);
      return this.roomById(roomId);
    });
  }

  respondUndo(roomId, userId, accept, now) {
    this.cleanupExpiredRooms(now);
    return this.transaction(() => {
      this.assertRoomPlayer(roomId, userId);
      const request = this.db.prepare("SELECT requested_by_user_id FROM room_undo_requests WHERE room_id = ?").get(roomId) ?? null;
      if (!request) throw new AppError("INVALID_ROOM_STATE", "当前没有待处理的悔棋请求", 409);
      if (request.requested_by_user_id === userId) throw new AppError("UNAUTHORIZED", "悔棋请求需要由对手处理", 403);
      if (!accept) {
        this.db.prepare("DELETE FROM room_undo_requests WHERE room_id = ?").run(roomId);
        this.db.prepare("UPDATE rooms SET updated_at = ? WHERE id = ?").run(now, roomId);
        return this.roomById(roomId);
      }

      const row = this.db.prepare("SELECT game_id, seq FROM rooms WHERE id = ?").get(roomId) ?? null;
      if (!row || Number(row.seq) < 1) throw new AppError("INVALID_ROOM_STATE", "找不到可以恢复的上一步棋局", 409);
      const removedRow = this.db.prepare("SELECT move_json FROM room_moves WHERE room_id = ? AND seq = ?").get(roomId, row.seq) ?? null;
      const removedMove = parseJson(removedRow?.move_json);
      if (!removedMove || (removedMove.seat !== "red" && removedMove.seat !== "black")) {
        throw new AppError("INVALID_ROOM_STATE", "找不到可以恢复的上一步棋局", 409);
      }
      const previousSeq = Number(row.seq) - 1;
      const previousRow = previousSeq > 0
        ? this.db.prepare("SELECT move_json FROM room_moves WHERE room_id = ? AND seq = ?").get(roomId, previousSeq) ?? null
        : null;
      const previousMove = parseJson(previousRow?.move_json);
      const previousPosition = previousMove?.position ?? initialPosition(row.game_id);
      this.db.prepare("UPDATE rooms SET status = 'playing', winner = NULL, turn = ?, seq = ?, position = ?, last_move_json = ?, updated_at = ? WHERE id = ?")
        .run(removedMove.seat, previousSeq, previousPosition, previousRow?.move_json ?? null, now, roomId);
      this.db.prepare("DELETE FROM room_moves WHERE room_id = ? AND seq = ?").run(roomId, row.seq);
      this.db.prepare("DELETE FROM room_undo_requests WHERE room_id = ?").run(roomId);
      return this.roomById(roomId);
    });
  }

  resign(roomId, userId, now) {
    this.cleanupExpiredRooms(now);
    const player = this.assertRoomPlayer(roomId, userId);
    const room = this.roomById(roomId);
    if (!room || room.status !== "playing") throw new AppError("INVALID_ROOM_STATE", "当前房间不能认输", 409);
    const winner = player.seat === "red" ? "black" : "red";
    this.transaction(() => {
      this.db.prepare("UPDATE rooms SET status = 'finished', winner = ?, updated_at = ? WHERE id = ?").run(winner, now, roomId);
      this.db.prepare("UPDATE room_players SET ready = 0 WHERE room_id = ?").run(roomId);
      this.db.prepare("DELETE FROM room_undo_requests WHERE room_id = ?").run(roomId);
      this.db.prepare("DELETE FROM room_rematch_requests WHERE room_id = ?").run(roomId);
    });
    return this.roomById(roomId);
  }

  leaveRoom(roomId, userId, now) {
    this.cleanupExpiredRooms(now);
    this.assertRoomPlayer(roomId, userId);
    this.transaction(() => {
      this.db.prepare("DELETE FROM room_players WHERE room_id = ? AND user_id = ?").run(roomId, userId);
      this.db.prepare("UPDATE rooms SET status = 'left', updated_at = ? WHERE id = ?").run(now, roomId);
      this.db.prepare("DELETE FROM room_undo_requests WHERE room_id = ?").run(roomId);
      this.db.prepare("DELETE FROM room_rematch_requests WHERE room_id = ?").run(roomId);
    });
    return this.roomById(roomId);
  }

  rematch(roomId, userId, now) {
    this.cleanupExpiredRooms(now);
    return this.transaction(() => {
      this.assertRoomPlayer(roomId, userId);
      const row = this.db.prepare("SELECT game_id, status FROM rooms WHERE id = ?").get(roomId) ?? null;
      if (!row) throw new AppError("ROOM_NOT_FOUND", "找不到这个游戏房间", 404);
      if (row.status !== "finished") throw new AppError("INVALID_ROOM_STATE", "当前棋局尚未结束", 409);

      const players = this.roomPlayerRows(roomId);
      if (players.length !== 2) throw new AppError("INVALID_ROOM_STATE", "需要对手在房间内才能再来一局", 409);
      const pending = this.db.prepare("SELECT requested_by_user_id FROM room_rematch_requests WHERE room_id = ?").get(roomId) ?? null;

      if (!pending) {
        this.db.prepare("INSERT INTO room_rematch_requests (room_id, requested_by_user_id, requested_at) VALUES (?, ?, ?)").run(roomId, userId, now);
        this.db.prepare("UPDATE room_players SET ready = CASE WHEN user_id = ? THEN 1 ELSE 0 END WHERE room_id = ?").run(userId, roomId);
        this.db.prepare("UPDATE rooms SET updated_at = ? WHERE id = ?").run(now, roomId);
        return this.roomById(roomId);
      }

      if (pending.requested_by_user_id === userId) return this.roomById(roomId);

      this.db.prepare("UPDATE rooms SET status = 'playing', turn = 'red', seq = 0, position = ?, last_move_json = NULL, winner = NULL, updated_at = ? WHERE id = ?").run(initialPosition(row.game_id), now, roomId);
      this.db.prepare("UPDATE room_players SET ready = 1 WHERE room_id = ?").run(roomId);
      this.db.prepare("DELETE FROM room_moves WHERE room_id = ?").run(roomId);
      this.db.prepare("DELETE FROM room_undo_requests WHERE room_id = ?").run(roomId);
      this.db.prepare("DELETE FROM room_rematch_requests WHERE room_id = ?").run(roomId);
      return this.roomById(roomId);
    });
  }

  setRoomUserConnected(userId, connected, now = Date.now()) {
    this.cleanupExpiredRooms(now);
    const roomIds = this.db.prepare("SELECT DISTINCT room_id FROM room_players WHERE user_id = ?").all(userId).map((row) => row.room_id);
    if (roomIds.length === 0) return [];
    this.db.prepare("UPDATE room_players SET connected = ? WHERE user_id = ?").run(connected ? 1 : 0, userId);
    const placeholders = roomIds.map(() => "?").join(",");
    this.db.prepare(`UPDATE rooms SET updated_at = ? WHERE id IN (${placeholders})`).run(now, ...roomIds);
    return roomIds.map((roomId) => this.roomById(roomId)).filter(Boolean);
  }
}

export { DEFAULT_GROUP_ID, ROOM_IDLE_TTL_MS };
