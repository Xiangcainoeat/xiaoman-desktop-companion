import {
  acceptInvite,
  applyRoomMove,
  assignRoomSeat,
  acceptFriendRequest,
  assertFriendRequestAllowed,
  declineFriendRequest,
  declineInvite,
  normalizeMessageBody,
  SocialError,
} from "./state";
import type {
  ChatGroup,
  ChatMessage,
  ChatScope,
  CreateRoomInput,
  Friend,
  FriendRequest,
  FriendRequestResponse,
  GameInvite,
  GameInviteInput,
  GameInviteResponse,
  GameMoveInput,
  GameRoom,
  JoinRoomInput,
  LoginInput,
  RegisterInput,
  RoomPlayer,
  SendMessageInput,
  SocialEvent,
  SocialSession,
  SocialUser,
  UndoResponseInput,
} from "./types";
import { chatScopeKey, GOMOKU_POSITION_LENGTH, ROOM_IDLE_TTL_MS } from "./types";
import { createInitialPosition, isOnlineGameId } from "../online-games/engine";
import type { GuestLocalTransportOptions, SocialEventListener, SocialTransport, StorageLike } from "./transport";

const LOCAL_STORAGE_KEY = "xiaoman.social.local.v1";
const DEFAULT_GUEST: SocialUser = {
  id: "guest-local",
  username: "guest",
  displayName: "访客",
  avatarUrl: null,
};
const TEST_OPPONENT: SocialUser = {
  id: "local-test-opponent",
  username: "xiaoman-test",
  displayName: "本地测试对手",
  avatarUrl: null,
};

function initialRoomPosition(gameId: string): string {
  if (gameId === "gomoku") return "0".repeat(GOMOKU_POSITION_LENGTH);
  if (gameId === "xiangqi") return "initial";
  return isOnlineGameId(gameId) ? createInitialPosition(gameId) : "initial";
}

const DEMO_USERS: SocialUser[] = [
  { id: "friend-lin", username: "lin", displayName: "林同学", avatarUrl: null },
  { id: "friend-zhou", username: "zhou", displayName: "周周", avatarUrl: null },
  { id: "friend-he", username: "he", displayName: "何工", avatarUrl: null },
  { id: "friend-wu", username: "wu", displayName: "吴同学", avatarUrl: null },
];

const DEMO_FRIENDS: Friend[] = [
  {
    id: "friend-lin",
    user: DEMO_USERS[0],
    presence: "online",
    lastSeenAt: null,
    unreadCount: 1,
  },
  {
    id: "friend-he",
    user: DEMO_USERS[2],
    presence: "offline",
    lastSeenAt: 1_000,
    unreadCount: 0,
  },
];

const DEMO_GROUPS: ChatGroup[] = [
  {
    id: "group-pet-lab",
    name: "桌宠实验室",
    memberCount: 8,
    memberIds: [DEFAULT_GUEST.id, "friend-lin", "friend-zhou"],
    accent: "sage",
    unreadCount: 2,
  },
  {
    id: "group-game-night",
    name: "晚间棋局",
    memberCount: 4,
    memberIds: [DEFAULT_GUEST.id, "friend-he"],
    accent: "blue",
    unreadCount: 0,
  },
];

interface LocalPersistedState {
  user: SocialUser | null;
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function readPersistedUser(storage: StorageLike | null): SocialUser | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalPersistedState>;
    return parsed.user && typeof parsed.user.id === "string" && typeof parsed.user.username === "string"
      ? {
        id: parsed.user.id,
        username: parsed.user.username,
        displayName: typeof parsed.user.displayName === "string" ? parsed.user.displayName : parsed.user.username,
        avatarUrl: typeof parsed.user.avatarUrl === "string" ? parsed.user.avatarUrl : null,
      }
      : null;
  } catch {
    return null;
  }
}

function userIdFor(username: string): string {
  const normalized = username.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `local-${normalized || "user"}`;
}

function validateCredentials(input: LoginInput | RegisterInput): void {
  if (!input.username.trim() || !input.password) throw new SocialError("INVALID_INPUT", "请输入账号和密码");
}

function findScope(scope: ChatScope, friends: Friend[], groups: ChatGroup[]): boolean {
  return scope.kind === "direct"
    ? friends.some((friend) => friend.user.id === scope.friendId)
    : groups.some((group) => group.id === scope.groupId);
}

export class GuestLocalTransport implements SocialTransport {
  readonly kind = "local" as const;
  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private readonly listeners = new Set<SocialEventListener>();
  private readonly friends = clone(DEMO_FRIENDS);
  private readonly friendRequests: FriendRequest[];
  private readonly groups = clone(DEMO_GROUPS);
  private readonly messages = new Map<string, ChatMessage[]>();
  private readonly invites: GameInvite[] = [];
  private readonly rooms: GameRoom[] = [];
  private readonly roomHistory = new Map<string, GameRoom[]>();
  private session: SocialSession;
  private idCounter = 0;

  constructor(options: GuestLocalTransportOptions = {}) {
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.now = options.now ?? Date.now;
    this.friendRequests = clone(options.friendRequests ?? []);
    const savedUser = readPersistedUser(this.storage);
    const user = savedUser ?? DEFAULT_GUEST;
    this.session = this.makeSession(savedUser ? "authenticated" : "guest", user);
    this.seedMessages(user);
    this.seedInvite(user);
  }

  private makeSession(authState: SocialSession["authState"], user: SocialUser | null): SocialSession {
    return {
      authState,
      user,
      serverOrigin: null,
      transport: "local",
      connection: "local",
      lastConnectedAt: this.now(),
    };
  }

  private seedMessages(user: SocialUser): void {
    const directScope: ChatScope = { kind: "direct", friendId: "friend-lin" };
    const groupScope: ChatScope = { kind: "group", groupId: "group-pet-lab" };
    this.messages.set(chatScopeKey(directScope), [
      {
        id: "local-message-1",
        scope: directScope,
        sender: this.friends[0].user,
        body: "晚上要不要来一局象棋？",
        createdAt: this.now() - 12 * 60_000,
      },
      {
        id: "local-message-2",
        scope: directScope,
        sender: user,
        body: "可以，先在本地测试房间试试。",
        createdAt: this.now() - 10 * 60_000,
      },
    ]);
    this.messages.set(chatScopeKey(groupScope), [
      {
        id: "local-message-3",
        scope: groupScope,
        sender: this.friends[1].user,
        body: "欢迎来到桌宠实验室。",
        createdAt: this.now() - 35 * 60_000,
      },
    ]);
  }

  private seedInvite(user: SocialUser): void {
    this.invites.push({
      id: "local-invite-1",
      gameId: "xiangqi",
      from: this.friends[0].user,
      to: user,
      roomId: null,
      status: "pending",
      createdAt: this.now() - 3 * 60_000,
      expiresAt: this.now() + 27 * 60 * 60_000,
    });
  }

  private persistUser(user: SocialUser | null): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ user } satisfies LocalPersistedState));
    } catch {
      // Local persistence is optional; the session remains usable in memory.
    }
  }

  private emit(event: SocialEvent): void {
    const safeEvent = clone(event);
    for (const listener of this.listeners) listener(safeEvent);
  }

  private currentUser(): SocialUser {
    if (!this.session.user) throw new SocialError("UNAUTHORIZED", "请先登录");
    return this.session.user;
  }

  private roomExpiresAt(room: GameRoom): number {
    return room.expiresAt ?? room.updatedAt + ROOM_IDLE_TTL_MS;
  }

  private touchRoom(room: GameRoom, at = this.now()): void {
    room.updatedAt = at;
    room.expiresAt = at + ROOM_IDLE_TTL_MS;
  }

  private pruneExpiredRooms(): void {
    const now = this.now();
    for (let index = this.rooms.length - 1; index >= 0; index -= 1) {
      if (this.roomExpiresAt(this.rooms[index]) <= now) {
        this.roomHistory.delete(this.rooms[index].id);
        this.rooms.splice(index, 1);
      }
    }
  }

  private roomById(roomId: string): GameRoom {
    this.pruneExpiredRooms();
    const room = this.rooms.find((item) => item.id === roomId);
    if (!room) throw new SocialError("ROOM_NOT_FOUND", "找不到这个象棋房间");
    return room;
  }

  private roomSeat(room: GameRoom, userId = this.currentUser().id): "red" | "black" {
    if (room.players.red?.user.id === userId) return "red";
    if (room.players.black?.user.id === userId) return "black";
    throw new SocialError("UNAUTHORIZED", "你不在这个房间里");
  }

  async getSession(): Promise<SocialSession> {
    return clone(this.session);
  }

  async searchUsers(query: string): Promise<SocialUser[]> {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    const currentId = this.currentUser().id;
    return clone(DEMO_USERS.filter((user) => user.id !== currentId
      && `${user.username} ${user.displayName}`.toLocaleLowerCase().includes(normalized)));
  }

  async login(input: LoginInput): Promise<SocialSession> {
    validateCredentials(input);
    const user: SocialUser = {
      id: userIdFor(input.username),
      username: input.username.trim(),
      displayName: input.username.trim(),
      avatarUrl: null,
    };
    this.session = this.makeSession("authenticated", user);
    this.persistUser(user);
    this.emit({ type: "session.updated", session: this.session });
    return clone(this.session);
  }

  async register(input: RegisterInput): Promise<SocialSession> {
    validateCredentials(input);
    if (!input.displayName.trim()) throw new SocialError("INVALID_INPUT", "请输入显示名称");
    const user: SocialUser = {
      id: userIdFor(input.username),
      username: input.username.trim(),
      displayName: input.displayName.trim(),
      avatarUrl: null,
    };
    this.session = this.makeSession("authenticated", user);
    this.persistUser(user);
    this.emit({ type: "session.updated", session: this.session });
    return clone(this.session);
  }

  async logout(): Promise<void> {
    this.session = this.makeSession("guest", DEFAULT_GUEST);
    this.persistUser(null);
    this.emit({ type: "session.updated", session: this.session });
  }

  async listFriends(): Promise<Friend[]> { return clone(this.friends); }
  async listFriendRequests(): Promise<FriendRequest[]> { return clone(this.friendRequests); }

  async sendFriendRequest(userId: string): Promise<FriendRequest> {
    const from = this.currentUser();
    const to = DEMO_USERS.find((user) => user.id === userId);
    if (!to) throw new SocialError("FRIEND_NOT_FOUND", "找不到这个用户");
    assertFriendRequestAllowed(
      from.id,
      to.id,
      this.friendRequests,
      this.friends.map((friend) => friend.user.id),
    );
    const now = this.now();
    const request: FriendRequest = {
      id: `local-friend-request-${++this.idCounter}`,
      from: clone(from),
      to: clone(to),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    this.friendRequests.push(request);
    this.emit({ type: "friend-request.created", request });
    return clone(request);
  }

  async respondFriendRequest(input: FriendRequestResponse): Promise<void> {
    const index = this.friendRequests.findIndex((request) => request.id === input.requestId);
    if (index < 0) throw new SocialError("FRIEND_NOT_FOUND", "找不到这条好友请求");
    const actorId = this.currentUser().id;
    const current = this.friendRequests[index];
    const next = input.response === "accept"
      ? acceptFriendRequest(current, actorId, this.now())
      : declineFriendRequest(current, actorId, this.now());
    this.friendRequests[index] = next;
    if (next.status === "accepted") {
      const friend = next.from.id === actorId ? next.to : next.from;
      if (!this.friends.some((item) => item.user.id === friend.id)) {
        this.friends.push({
          id: friend.id,
          user: clone(friend),
          presence: "offline",
          lastSeenAt: null,
          unreadCount: 0,
        });
      }
    }
    this.emit({ type: "friend-request.updated", request: next });
    if (next.status === "accepted") {
      this.emit({ type: "session.updated", session: this.session });
    }
  }

  async listGroups(): Promise<ChatGroup[]> { return clone(this.groups); }

  async listMessages(scope: ChatScope): Promise<ChatMessage[]> {
    if (!findScope(scope, this.friends, this.groups)) throw new SocialError("INVALID_INPUT", "找不到这个聊天对象");
    return clone(this.messages.get(chatScopeKey(scope)) ?? []);
  }

  async sendMessage(input: SendMessageInput): Promise<ChatMessage> {
    const body = normalizeMessageBody(input.body);
    if (!findScope(input.scope, this.friends, this.groups)) throw new SocialError("INVALID_INPUT", "找不到这个聊天对象");
    const message: ChatMessage = {
      id: `local-message-${++this.idCounter}-${this.now()}`,
      scope: clone(input.scope),
      sender: this.currentUser(),
      body,
      createdAt: this.now(),
    };
    const key = chatScopeKey(input.scope);
    const messages = this.messages.get(key) ?? [];
    messages.push(message);
    this.messages.set(key, messages);
    this.emit({ type: "chat.message", message });
    return clone(message);
  }

  async listInvites(): Promise<GameInvite[]> {
    return clone(this.invites.map((invite) => invite.status === "pending" && this.now() >= invite.expiresAt
      ? { ...invite, status: "expired" as const }
      : invite));
  }

  async createGameInvite(input: GameInviteInput): Promise<GameInvite> {
    const recipient = this.friends.find((friend) => friend.user.id === input.toUserId)?.user;
    if (!recipient) throw new SocialError("INVALID_INPUT", "找不到这个好友");
    const invite: GameInvite = {
      id: `local-invite-${++this.idCounter}`,
      gameId: input.gameId,
      from: this.currentUser(),
      to: recipient,
      roomId: input.roomId ?? null,
      status: "pending",
      createdAt: this.now(),
      expiresAt: this.now() + 30 * 60_000,
    };
    this.invites.push(invite);
    this.emit({ type: "invite.created", invite });
    return clone(invite);
  }

  async respondGameInvite(input: GameInviteResponse): Promise<GameInvite> {
    const index = this.invites.findIndex((invite) => invite.id === input.inviteId);
    if (index < 0) throw new SocialError("ROOM_NOT_FOUND", "找不到这条游戏邀请");
    const current = this.invites[index];
    const next = input.response === "accept" ? acceptInvite(current, this.now()) : declineInvite(current, this.now());
    this.invites[index] = next;
    this.emit({ type: "invite.updated", invite: next });
    return clone(next);
  }

  async listRooms(): Promise<GameRoom[]> {
    this.pruneExpiredRooms();
    return clone(this.rooms);
  }

  async getRoom(roomId: string): Promise<GameRoom> {
    this.pruneExpiredRooms();
    const room = this.rooms.find((item) => item.id === roomId);
    if (!room) throw new SocialError("ROOM_NOT_FOUND", "找不到这个游戏房间");
    return clone(room);
  }

  async createRoom(input: CreateRoomInput): Promise<GameRoom> {
    const user = this.currentUser();
    const now = this.now();
    const room: GameRoom = {
      id: `local-room-${++this.idCounter}`,
      code: `XM${String(1000 + this.idCounter).slice(-4)}`,
      gameId: input.gameId,
      hostUserId: user.id,
      players: {
        red: { user, seat: "red", ready: false, connected: true },
        black: null,
      },
      status: "waiting",
      turn: "red",
      seq: 0,
      position: initialRoomPosition(input.gameId),
      lastMove: null,
      winner: null,
      undoRequest: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ROOM_IDLE_TTL_MS,
    };
    this.rooms.push(room);
    this.emit({ type: "room.updated", room });
    return clone(room);
  }

  async joinRoom(input: JoinRoomInput): Promise<GameRoom> {
    this.pruneExpiredRooms();
    const room = this.rooms.find((item) => item.id === input.roomId || item.code.toLowerCase() === input.code?.trim().toLowerCase());
    if (!room) throw new SocialError("ROOM_NOT_FOUND", "找不到这个游戏房间");
    const result = assignRoomSeat(room, this.currentUser());
    Object.assign(room, result.room);
    this.touchRoom(room);
    this.emit({ type: "room.updated", room });
    return clone(room);
  }

  async addTestOpponent(roomId: string): Promise<GameRoom> {
    const room = this.roomById(roomId);
    if (room.players.black?.user.id === TEST_OPPONENT.id) return clone(room);
    if (room.players.black) throw new SocialError("ROOM_FULL", "这个房间的席位已满");
    room.players.black = { user: TEST_OPPONENT, seat: "black", ready: true, connected: true } satisfies RoomPlayer;
    room.status = room.players.red?.ready ? "playing" : "ready";
    this.touchRoom(room);
    this.emit({ type: "room.updated", room });
    return clone(room);
  }

  async setReady(roomId: string, ready: boolean): Promise<void> {
    const room = this.roomById(roomId);
    const seat = this.roomSeat(room);
    const player = room.players[seat];
    if (!player) throw new SocialError("UNAUTHORIZED", "你不在这个房间里");
    player.ready = ready;
    const bothReady = room.players.red?.ready === true && room.players.black?.ready === true;
    room.status = bothReady ? "playing" : ready ? "ready" : "waiting";
    this.touchRoom(room);
    this.emit({ type: "room.updated", room });
  }

  async sendMove(input: GameMoveInput): Promise<void> {
    const room = this.roomById(input.roomId);
    const seat = this.roomSeat(room);
    if (seat !== input.seat) throw new SocialError("UNAUTHORIZED", "不能替另一个席位落子");
    const next = applyRoomMove(room, input);
    const history = this.roomHistory.get(room.id) ?? [];
    history.push(clone(room));
    this.roomHistory.set(room.id, history);
    Object.assign(room, next);
    this.touchRoom(room);
    this.emit({ type: "room.updated", room });
    this.emit({ type: "game.move", move: input });
  }

  async requestUndo(roomId: string): Promise<void> {
    const room = this.roomById(roomId);
    const user = this.currentUser();
    const seat = this.roomSeat(room, user.id);
    if (room.status !== "playing" || room.seq < 1 || !room.lastMove) {
      throw new SocialError("INVALID_ROOM_STATE", "当前没有可以撤回的落子");
    }
    if (room.lastMove.seat !== seat) throw new SocialError("INVALID_ROOM_STATE", "只能由最后落子的一方申请悔棋");
    if (room.undoRequest) {
      if (room.undoRequest.requestedByUserId === user.id) return;
      throw new SocialError("INVALID_ROOM_STATE", "已有待处理的悔棋请求");
    }
    room.undoRequest = { requestedByUserId: user.id, requestedAt: this.now() };
    this.touchRoom(room);
    this.emit({ type: "room.updated", room });
  }

  async respondUndo(input: UndoResponseInput): Promise<void> {
    const room = this.roomById(input.roomId);
    const user = this.currentUser();
    this.roomSeat(room, user.id);
    const request = room.undoRequest;
    if (!request) throw new SocialError("INVALID_ROOM_STATE", "当前没有待处理的悔棋请求");
    if (request.requestedByUserId === user.id) throw new SocialError("UNAUTHORIZED", "悔棋请求需要由对手处理");
    if (!input.accept) {
      room.undoRequest = null;
      this.touchRoom(room);
      this.emit({ type: "room.updated", room });
      return;
    }
    const history = this.roomHistory.get(room.id) ?? [];
    const previous = history.pop();
    if (!previous) throw new SocialError("INVALID_ROOM_STATE", "找不到可以恢复的上一步棋局");
    Object.assign(room, previous, { undoRequest: null });
    this.roomHistory.set(room.id, history);
    this.touchRoom(room);
    this.emit({ type: "room.updated", room });
  }

  async resign(roomId: string): Promise<void> {
    const room = this.roomById(roomId);
    const seat = this.roomSeat(room);
    room.status = "finished";
    room.winner = seat === "red" ? "black" : "red";
    room.undoRequest = null;
    this.touchRoom(room);
    this.emit({ type: "room.updated", room });
  }

  async leaveRoom(roomId: string): Promise<void> {
    const room = this.roomById(roomId);
    const seat = this.roomSeat(room);
    room.players[seat] = null;
    room.status = "left";
    room.undoRequest = null;
    this.touchRoom(room);
    this.emit({ type: "room.updated", room });
  }

  async rematch(roomId: string): Promise<void> {
    const room = this.roomById(roomId);
    room.status = room.players.red && room.players.black ? "ready" : "waiting";
    room.turn = "red";
    room.seq = 0;
    room.position = initialRoomPosition(room.gameId);
    room.lastMove = null;
    room.winner = null;
    room.undoRequest = null;
    this.roomHistory.delete(room.id);
    if (room.players.red) room.players.red.ready = false;
    if (room.players.black) room.players.black.ready = false;
    this.touchRoom(room);
    this.emit({ type: "room.updated", room });
  }

  subscribe(listener: SocialEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
