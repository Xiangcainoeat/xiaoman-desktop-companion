export {
  DEFAULT_SOCIAL_SERVER_ORIGIN,
  SocialClient,
  createSocialClient,
  getDefaultSocialClient,
  resetDefaultSocialClientForTests,
  resolveDefaultSocialOrigin,
} from "./client";
export { GuestLocalTransport } from "./local-transport";
export { ServerSocialTransport } from "./server-transport";
export {
  SocialError,
  acceptInvite,
  acceptFriendRequest,
  applyRoomMove,
  assignRoomSeat,
  assertFriendRequestAllowed,
  canApplyMove,
  declineFriendRequest,
  declineInvite,
  normalizeMessageBody,
  socialErrorMessage,
} from "./state";
export type { SocialClientSnapshot, CreateSocialClientOptions } from "./client";
export type {
  FetchImplementation,
  GuestLocalTransportOptions,
  ServerSocialTransportOptions,
  SocialEventListener,
  SocialRealtimeEnvelope,
  SocialRealtimeType,
  SocialTransport,
  StorageLike,
  WebSocketFactory,
  WebSocketLike,
} from "./transport";
export type * from "./types";
