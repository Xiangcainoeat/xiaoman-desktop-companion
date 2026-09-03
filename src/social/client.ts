import {
  applyRoomMove,
  canApplyMove,
  socialErrorMessage,
  SocialError,
} from "./state";
import { ServerSocialTransport } from "./server-transport";
import { chatScopeKey } from "./types";
import type {
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
  SocialDataSnapshot,
  SocialEvent,
  SocialSession,
  SocialUser,
  UndoResponseInput,
} from "./types";
import type { SocialEventListener, SocialTransport, StorageLike } from "./transport";
import { DEFAULT_XIAOMAN_SERVER_ORIGIN, normalizeServerOrigin } from "../shared/server-origin";

export interface SocialClientSnapshot extends SocialDataSnapshot {
  initialized: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
  activeScope: ChatScope | null;
  activeRoomId: string | null;
  drafts: Record<string, string>;
}

export interface CreateSocialClientOptions {
  transport?: SocialTransport;
  serverOrigin?: string;
  serverWebSocketOrigin?: string;
  storage?: StorageLike | null;
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function initialSession(transport: SocialTransport): SocialSession {
  return {
    authState: transport.kind === "local" ? "guest" : "connecting",
    user: null,
    serverOrigin: null,
    transport: transport.kind,
    connection: transport.kind === "local" ? "local" : "connecting",
    lastConnectedAt: null,
  };
}

function initialSnapshot(transport: SocialTransport): SocialClientSnapshot {
  return {
    session: initialSession(transport),
    friends: [],
    friendRequests: [],
    groups: [],
    messages: {},
    invites: [],
    rooms: [],
    initialized: false,
    loading: false,
    busy: false,
    error: null,
    activeScope: null,
    activeRoomId: null,
    drafts: {},
  };
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((current) => current.id === item.id);
  if (index < 0) return [...items, item];
  const next = items.slice();
  next[index] = item;
  return next;
}

function upsertMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (messages.some((item) => item.id === message.id)) return messages;
  return [...messages, message].sort((left, right) => left.createdAt - right.createdAt);
}

function isAuthenticatedSession(session: SocialSession): boolean {
  return session.authState === "authenticated";
}

export class SocialClient {
  private readonly transport: SocialTransport;
  private readonly listeners = new Set<(snapshot: SocialClientSnapshot) => void>();
  private readonly stopTransport: () => void;
  private snapshot: SocialClientSnapshot;
  private initializePromise: Promise<void> | null = null;
  private reconnectRefreshPromise: Promise<void> | null = null;
  private authRevision = 0;
  private disposed = false;

  constructor(transport: SocialTransport) {
    this.transport = transport;
    this.snapshot = initialSnapshot(transport);
    this.stopTransport = transport.subscribe((event) => this.handleEvent(event));
  }

  getSnapshot(): SocialClientSnapshot {
    return clone(this.snapshot);
  }

  subscribe(listener: (snapshot: SocialClientSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(next: Partial<SocialClientSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...next };
    const safeSnapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(safeSnapshot);
  }

  private setError(error: unknown): void {
    this.publish({ error: socialErrorMessage(error) });
  }

  private async request<T>(operation: () => Promise<T>): Promise<T> {
    this.publish({ busy: true });
    try {
      const result = await operation();
      this.publish({ busy: false, error: null });
      return result;
    } catch (error) {
      this.publish({ busy: false, error: socialErrorMessage(error) });
      throw error;
    }
  }

  private async refreshCollections(revision = this.authRevision): Promise<void> {
    // The current product surface is room-only. Legacy friend/chat/invite
    // methods remain on the transport contract for older clients, but the
    // default session lifecycle must not fetch those collections.
    const rooms = await this.transport.listRooms();
    if (revision !== this.authRevision || this.disposed) return;
    this.publish({ rooms, error: null });
  }

  /** Refresh the participant's rooms after reconnecting or returning to the app. */
  async refreshRooms(revision = this.authRevision): Promise<void> {
    const rooms = await this.transport.listRooms();
    if (revision !== this.authRevision || this.disposed) return;
    const activeRoomId = this.snapshot.activeRoomId && rooms.some((room) => room.id === this.snapshot.activeRoomId)
      ? this.snapshot.activeRoomId
      : null;
    this.publish({ rooms, activeRoomId });
  }

  /** Refresh one room after a rejected move or a realtime sequence gap. */
  async refreshRoom(roomId: string, revision = this.authRevision): Promise<GameRoom | null> {
    try {
      const room = await this.transport.getRoom(roomId);
      if (revision !== this.authRevision || this.disposed) return null;
      this.publish({ rooms: upsertById(this.snapshot.rooms, clone(room)) });
      return clone(room);
    } catch (error) {
      if (revision === this.authRevision && !this.disposed) {
        const message = socialErrorMessage(error);
        if (message.includes("找不到") || message.includes("过期") || message.includes("不可用")) {
          this.publish({
            rooms: this.snapshot.rooms.filter((item) => item.id !== roomId),
            activeRoomId: this.snapshot.activeRoomId === roomId ? null : this.snapshot.activeRoomId,
            error: null,
          });
        } else {
          this.setError(error);
        }
      }
      throw error;
    }
  }

  private refreshAfterReconnect(): void {
    if (this.reconnectRefreshPromise || this.disposed || !isAuthenticatedSession(this.snapshot.session)) return;
    const revision = this.authRevision;
    this.reconnectRefreshPromise = this.refreshCollections(revision)
      .catch((error) => {
        if (revision === this.authRevision && !this.disposed) this.setError(error);
      })
      .finally(() => {
        this.reconnectRefreshPromise = null;
      });
  }

  private clearPrivateData(revision = this.authRevision): void {
    if (revision !== this.authRevision || this.disposed) return;
    this.publish({
      friends: [],
      friendRequests: [],
      groups: [],
      messages: {},
      invites: [],
      rooms: [],
      activeScope: null,
      activeRoomId: null,
      drafts: {},
    });
  }

  async initialize(): Promise<void> {
    if (this.disposed) return;
    if (this.initializePromise) return this.initializePromise;
    const revision = this.authRevision;
    this.publish({ loading: true, error: null });
    this.initializePromise = (async () => {
      try {
        const session = await this.transport.getSession();
        if (revision !== this.authRevision || this.disposed) return;
        const canReadCollections = this.transport.kind === "local"
          || isAuthenticatedSession(session);
        if (!canReadCollections) {
          this.clearPrivateData(revision);
          this.publish({ session, initialized: true, loading: false, error: null });
          return;
        }
        // Only participant rooms are part of the authenticated workspace.
        const rooms = await this.transport.listRooms();
        if (revision !== this.authRevision || this.disposed) return;
        this.publish({ session, rooms, initialized: true, loading: false, error: null });
      } catch (error) {
        if (revision !== this.authRevision || this.disposed) return;
        const session = this.snapshot.session;
        this.publish({
          session: {
            ...session,
            authState: session.authState === "authenticated" ? "offline" : "guest",
            connection: "error",
          },
          initialized: true,
          loading: false,
        });
        this.setError(error);
      }
    })();
    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  async login(input: LoginInput): Promise<SocialSession> {
    const revision = ++this.authRevision;
    const session = await this.request(() => this.transport.login(input));
    if (revision !== this.authRevision || this.disposed) return clone(session);
    this.publish({ session, initialized: true, loading: false });
    try {
      if (isAuthenticatedSession(session)) await this.refreshCollections(revision);
      else this.clearPrivateData(revision);
    } catch (error) {
      if (revision === this.authRevision) this.setError(error);
    }
    return clone(session);
  }

  async register(input: RegisterInput): Promise<SocialSession> {
    const revision = ++this.authRevision;
    const session = await this.request(() => this.transport.register(input));
    if (revision !== this.authRevision || this.disposed) return clone(session);
    this.publish({ session, initialized: true, loading: false });
    try {
      if (isAuthenticatedSession(session)) await this.refreshCollections(revision);
      else this.clearPrivateData(revision);
    } catch (error) {
      if (revision === this.authRevision) this.setError(error);
    }
    return clone(session);
  }

  async logout(): Promise<void> {
    const revision = ++this.authRevision;
    await this.request(() => this.transport.logout());
    const session = await this.transport.getSession();
    if (revision !== this.authRevision || this.disposed) return;
    this.clearPrivateData(revision);
    try {
      if (isAuthenticatedSession(session)) await this.refreshCollections(revision);
    } catch (error) {
      if (revision === this.authRevision) this.setError(error);
    }
    this.publish({ session, initialized: true, loading: false });
  }

  async selectScope(scope: ChatScope): Promise<void> {
    this.publish({ activeScope: clone(scope), error: null });
    try {
      const messages = await this.transport.listMessages(scope);
      this.publish({ messages: { ...this.snapshot.messages, [chatScopeKey(scope)]: messages } });
    } catch (error) {
      this.setError(error);
      throw error;
    }
  }

  async searchUsers(query: string): Promise<SocialUser[]> {
    return this.request(() => this.transport.searchUsers(query));
  }

  async sendFriendRequest(userId: string): Promise<FriendRequest> {
    const request = await this.request(() => this.transport.sendFriendRequest(userId));
    this.publish({ friendRequests: upsertById(this.snapshot.friendRequests, clone(request)) });
    return clone(request);
  }

  async respondFriendRequest(input: FriendRequestResponse): Promise<void> {
    await this.request(() => this.transport.respondFriendRequest(input));
    const [friendRequests, friends] = await Promise.all([
      this.transport.listFriendRequests(),
      this.transport.listFriends(),
    ]);
    this.publish({ friendRequests, friends });
  }

  setDraft(scope: ChatScope, body: string): void {
    this.publish({ drafts: { ...this.snapshot.drafts, [chatScopeKey(scope)]: body } });
  }

  getDraft(scope: ChatScope): string { return this.snapshot.drafts[chatScopeKey(scope)] ?? ""; }

  async sendMessage(input: SendMessageInput): Promise<ChatMessage> {
    const message = await this.request(() => this.transport.sendMessage(input));
    const key = chatScopeKey(input.scope);
    this.publish({
      messages: { ...this.snapshot.messages, [key]: upsertMessage(this.snapshot.messages[key] ?? [], message) },
      drafts: { ...this.snapshot.drafts, [key]: "" },
    });
    return clone(message);
  }

  async createGameInvite(input: GameInviteInput): Promise<GameInvite> {
    const invite = await this.request(() => this.transport.createGameInvite(input));
    this.publish({ invites: upsertById(this.snapshot.invites, invite) });
    return clone(invite);
  }

  async respondGameInvite(input: GameInviteResponse): Promise<GameInvite> {
    const acceptedInvite = await this.request(() => this.transport.respondGameInvite(input));
    const invites = await this.transport.listInvites();
    this.publish({ invites });
    if (acceptedInvite.status === "accepted" && acceptedInvite.roomId) {
      try { await this.refreshRooms(); } catch { /* the acceptance response remains usable for joining */ }
    }
    return clone(acceptedInvite);
  }

  async createRoom(input: CreateRoomInput): Promise<GameRoom> {
    const room = await this.request(() => this.transport.createRoom(input));
    this.publish({ rooms: upsertById(this.snapshot.rooms, clone(room)), activeRoomId: room.id });
    return clone(room);
  }

  async joinRoom(input: JoinRoomInput): Promise<GameRoom> {
    const room = await this.request(() => this.transport.joinRoom(input));
    this.publish({ rooms: upsertById(this.snapshot.rooms, clone(room)), activeRoomId: room.id });
    return clone(room);
  }

  async addTestOpponent(roomId: string): Promise<GameRoom> {
    if (!this.transport.addTestOpponent) throw new SocialError("CONFIGURATION", "当前传输器不支持本地测试对手");
    return this.request(() => this.transport.addTestOpponent!(roomId));
  }

  async setReady(roomId: string, ready: boolean): Promise<void> {
    await this.request(() => this.transport.setReady(roomId, ready));
    try { await this.refreshRooms(); } catch { /* realtime events remain authoritative when refresh is unavailable */ }
  }

  async sendMove(input: GameMoveInput): Promise<void> {
    const room = this.getRoom(input.roomId);
    if (!room || !canApplyMove(room, input)) {
      throw new SocialError("MOVE_REJECTED", "走子序号或回合不匹配，请重新同步棋局");
    }
    const optimisticRoom = {
      ...applyRoomMove(room, input),
      // Keep the server timestamp authoritative. A client clock that runs
      // ahead must not make the later room snapshot look stale.
      updatedAt: room.updatedAt,
    };
    this.publish({ rooms: upsertById(this.snapshot.rooms, optimisticRoom), error: null });
    try {
      await this.request(() => this.transport.sendMove(input));
    } catch (error) {
      try {
        await this.refreshRoom(input.roomId);
      } catch {
        const current = this.getRoom(input.roomId);
        if (!current || current.seq <= input.seq) {
          this.publish({ rooms: upsertById(this.snapshot.rooms, room) });
        }
      }
      throw error;
    }
  }

  async requestUndo(roomId: string): Promise<void> {
    await this.request(() => this.transport.requestUndo(roomId));
    try { await this.refreshRoom(roomId); } catch { /* realtime room updates remain authoritative */ }
  }

  async respondUndo(input: UndoResponseInput): Promise<void> {
    await this.request(() => this.transport.respondUndo(input));
    try { await this.refreshRoom(input.roomId); } catch { /* realtime room updates remain authoritative */ }
  }

  async resign(roomId: string): Promise<void> {
    await this.request(() => this.transport.resign(roomId));
    try { await this.refreshRooms(); } catch { /* realtime events remain authoritative when refresh is unavailable */ }
  }
  async leaveRoom(roomId: string): Promise<void> {
    await this.request(() => this.transport.leaveRoom(roomId));
    if (this.snapshot.activeRoomId === roomId) this.publish({ activeRoomId: null });
    try { await this.refreshRooms(); } catch { /* realtime events remain authoritative when refresh is unavailable */ }
  }
  async rematch(roomId: string): Promise<void> {
    await this.request(() => this.transport.rematch(roomId));
    try { await this.refreshRooms(); } catch { /* realtime events remain authoritative when refresh is unavailable */ }
  }

  getRoom(roomId: string | null): GameRoom | null {
    if (!roomId) return null;
    return this.snapshot.rooms.find((room) => room.id === roomId) ?? null;
  }

  clearError(): void { this.publish({ error: null }); }

  private handleEvent(event: SocialEvent): void {
    if (this.disposed) return;
    switch (event.type) {
      case "session.updated":
        {
          const wasDisconnected = this.snapshot.session.connection === "offline"
            || this.snapshot.session.connection === "error";
          const shouldRefresh = wasDisconnected
            && event.session.connection === "connected"
            && isAuthenticatedSession(event.session)
            && this.snapshot.initialized;
          this.publish({ session: clone(event.session) });
          if (!isAuthenticatedSession(event.session)) this.clearPrivateData();
          else if (shouldRefresh) this.refreshAfterReconnect();
        }
        return;
      case "chat.message": {
        const key = chatScopeKey(event.message.scope);
        this.publish({ messages: { ...this.snapshot.messages, [key]: upsertMessage(this.snapshot.messages[key] ?? [], clone(event.message)) } });
        return;
      }
      case "friend-request.created":
      case "friend-request.updated":
        this.publish({ friendRequests: upsertById(this.snapshot.friendRequests, clone(event.request)) });
        return;
      case "invite.created":
      case "invite.updated":
        this.publish({ invites: upsertById(this.snapshot.invites, clone(event.invite)) });
        if (event.type === "invite.updated" && event.invite.status === "accepted" && event.invite.roomId) {
          void this.refreshRooms().catch(() => undefined);
        }
        return;
      case "room.updated":
        {
          const current = this.getRoom(event.room.id);
          if (current && event.room.seq < current.seq) return;
          this.publish({ rooms: upsertById(this.snapshot.rooms, clone(event.room)) });
        }
        return;
      case "game.move": {
        const room = this.getRoom(event.move.roomId);
        if (!room) {
          void this.refreshRoom(event.move.roomId).catch(() => undefined);
          return;
        }
        if (event.move.seq <= room.seq) return;
        if (!canApplyMove(room, event.move)) {
          this.setError("走子序号或回合不匹配，请重新同步棋局");
          void this.refreshRoom(room.id).catch(() => undefined);
          return;
        }
        this.publish({ rooms: upsertById(this.snapshot.rooms, applyRoomMove(room, event.move)) });
        return;
      }
      case "game.resync": {
        const room = this.getRoom(event.roomId);
        if (!room || event.seq < room.seq) return;
        this.publish({ rooms: upsertById(this.snapshot.rooms, {
          ...room,
          position: event.position,
          seq: event.seq,
          turn: event.turn,
          lastMove: null,
          updatedAt: Date.now(),
        }) });
        return;
      }
      case "error":
        this.setError(event.message);
        return;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTransport();
    if ("dispose" in this.transport && typeof this.transport.dispose === "function") {
      (this.transport as SocialTransport & { dispose(): void }).dispose();
    }
    this.listeners.clear();
  }
}

export function createSocialClient(options: CreateSocialClientOptions = {}): SocialClient {
  if (options.transport) return new SocialClient(options.transport);
  const origin = configuredOriginForClient(options.serverOrigin ?? resolveDefaultSocialOrigin() ?? "");
  if (!origin) throw new SocialError("CONFIGURATION", "未配置有效的联机服务器地址");
  return new SocialClient(new ServerSocialTransport(origin, {
    webSocketOrigin: options.serverWebSocketOrigin,
  }));
}

export const DEFAULT_SOCIAL_SERVER_ORIGIN = DEFAULT_XIAOMAN_SERVER_ORIGIN;

export function resolveDefaultSocialOrigin(): string | null {
  const configured = typeof import.meta.env?.VITE_SOCIAL_SERVER_ORIGIN === "string"
    ? import.meta.env.VITE_SOCIAL_SERVER_ORIGIN
    : "";
  if (configured.trim()) return configuredOriginForClient(configured);
  if (typeof window !== "undefined" && (window.location.protocol === "http:" || window.location.protocol === "https:")) {
    const host = window.location.hostname.toLowerCase();
    if (!(import.meta.env?.DEV && (host === "localhost" || host === "127.0.0.1"))) {
      return window.location.origin;
    }
  }
  return DEFAULT_SOCIAL_SERVER_ORIGIN;
}

function configuredOriginForClient(origin: string): string | null {
  return normalizeServerOrigin(origin);
}

let defaultClient: SocialClient | null = null;

export function getDefaultSocialClient(): SocialClient {
  if (!defaultClient) {
    const origin = resolveDefaultSocialOrigin();
    defaultClient = createSocialClient({ serverOrigin: origin ?? undefined });
  }
  return defaultClient;
}

export function resetDefaultSocialClientForTests(): void {
  defaultClient?.dispose();
  defaultClient = null;
}
