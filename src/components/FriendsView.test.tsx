import { readFileSync } from "node:fs";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialClient, SocialClientSnapshot } from "../social/client";
import type { GameRoom, SocialUser } from "../social/types";
import { FriendsView } from "./FriendsView";

const hookRuntime = vi.hoisted(() => {
  const slotsByInstance = new Map<string, unknown[]>();
  let slots: unknown[] = [];
  let cursor = 0;

  return {
    reset() {
      slotsByInstance.clear();
      slots = [];
      cursor = 0;
    },
    begin(instance: string) {
      slots = slotsByInstance.get(instance) ?? [];
      slotsByInstance.set(instance, slots);
      cursor = 0;
    },
    useState<T>(initial: T | (() => T)) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      const instanceSlots = slots;
      const setValue = (next: T | ((current: T) => T)) => {
        const current = instanceSlots[index] as T;
        instanceSlots[index] = typeof next === "function" ? (next as (value: T) => T)(current) : next;
      };
      return [slots[index] as T, setValue] as const;
    },
    useRef<T>(initial: T) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index] as { current: T };
    },
    useMemo<T>(factory: () => T) {
      cursor += 1;
      return factory();
    },
    useEffect() {
      cursor += 1;
    },
  };
});

const socialHarness = vi.hoisted(() => ({
  client: null as unknown as SocialClient,
  snapshot: null as unknown as SocialClientSnapshot,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: hookRuntime.useEffect,
    useMemo: hookRuntime.useMemo,
    useRef: hookRuntime.useRef,
    useState: hookRuntime.useState,
  };
});

vi.mock("../social/useSocialClient", () => ({
  useSocialClient: () => ({ client: socialHarness.client, snapshot: socialHarness.snapshot }),
}));

vi.mock("../social/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../social/client")>();
  return { ...actual, getDefaultSocialClient: () => socialHarness.client };
});

const source = readFileSync(new URL("./FriendsView.tsx", import.meta.url), "utf8");
const onlineSource = readFileSync(new URL("./OnlineGamesView.tsx", import.meta.url), "utf8");

type TestNode = ReactNode | ReactElement<{ children?: ReactNode; [key: string]: unknown }>;

const renderedComponents = new Set([
  "AuthenticatedSocialWorkspace",
  "FriendsView",
  "IdentityBar",
  "OnlineGamesView",
  "RoomList",
  "SinglePlayerPanel",
]);

function expandNode(node: TestNode, path = "root"): TestNode {
  if (Array.isArray(node)) return node.map((child, index) => expandNode(child, `${path}.${index}`));
  if (!node || typeof node !== "object" || !("type" in node) || !("props" in node)) return node;

  const element = node as ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
  if (typeof element.type === "function" && renderedComponents.has(element.type.name)) {
    const instance = `${path}:${element.type.name}`;
    hookRuntime.begin(instance);
    const renderComponent = element.type as (props: typeof element.props) => ReactNode;
    return expandNode(renderComponent(element.props), instance);
  }
  if (typeof element.type === "string" || typeof element.type === "symbol") {
    return {
      ...element,
      props: { ...element.props, children: expandNode(element.props.children, `${path}.children`) },
    };
  }
  return element;
}

function renderFriendsView(): TestNode {
  hookRuntime.begin("root:FriendsView");
  return expandNode(FriendsView({ initialSection: "online-games" }), "root:FriendsView");
}

function nodeText(node: TestNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  return nodeText((node as ReactElement<{ children?: ReactNode }>).props.children);
}

function findElements(
  node: TestNode,
  predicate: (element: ReactElement<{ children?: ReactNode; [key: string]: unknown }>) => boolean,
): ReactElement<{ children?: ReactNode; [key: string]: unknown }>[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, predicate));
  if (!node || typeof node !== "object" || !("type" in node) || !("props" in node)) return [];
  const element = node as ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
  return [
    ...(predicate(element) ? [element] : []),
    ...findElements(element.props.children, predicate),
  ];
}

const alice: SocialUser = { id: "alice", username: "alice", displayName: "Alice", avatarUrl: null };
const bob: SocialUser = { id: "bob", username: "bob", displayName: "Bob", avatarUrl: null };

function room(id: string, code: string, gameId: GameRoom["gameId"], status: GameRoom["status"]): GameRoom {
  const timestamp = Date.now();
  return {
    id,
    code,
    gameId,
    hostUserId: alice.id,
    players: {
      red: { user: alice, seat: "red", ready: status === "playing", connected: true },
      black: status === "playing" ? { user: bob, seat: "black", ready: true, connected: true } : null,
    },
    status,
    turn: "red",
    seq: status === "playing" ? 8 : 0,
    position: "",
    lastMove: null,
    winner: null,
    undoRequest: null,
    rematchRequest: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: timestamp + 60 * 60 * 1_000,
  };
}

beforeEach(() => {
  hookRuntime.reset();
  vi.clearAllMocks();
});

describe("friends and online workspace", () => {
  it("keeps room workspaces behind an explicit authentication gate", () => {
    for (const label of ["单机游戏", "联机房间", "我的房间", "登录联机房间", "创建小满账号", "退出登录", "房间号", "复制邀请码", "复制邀请链接", "剩余"]) {
      expect(source).toContain(label);
    }
    expect(source).toContain('snapshot.session.authState !== "authenticated"');
    expect(source).toContain("AuthenticatedSocialWorkspace");
    expect(source).not.toContain("登录好友与联机");
    expect(source).not.toContain("邀请好友");
  });

  it("routes room creation, joining, sharing and play actions through SocialClient", () => {
    for (const method of ["createRoom", "joinRoom", "setReady", "leaveRoom", "resign", "rematch", "refreshRooms"]) {
      expect(source).toContain(`client.${method}`);
    }
    expect(source).toContain("useSocialClient");
    expect(source).toContain("OnlineGomokuBoard");
    expect(source).toContain('import { OnlineBoardGame } from "../online-games"');
    expect(source).toContain("<OnlineBoardGame room={activeRoom} seat={ownSeat} client={client} />");
    expect(source).toContain("roomInviteUrl");
    expect(source).toContain("navigator.share");
    expect(source).not.toContain("selectedFriendId");
    expect(source).not.toContain("sendMessage");
  });

  it("keeps the online game lobby and my-room route separate", () => {
    expect(source).toContain("OnlineGamesView");
    expect(source).toContain('FriendsViewSection = "social" | "online-games"');
    expect(source).toContain('initialSection = "social"');
    for (const label of ["创建或加入联机房间", "我的房间列表", "闲置 1 小时自动销毁", "onOpenSingleGames"]) expect(source).toContain(label);
    expect(source).not.toContain('className="social-section-tabs"');
    expect(onlineSource).toContain("全部联机游戏");
    expect(onlineSource).toContain("查看我的房间");
    expect(onlineSource).toContain("房间只通过房间号");
  });

  it("distinguishes the configured server and does not expose a local fallback", () => {
    expect(source).toContain("连接服务器");
    expect(source).toContain("服务器地址");
    expect(source).toContain("服务器连接");
    expect(source).not.toContain("本地测试对手");
  });

  it("opens a newly created room immediately when another active room is still playing", async () => {
    const oldRoom = room("room-old", "XMOLD001", "gomoku", "playing");
    const newRoom = room("room-new", "XMNEW002", "xiangqi", "waiting");
    let clientRooms = [oldRoom];
    let clientActiveRoomId: string | null = oldRoom.id;

    socialHarness.snapshot = {
      session: {
        authState: "authenticated",
        user: alice,
        serverOrigin: "http://social.test",
        transport: "server",
        connection: "connected",
        lastConnectedAt: Date.now(),
      },
      friends: [],
      friendRequests: [],
      groups: [],
      messages: {},
      invites: [],
      rooms: [oldRoom],
      initialized: true,
      loading: false,
      busy: false,
      error: null,
      activeScope: null,
      activeRoomId: oldRoom.id,
      drafts: {},
    };

    socialHarness.client = {
      getSnapshot: vi.fn(() => ({
        ...socialHarness.snapshot,
        rooms: clientRooms,
        activeRoomId: clientActiveRoomId,
      })),
      getRoom: vi.fn((roomId: string | null) => clientRooms.find((item) => item.id === roomId) ?? null),
      createRoom: vi.fn(async () => {
        clientRooms = [oldRoom, newRoom];
        clientActiveRoomId = newRoom.id;
        return newRoom;
      }),
    } as unknown as SocialClient;

    const lobby = renderFriendsView();
    const createButton = findElements(
      lobby,
      (element) => element.type === "button"
        && element.props.className === "primary-button"
        && nodeText(element).trim() === "创建房间",
    )[0];

    expect(createButton).toBeDefined();
    (createButton.props.onClick as () => void)();
    await vi.waitFor(() => expect(socialHarness.client.createRoom).toHaveBeenCalledTimes(1));

    const roomWorkspace = renderFriendsView();
    expect(nodeText(roomWorkspace)).toContain(newRoom.code);
    expect(nodeText(roomWorkspace)).not.toContain(oldRoom.code);
  });
});
