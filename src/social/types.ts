/** Games with a server-backed room implementation. Keep this list in sync with the server. */
export const SOCIAL_GAME_IDS = [
  "gomoku",
  "tic-tac-toe",
  "chess",
  "reversi",
  "checkers",
  "xiangqi",
  "go",
  "shogi",
  "connect6",
  "ludo",
  "animal-chess",
  "army-chess",
  "backgammon",
  "dots-and-boxes",
  "mancala",
  "chinese-checkers",
] as const;
export const GOMOKU_BOARD_SIZE = 15;
export const GOMOKU_POSITION_LENGTH = GOMOKU_BOARD_SIZE * GOMOKU_BOARD_SIZE;
/** Rooms are removed after this much time without a server-side activity. */
export const ROOM_IDLE_TTL_MS = 60 * 60 * 1000;
export type SocialGameId = (typeof SOCIAL_GAME_IDS)[number];

export type SocialAuthState = "guest" | "authenticated" | "connecting" | "offline";
export type SocialTransportKind = "local" | "server";
export type SocialConnectionState = "local" | "connecting" | "connected" | "offline" | "error";

export interface SocialUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface SocialSession {
  authState: SocialAuthState;
  user: SocialUser | null;
  serverOrigin: string | null;
  transport: SocialTransportKind;
  connection: SocialConnectionState;
  lastConnectedAt: number | null;
}

export type LoginInput = {
  username: string;
  password: string;
};

export type RegisterInput = LoginInput & {
  displayName: string;
};

export type FriendPresence = "online" | "away" | "offline";

export interface Friend {
  id: string;
  user: SocialUser;
  presence: FriendPresence;
  lastSeenAt: number | null;
  unreadCount: number;
}

export type FriendRequestStatus = "pending" | "accepted" | "declined";

export interface FriendRequest {
  id: string;
  from: SocialUser;
  to: SocialUser;
  status: FriendRequestStatus;
  createdAt: number;
  updatedAt: number;
}

export interface FriendRequestResponse {
  requestId: string;
  response: "accept" | "decline";
}

export interface ChatGroup {
  id: string;
  name: string;
  memberCount: number;
  memberIds: string[];
  accent: string;
  unreadCount: number;
}

export type ChatScope =
  | { kind: "direct"; friendId: string }
  | { kind: "group"; groupId: string };

export function chatScopeKey(scope: ChatScope): string {
  return `${scope.kind}:${scope.kind === "direct" ? scope.friendId : scope.groupId}`;
}

export interface ChatMessage {
  id: string;
  scope: ChatScope;
  sender: SocialUser;
  body: string;
  createdAt: number;
  pending?: boolean;
}

export type GameInviteStatus = "pending" | "accepted" | "declined" | "expired";

export interface GameInvite {
  id: string;
  gameId: SocialGameId;
  from: SocialUser;
  to: SocialUser;
  roomId: string | null;
  status: GameInviteStatus;
  createdAt: number;
  expiresAt: number;
}

export type GameSeat = "red" | "black";
export type GameRoomStatus = "waiting" | "ready" | "playing" | "paused" | "finished" | "left";

export interface RoomPlayer {
  user: SocialUser;
  seat: GameSeat;
  ready: boolean;
  connected?: boolean;
}

export interface XiangqiPoint {
  x: number;
  y: number;
}

export interface GameMove {
  roomId: string;
  gameId: SocialGameId;
  seat: GameSeat;
  /** Xiangqi uses from/to as source and destination; Gomoku uses the same point twice. */
  from: XiangqiPoint;
  to: XiangqiPoint;
  captured: XiangqiPoint | null;
  position: string;
  seq: number;
  createdAt: number;
}

export interface GameRoom {
  id: string;
  code: string;
  gameId: SocialGameId;
  hostUserId: string;
  players: Record<GameSeat, RoomPlayer | null>;
  status: GameRoomStatus;
  turn: GameSeat;
  seq: number;
  position: string;
  lastMove: GameMove | null;
  winner: GameSeat | null;
  undoRequest?: {
    requestedByUserId: string;
    requestedAt: number;
  } | null;
  rematchRequest?: {
    requestedByUserId: string;
    requestedAt: number;
  } | null;
  createdAt: number;
  updatedAt: number;
  /** Server-provided expiry; older transports may omit it. */
  expiresAt?: number;
}

export interface CreateRoomInput {
  gameId: SocialGameId;
}

export interface JoinRoomInput {
  roomId?: string;
  code?: string;
}

export interface GameInviteInput {
  gameId: SocialGameId;
  toUserId: string;
  roomId?: string | null;
}

export interface GameInviteResponse {
  inviteId: string;
  response: "accept" | "decline";
}

export interface SendMessageInput {
  scope: ChatScope;
  body: string;
}

export interface GameMoveInput extends GameMove {}

export interface UndoResponseInput {
  roomId: string;
  accept: boolean;
}

export type SocialEvent =
  | { type: "session.updated"; session: SocialSession }
  | { type: "chat.message"; message: ChatMessage }
  | { type: "friend-request.created"; request: FriendRequest }
  | { type: "friend-request.updated"; request: FriendRequest }
  | { type: "invite.created"; invite: GameInvite }
  | { type: "invite.updated"; invite: GameInvite }
  | { type: "room.updated"; room: GameRoom }
  | { type: "game.move"; move: GameMove }
  | { type: "game.resync"; roomId: string; position: string; seq: number; turn: GameSeat }
  | { type: "error"; code: string; message: string; requestId?: string };

export interface SocialDataSnapshot {
  session: SocialSession;
  friends: Friend[];
  friendRequests: FriendRequest[];
  groups: ChatGroup[];
  messages: Record<string, ChatMessage[]>;
  invites: GameInvite[];
  rooms: GameRoom[];
}
