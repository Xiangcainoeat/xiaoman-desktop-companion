import {
  SocialError,
  socialErrorMessage,
} from "./state";
import { chatScopeKey, GOMOKU_POSITION_LENGTH, SOCIAL_GAME_IDS } from "./types";
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
  SendMessageInput,
  SocialEvent,
  SocialSession,
  SocialUser,
  UndoResponseInput,
} from "./types";
import {
  arrayFromApi,
  configuredOrigin,
  unwrapApiData,
  type ServerSocialTransportOptions,
  type SocialEventListener,
  type SocialRealtimeEnvelope,
  type SocialTransport,
  type WebSocketLike,
} from "./transport";

const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const REALTIME_MOVE_TIMEOUT_MS = 4_000;
const REALTIME_READY_TIMEOUT_MS = 3_000;
const REALTIME_HEARTBEAT_MS = 15_000;

interface RealtimeWaiter {
  resolve: () => void;
  reject: (error: SocialError) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingRealtimeMove {
  resolve: () => void;
  reject: (error: SocialError) => void;
  timer: ReturnType<typeof setTimeout>;
}

function defaultFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  const Constructor = globalThis.WebSocket;
  if (!Constructor) throw new SocialError("NETWORK", "当前环境不支持实时连接");
  return new Constructor(url);
}

function asSocialUser(value: unknown): SocialUser | null {
  if (!isRecord(value)) return null;
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

function asSession(value: unknown, origin: string, authenticatedHint = false): SocialSession {
  const session = value && typeof value === "object" ? value as Partial<SocialSession> : {};
  const user = asSocialUser(session.user);
  const authState = session.authState === "guest"
    || session.authState === "authenticated"
    || session.authState === "connecting"
    || session.authState === "offline"
    ? session.authState
    : authenticatedHint || user ? "authenticated" : "offline";
  const connection = session.connection === "local"
    || session.connection === "connecting"
    || session.connection === "connected"
    || session.connection === "offline"
    || session.connection === "error"
    ? session.connection
    : "connected";
  return {
    authState: authenticatedHint && authState !== "authenticated" ? "authenticated" : authState,
    user,
    serverOrigin: origin,
    transport: "server",
    connection,
    lastConnectedAt: typeof session.lastConnectedAt === "number" ? session.lastConnectedAt : Date.now(),
  };
}

function websocketOrigin(origin: string, configured?: string): string {
  let raw = origin.replace(/^http/, "ws");
  if (configured?.trim()) {
    try {
      const candidate = new URL(configured.trim());
      if (["http:", "https:", "ws:", "wss:"].includes(candidate.protocol)) {
        if (candidate.protocol === "http:") candidate.protocol = "ws:";
        if (candidate.protocol === "https:") candidate.protocol = "wss:";
        raw = candidate.toString().replace(/\/$/, "");
      }
    } catch {
      // Fall back to the API origin. The constructor already validates it.
    }
  }
  return `${raw}/api/v1/realtime`;
}

function authResponse(value: unknown): { token: string | null; session: unknown } {
  const response = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawToken = response.token ?? response.accessToken;
  const token = typeof rawToken === "string" && rawToken.trim() ? rawToken : null;
  return { token, session: response.session ?? response };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isSeat(value: unknown): value is "red" | "black" {
  return value === "red" || value === "black";
}

function isGameId(value: unknown): value is import("./types").SocialGameId {
  return typeof value === "string" && (SOCIAL_GAME_IDS as readonly string[]).includes(value);
}

const GAME_BOUNDS: Record<import("./types").SocialGameId, { maxX: number; maxY: number; minX?: number }> = {
  gomoku: { maxX: 14, maxY: 14 },
  "tic-tac-toe": { maxX: 2, maxY: 2 },
  chess: { maxX: 7, maxY: 7 },
  reversi: { maxX: 7, maxY: 7 },
  checkers: { maxX: 7, maxY: 7 },
  xiangqi: { maxX: 8, maxY: 9 },
  go: { maxX: 8, maxY: 8 },
  shogi: { maxX: 8, maxY: 8 },
  connect6: { maxX: 18, maxY: 18 },
  ludo: { maxX: 12, maxY: 7 },
  "animal-chess": { maxX: 7, maxY: 3 },
  "army-chess": { maxX: 4, maxY: 11 },
  backgammon: { maxX: 11, maxY: 2 },
  "dots-and-boxes": { maxX: 3, maxY: 3 },
  mancala: { maxX: 6, maxY: 1 },
  "chinese-checkers": { maxX: 12, maxY: 12 },
};

function isPoint(value: unknown, gameId: import("./types").SocialGameId): value is { x: number; y: number } {
  const bounds = GAME_BOUNDS[gameId];
  if (!bounds) return false;
  return isRecord(value)
    && Number.isInteger(value.x)
    && Number.isInteger(value.y)
    && (value.x as number) >= (bounds.minX ?? 0)
    && (value.x as number) <= bounds.maxX
    && (value.y as number) >= 0
    && (value.y as number) <= bounds.maxY;
}

function isUser(value: unknown): value is SocialUser {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.username === "string"
    && typeof value.displayName === "string"
    && (value.avatarUrl === null || typeof value.avatarUrl === "string");
}

function isScope(value: unknown): value is ChatScope {
  return isRecord(value)
    && (value.kind === "direct" || value.kind === "group")
    && typeof (value.kind === "direct" ? value.friendId : value.groupId) === "string";
}

function isMessage(value: unknown): value is ChatMessage {
  return isRecord(value)
    && typeof value.id === "string"
    && isScope(value.scope)
    && isUser(value.sender)
    && typeof value.body === "string"
    && typeof value.createdAt === "number";
}

function isFriendRequest(value: unknown): value is FriendRequest {
  return isRecord(value)
    && typeof value.id === "string"
    && isUser(value.from)
    && isUser(value.to)
    && (value.status === "pending" || value.status === "accepted" || value.status === "declined")
    && typeof value.createdAt === "number"
    && typeof value.updatedAt === "number";
}

function isInvite(value: unknown): value is GameInvite {
  return isRecord(value)
    && typeof value.id === "string"
    && isGameId(value.gameId)
    && isUser(value.from)
    && isUser(value.to)
    && (value.roomId === null || typeof value.roomId === "string")
    && (value.status === "pending" || value.status === "accepted" || value.status === "declined" || value.status === "expired")
    && typeof value.createdAt === "number"
    && typeof value.expiresAt === "number";
}

function isMove(value: unknown): value is GameMoveInput {
  if (!isRecord(value) || !isGameId(value.gameId)) return false;
  const gameId = value.gameId;
  const from = value.from;
  const to = value.to;
  const position = value.position;
  const common = typeof value.roomId === "string"
    && isSeat(value.seat)
    && isPoint(from, gameId)
    && isPoint(to, gameId)
    && (value.captured === null || isPoint(value.captured, gameId))
    && typeof position === "string"
    && Number.isInteger(value.seq)
    && (value.seq as number) >= 1
    && typeof value.createdAt === "number";
  if (!common) return false;
  if (gameId === "gomoku") {
    return from.x === to.x
      && from.y === to.y
      && value.captured === null
      && position.length === GOMOKU_POSITION_LENGTH
      && /^[012]+$/.test(position);
  }
  return position.length > 0;
}

function isRoomPlayer(value: unknown): boolean {
  return isRecord(value)
    && isUser(value.user)
    && isSeat(value.seat)
    && typeof value.ready === "boolean"
    && (value.connected === undefined || typeof value.connected === "boolean");
}

function isRoom(value: unknown): value is GameRoom {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.code !== "string"
    || !isGameId(value.gameId) || typeof value.hostUserId !== "string") return false;
  if (!isRecord(value.players) || !(value.players.red === null || isRoomPlayer(value.players.red))
    || !(value.players.black === null || isRoomPlayer(value.players.black))) return false;
  return (value.status === "waiting" || value.status === "ready" || value.status === "playing"
      || value.status === "paused" || value.status === "finished" || value.status === "left")
    && isSeat(value.turn)
    && Number.isInteger(value.seq)
    && (value.seq as number) >= 0
    && typeof value.position === "string"
    && (value.lastMove === null || isMove(value.lastMove))
    && (value.winner === null || isSeat(value.winner))
    && typeof value.createdAt === "number"
    && typeof value.updatedAt === "number"
    && (value.expiresAt === undefined || typeof value.expiresAt === "number");
}

function eventFromEnvelope(envelope: SocialRealtimeEnvelope): SocialEvent | null {
  const payload = isRecord(envelope.payload) ? envelope.payload : null;
  switch (envelope.type) {
    case "chat.message": return isMessage(payload?.message) ? { type: "chat.message", message: payload.message } : null;
    case "friend-request.created": return isFriendRequest(payload?.request) ? { type: "friend-request.created", request: payload.request } : null;
    case "friend-request.updated": return isFriendRequest(payload?.request) ? { type: "friend-request.updated", request: payload.request } : null;
    case "invite.created": return isInvite(payload?.invite) ? { type: "invite.created", invite: payload.invite } : null;
    case "invite.updated": return isInvite(payload?.invite) ? { type: "invite.updated", invite: payload.invite } : null;
    case "room.updated": return isRoom(payload?.room) ? { type: "room.updated", room: payload.room } : null;
    case "game.move": return isMove(payload?.move) ? { type: "game.move", move: payload.move } : null;
    case "game.resync":
      if (typeof envelope.roomId !== "string" || !Number.isInteger(envelope.seq) || (envelope.seq as number) < 0 || typeof payload?.position !== "string" || !isSeat(payload.turn)) return null;
      return { type: "game.resync", roomId: envelope.roomId, position: payload.position, seq: envelope.seq as number, turn: payload.turn };
    case "error":
      return { type: "error", code: typeof payload?.code === "string" ? payload.code : "UNKNOWN", message: typeof payload?.message === "string" ? payload.message : "实时服务错误", requestId: envelope.requestId };
    default: return null;
  }
}

export class ServerSocialTransport implements SocialTransport {
  readonly kind = "server" as const;
  private readonly origin: string;
  private readonly fetchImpl: NonNullable<ServerSocialTransportOptions["fetchImpl"]>;
  private readonly webSocketFactory: NonNullable<ServerSocialTransportOptions["webSocketFactory"]>;
  private readonly realtimeOrigin?: string;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  private readonly listeners = new Set<SocialEventListener>();
  private readonly requestControllers = new Set<AbortController>();
  private token: string | null = null;
  private socket: WebSocketLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly realtimeWaiters = new Set<RealtimeWaiter>();
  private readonly pendingMoves = new Map<string, PendingRealtimeMove>();
  private realtimeReady = false;
  private realtimeRequestCounter = 0;
  private closed = false;
  private authenticated = false;
  private currentSession: SocialSession | null = null;

  constructor(origin: string, options: ServerSocialTransportOptions = {}) {
    const normalized = configuredOrigin(origin);
    if (!normalized) throw new SocialError("CONFIGURATION", "服务器地址必须是 http 或 https 地址");
    this.origin = normalized;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory;
    this.realtimeOrigin = options.webSocketOrigin;
    this.now = options.now ?? Date.now;
    this.requestTimeoutMs = Number.isFinite(options.requestTimeoutMs) && (options.requestTimeoutMs ?? 0) > 0
      ? Math.max(1, Math.floor(options.requestTimeoutMs as number))
      : DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private url(path: string): string { return `${this.origin}${path.startsWith("/") ? path : `/${path}`}`; }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (this.closed) throw new SocialError("NETWORK", "服务器连接已取消");
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    const controller = typeof AbortController === "undefined" ? null : new AbortController();
    const externalSignal = init.signal;
    let abortedByCaller = Boolean(externalSignal?.aborted);
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const onExternalAbort = () => {
      abortedByCaller = true;
      controller?.abort();
    };
    if (controller) {
      this.requestControllers.add(controller);
      if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }
    let response: Response;
    try {
      const requestPromise = this.fetchImpl(this.url(path), {
        ...init,
        headers,
        credentials: init.credentials ?? "include",
        ...(controller ? { signal: controller.signal } : {}),
      });
      const timeoutPromise = new Promise<Response>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          controller?.abort();
          reject(new SocialError("NETWORK", "服务器连接超时，请检查服务器地址或网络"));
        }, this.requestTimeoutMs);
      });
      const cancellationPromise = controller
        ? new Promise<Response>((_resolve, reject) => {
          const abort = () => {
            if (timedOut) return;
            reject(new SocialError("NETWORK", abortedByCaller ? "服务器请求已取消" : "服务器连接已取消"));
          };
          if (controller.signal.aborted) abort();
          else controller.signal.addEventListener("abort", abort, { once: true });
        })
        : null;
      response = await Promise.race([
        requestPromise,
        timeoutPromise,
        ...(cancellationPromise ? [cancellationPromise] : []),
      ]);
    } catch (error) {
      if (timedOut) throw new SocialError("NETWORK", "服务器连接超时，请检查服务器地址或网络");
      if (error instanceof SocialError) throw error;
      throw new SocialError("NETWORK", socialErrorMessage(error));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
      if (controller) this.requestControllers.delete(controller);
    }
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = null; }
    }
    if (!response.ok) {
      const body = unwrapApiData<unknown>(payload) as { error?: { code?: string; message?: string }; message?: string } | null;
      const code = response.status === 401 ? "UNAUTHORIZED" : response.status >= 500 ? "NETWORK" : "UNKNOWN";
      if (response.status === 401) {
        this.token = null;
        this.setAuthenticated(false);
        if (this.currentSession?.authState === "authenticated") {
          this.currentSession = {
            ...this.currentSession,
            authState: "offline",
            user: null,
            connection: "offline",
          };
          this.notify({ type: "session.updated", session: this.currentSession });
        }
      }
      throw new SocialError(code, body?.error?.message ?? body?.message ?? `服务器请求失败（${response.status}）`);
    }
    return unwrapApiData<T>(payload);
  }

  private body(value: unknown): RequestInit { return { method: "POST", body: JSON.stringify(value) }; }

  async getSession(): Promise<SocialSession> {
    const session = asSession(await this.request<unknown>("/api/v1/session"), this.origin);
    this.currentSession = session;
    this.setAuthenticated(session.authState === "authenticated");
    return session;
  }

  async login(input: LoginInput): Promise<SocialSession> {
    const response = authResponse(await this.request<unknown>("/api/v1/auth/login", this.body(input)));
    this.token = response.token;
    const session = asSession(response.session, this.origin, Boolean(response.token));
    this.currentSession = session;
    this.setAuthenticated(session.authState === "authenticated", true);
    return session;
  }

  async register(input: RegisterInput): Promise<SocialSession> {
    const response = authResponse(await this.request<unknown>("/api/v1/auth/register", this.body(input)));
    this.token = response.token;
    const session = asSession(response.session, this.origin, Boolean(response.token));
    this.currentSession = session;
    this.setAuthenticated(session.authState === "authenticated", true);
    return session;
  }

  async logout(): Promise<void> {
    try { await this.request<unknown>("/api/v1/auth/logout", { method: "POST" }); }
    finally {
      this.token = null;
      this.setAuthenticated(false);
      if (this.currentSession) {
        this.currentSession = {
          ...this.currentSession,
          authState: "guest",
          user: null,
          connection: "offline",
        };
        this.notify({ type: "session.updated", session: this.currentSession });
      }
    }
  }

  async searchUsers(query: string): Promise<SocialUser[]> {
    return arrayFromApi<SocialUser>(await this.request(`/api/v1/users/search?q=${encodeURIComponent(query.trim())}`));
  }
  async listFriends(): Promise<Friend[]> { return arrayFromApi<Friend>(await this.request("/api/v1/friends")); }
  async listFriendRequests(): Promise<FriendRequest[]> { return arrayFromApi<FriendRequest>(await this.request("/api/v1/friend-requests")); }
  async sendFriendRequest(userId: string): Promise<FriendRequest> {
    return this.request<FriendRequest>("/api/v1/friend-requests", this.body({ userId }));
  }
  async respondFriendRequest(input: FriendRequestResponse): Promise<void> {
    await this.request<unknown>(`/api/v1/friend-requests/${encodeURIComponent(input.requestId)}`, {
      method: "PATCH",
      body: JSON.stringify({ response: input.response }),
    });
  }
  async listGroups(): Promise<ChatGroup[]> { return arrayFromApi<ChatGroup>(await this.request("/api/v1/groups")); }
  async listMessages(scope: ChatScope): Promise<ChatMessage[]> {
    return arrayFromApi<ChatMessage>(await this.request(`/api/v1/messages?scope=${encodeURIComponent(chatScopeKey(scope))}`));
  }
  async sendMessage(input: SendMessageInput): Promise<ChatMessage> {
    return this.request<ChatMessage>("/api/v1/messages", this.body(input));
  }
  async listInvites(): Promise<GameInvite[]> { return arrayFromApi<GameInvite>(await this.request("/api/v1/invites")); }
  async createGameInvite(input: GameInviteInput): Promise<GameInvite> {
    return this.request<GameInvite>("/api/v1/invites", this.body(input));
  }
  async respondGameInvite(input: GameInviteResponse): Promise<GameInvite> {
    await this.request<unknown>(`/api/v1/invites/${encodeURIComponent(input.inviteId)}`, { method: "PATCH", body: JSON.stringify({ response: input.response }) });
    const invites = await this.listInvites();
    const invite = invites.find((item) => item.id === input.inviteId);
    if (!invite) throw new SocialError("ROOM_NOT_FOUND", "找不到这条游戏邀请");
    return invite;
  }
  async listRooms(): Promise<GameRoom[]> { return arrayFromApi<GameRoom>(await this.request("/api/v1/game-rooms")); }
  async getRoom(roomId: string): Promise<GameRoom> {
    return this.request<GameRoom>(`/api/v1/game-rooms/${encodeURIComponent(roomId)}`);
  }
  async createRoom(input: CreateRoomInput): Promise<GameRoom> {
    return this.request<GameRoom>("/api/v1/game-rooms", this.body(input));
  }
  async joinRoom(input: JoinRoomInput): Promise<GameRoom> {
    const id = input.roomId ?? input.code;
    if (!id) throw new SocialError("INVALID_INPUT", "请输入房间码");
    return this.request<GameRoom>(`/api/v1/game-rooms/${encodeURIComponent(id)}/join`, this.body({}));
  }
  async setReady(roomId: string, ready: boolean): Promise<void> {
    await this.request<unknown>(`/api/v1/game-rooms/${encodeURIComponent(roomId)}/ready`, this.body({ ready }));
  }
  async sendMove(input: GameMoveInput): Promise<void> {
    await this.waitForRealtime();
    const socket = this.socket;
    if (!socket?.send || !this.realtimeReady) {
      throw new SocialError("NETWORK", "实时连接尚未就绪，请稍后重试");
    }
    const requestId = `move_${this.now()}_${++this.realtimeRequestCounter}`;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingMoves.delete(requestId);
        reject(new SocialError("NETWORK", "落子确认超时，正在重新同步棋局"));
      }, Math.min(this.requestTimeoutMs, REALTIME_MOVE_TIMEOUT_MS));
      this.pendingMoves.set(requestId, { resolve, reject, timer });
      try {
        socket.send?.(JSON.stringify({
          version: 1,
          type: "game.move.submit",
          requestId,
          roomId: input.roomId,
          seq: input.seq,
          payload: { move: input },
        }));
      } catch (error) {
        clearTimeout(timer);
        this.pendingMoves.delete(requestId);
        reject(new SocialError("NETWORK", socialErrorMessage(error)));
      }
    });
  }
  async requestUndo(roomId: string): Promise<void> {
    await this.request<unknown>(`/api/v1/game-rooms/${encodeURIComponent(roomId)}/undo-request`, this.body({}));
  }
  async respondUndo(input: UndoResponseInput): Promise<void> {
    await this.request<unknown>(`/api/v1/game-rooms/${encodeURIComponent(input.roomId)}/undo-response`, this.body({ accept: input.accept }));
  }
  async resign(roomId: string): Promise<void> { await this.request<unknown>(`/api/v1/game-rooms/${encodeURIComponent(roomId)}/resign`, this.body({})); }
  async leaveRoom(roomId: string): Promise<void> { await this.request<unknown>(`/api/v1/game-rooms/${encodeURIComponent(roomId)}`, { method: "DELETE" }); }
  async rematch(roomId: string): Promise<void> { await this.request<unknown>(`/api/v1/game-rooms/${encodeURIComponent(roomId)}/rematch`, this.body({})); }

  private notify(event: SocialEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private setAuthenticated(value: boolean, forceReconnect = false): void {
    this.authenticated = value;
    if (value) {
      if (forceReconnect) this.closeSocket();
      this.connectSocket();
    }
    else {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.closeSocket();
    }
  }

  private updateConnection(connection: SocialSession["connection"]): void {
    if (!this.currentSession || this.currentSession.connection === connection) return;
    this.currentSession = {
      ...this.currentSession,
      connection,
      lastConnectedAt: connection === "connected" ? this.now() : this.currentSession.lastConnectedAt,
    };
    this.notify({ type: "session.updated", session: this.currentSession });
  }

  private resolveRealtimeWaiters(): void {
    for (const waiter of this.realtimeWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    this.realtimeWaiters.clear();
  }

  private rejectRealtimeWaiters(error: SocialError): void {
    for (const waiter of this.realtimeWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.realtimeWaiters.clear();
  }

  private rejectPendingMoves(error: SocialError): void {
    for (const pending of this.pendingMoves.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingMoves.clear();
  }

  private settlePendingMove(requestId: string, error?: SocialError): void {
    const pending = this.pendingMoves.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingMoves.delete(requestId);
    if (error) pending.reject(error);
    else pending.resolve();
  }

  private waitForRealtime(): Promise<void> {
    if (this.realtimeReady && this.socket?.send) return Promise.resolve();
    if (this.closed || !this.authenticated) {
      return Promise.reject(new SocialError("NETWORK", "实时连接尚未登录"));
    }
    this.connectSocket();
    return new Promise<void>((resolve, reject) => {
      const waiter: RealtimeWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.realtimeWaiters.delete(waiter);
          reject(new SocialError("NETWORK", "实时连接建立超时，请检查网络"));
        }, Math.min(this.requestTimeoutMs, REALTIME_READY_TIMEOUT_MS)),
      };
      this.realtimeWaiters.add(waiter);
    });
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private startHeartbeat(socket: WebSocketLike): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket || !this.realtimeReady) return;
      try {
        socket.send?.(JSON.stringify({
          version: 1,
          type: "ping",
          requestId: `ping_${this.now()}`,
          payload: { clientAt: this.now() },
        }));
      } catch {
        socket.close();
      }
    }, REALTIME_HEARTBEAT_MS);
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.realtimeReady = false;
    this.clearHeartbeat();
    const error = new SocialError("NETWORK", "实时连接已关闭");
    this.rejectPendingMoves(error);
    this.rejectRealtimeWaiters(error);
    socket?.close();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closed || !this.authenticated || this.listeners.size === 0) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectSocket();
    }, 1_000);
  }

  private connectSocket(): void {
    if (this.closed || this.socket || this.listeners.size === 0 || !this.authenticated) return;
    try {
      this.updateConnection("connecting");
      const socket = this.webSocketFactory(websocketOrigin(this.origin, this.realtimeOrigin));
      this.socket = socket;
      socket.onopen = () => {
        if (this.socket !== socket) return;
        // Browser sessions can be authenticated by the HttpOnly cookie after
        // a reload, so always send the auth command even when no bearer token
        // is held in renderer memory.
        socket.send?.(JSON.stringify({ version: 1, type: "auth", payload: { token: this.token } }));
      };
      socket.onmessage = (event) => {
        try {
          const envelope = JSON.parse(typeof event.data === "string" ? event.data : "") as SocialRealtimeEnvelope;
          if (envelope.version !== 1) return;
          if (envelope.type === "session.ready") {
            this.realtimeReady = true;
            this.updateConnection("connected");
            this.resolveRealtimeWaiters();
            this.startHeartbeat(socket);
            return;
          }
          if (envelope.type === "pong") return;
          if (envelope.type === "game.move" && typeof envelope.requestId === "string") {
            this.settlePendingMove(envelope.requestId);
          }
          if (envelope.type === "error" && typeof envelope.requestId === "string") {
            const payload = isRecord(envelope.payload) ? envelope.payload : null;
            const code = payload?.code === "UNAUTHORIZED"
              ? "UNAUTHORIZED"
              : payload?.code === "NETWORK"
                ? "NETWORK"
                : "MOVE_REJECTED";
            this.settlePendingMove(envelope.requestId, new SocialError(
              code,
              typeof payload?.message === "string" ? payload.message : "服务器拒绝了这次落子",
            ));
          }
          const socialEvent = eventFromEnvelope(envelope);
          if (socialEvent) this.notify(socialEvent);
        } catch {
          this.notify({ type: "error", code: "NETWORK", message: "实时消息格式无效" });
        }
      };
      socket.onerror = () => {
        if (this.socket === socket) this.updateConnection("error");
        this.notify({ type: "error", code: "NETWORK", message: "实时连接出现错误" });
      };
      socket.onclose = () => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.realtimeReady = false;
        this.clearHeartbeat();
        const error = new SocialError("NETWORK", "实时连接已断开，正在重新连接");
        this.rejectPendingMoves(error);
        this.rejectRealtimeWaiters(error);
        this.updateConnection("offline");
        this.scheduleReconnect();
      };
    } catch (error) {
      this.socket = null;
      this.realtimeReady = false;
      const connectionError = new SocialError("NETWORK", socialErrorMessage(error));
      this.rejectPendingMoves(connectionError);
      this.rejectRealtimeWaiters(connectionError);
      this.updateConnection("error");
      this.notify({ type: "error", code: "NETWORK", message: socialErrorMessage(error) });
      this.scheduleReconnect();
    }
  }

  subscribe(listener: SocialEventListener): () => void {
    this.closed = false;
    this.listeners.add(listener);
    this.connectSocket();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.closeSocket();
      }
    };
  }

  dispose(): void {
    this.closed = true;
    this.authenticated = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const controller of this.requestControllers) controller.abort();
    this.requestControllers.clear();
    this.closeSocket();
    this.listeners.clear();
  }
}
