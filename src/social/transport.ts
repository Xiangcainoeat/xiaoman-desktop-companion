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
  SocialTransportKind,
  SocialUser,
  UndoResponseInput,
} from "./types";

export type SocialEventListener = (event: SocialEvent) => void;

export type SocialRealtimeType =
  | "session.ready"
  | "chat.message"
  | "friend-request.created"
  | "friend-request.updated"
  | "invite.created"
  | "invite.updated"
  | "room.updated"
  | "game.move"
  | "game.move.submit"
  | "game.resync"
  | "ping"
  | "pong"
  | "error";

export interface SocialRealtimeEnvelope<TPayload = unknown> {
  version: 1;
  type: SocialRealtimeType | string;
  requestId?: string;
  roomId?: string;
  seq?: number;
  payload?: TPayload;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface WebSocketLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  /** Optional because the test adapter can model receive-only sockets. */
  send?(data: string): void;
  close(): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface ServerSocialTransportOptions {
  fetchImpl?: FetchImplementation;
  webSocketFactory?: WebSocketFactory;
  webSocketOrigin?: string;
  now?: () => number;
  requestTimeoutMs?: number;
}

export interface GuestLocalTransportOptions {
  storage?: StorageLike | null;
  now?: () => number;
  friendRequests?: FriendRequest[];
}

export interface SocialTransport {
  readonly kind: SocialTransportKind;
  getSession(): Promise<SocialSession>;
  login(input: LoginInput): Promise<SocialSession>;
  register(input: RegisterInput): Promise<SocialSession>;
  logout(): Promise<void>;
  searchUsers(query: string): Promise<SocialUser[]>;
  listFriends(): Promise<Friend[]>;
  listFriendRequests(): Promise<FriendRequest[]>;
  sendFriendRequest(userId: string): Promise<FriendRequest>;
  respondFriendRequest(input: FriendRequestResponse): Promise<void>;
  listGroups(): Promise<ChatGroup[]>;
  listMessages(scope: ChatScope): Promise<ChatMessage[]>;
  sendMessage(input: SendMessageInput): Promise<ChatMessage>;
  listInvites(): Promise<GameInvite[]>;
  createGameInvite(input: GameInviteInput): Promise<GameInvite>;
  respondGameInvite(input: GameInviteResponse): Promise<GameInvite>;
  listRooms(): Promise<GameRoom[]>;
  getRoom(roomId: string): Promise<GameRoom>;
  createRoom(input: CreateRoomInput): Promise<GameRoom>;
  joinRoom(input: JoinRoomInput): Promise<GameRoom>;
  setReady(roomId: string, ready: boolean): Promise<void>;
  sendMove(input: GameMoveInput): Promise<void>;
  requestUndo(roomId: string): Promise<void>;
  respondUndo(input: UndoResponseInput): Promise<void>;
  resign(roomId: string): Promise<void>;
  leaveRoom(roomId: string): Promise<void>;
  rematch(roomId: string): Promise<void>;
  subscribe(listener: SocialEventListener): () => void;
  /** Local-only helper for demonstrating the two-seat room before a server exists. */
  addTestOpponent?(roomId: string): Promise<GameRoom>;
}

export function configuredOrigin(origin: string): string | null {
  const value = origin.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function unwrapApiData<T>(value: unknown): T {
  if (value && typeof value === "object" && "data" in value) {
    return (value as { data: T }).data;
  }
  return value as T;
}

export function arrayFromApi<T>(value: unknown): T[] {
  const unwrapped = unwrapApiData<unknown>(value);
  if (Array.isArray(unwrapped)) return unwrapped as T[];
  if (unwrapped && typeof unwrapped === "object" && "items" in unwrapped) {
    const items = (unwrapped as { items: unknown }).items;
    return Array.isArray(items) ? items as T[] : [];
  }
  return [];
}
