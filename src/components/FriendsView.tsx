import {
  ArrowLeft,
  Check,
  CircleAlert,
  Copy,
  Gamepad2,
  KeyRound,
  Link2,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  Server,
  Share2,
  Timer,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  createSocialClient,
  getDefaultSocialClient,
  resolveDefaultSocialOrigin,
  type SocialClient,
  type SocialClientSnapshot,
} from "../social/client";
import { socialErrorMessage } from "../social/state";
import { ROOM_IDLE_TTL_MS } from "../social/types";
import type { GameRoom, GameSeat, SocialGameId, SocialSession } from "../social/types";
import { useSocialClient } from "../social/useSocialClient";
import { OnlineBoardGame } from "../online-games";
import { OnlineGomokuBoard } from "./OnlineGomokuBoard";
import { OnlineGameWorkspace } from "./OnlineGameWorkspace";
import { ONLINE_GAME_CATALOG, OnlineGamesView, onlineGameLabel } from "./OnlineGamesView";
import type { OnlineGameId } from "../online-games/types";

type RoomTab = "single" | "online" | "mine";

/**
 * This union remains part of the bridge contract for older desktop builds.
 * Both legacy values now resolve to the room workspace; friend/chat views are
 * intentionally no longer rendered.
 */
export type FriendsViewSection = "social" | "online-games";

const ONLINE_GAME_OPTIONS: Array<{ id: OnlineGameId; label: string }> = ONLINE_GAME_CATALOG.map(({ id, label }) => ({ id, label }));
const BLACK_WHITE_GAME_IDS = new Set(["gomoku", "go", "connect6", "reversi", "checkers"]);
const RED_BLUE_GAME_IDS = new Set(["shogi", "animal-chess", "chinese-checkers", "army-chess"]);

function asSocialGameId(gameId: OnlineGameId): SocialGameId {
  return gameId as unknown as SocialGameId;
}

function gameLabel(gameId: SocialGameId | string): string {
  return onlineGameLabel(gameId);
}

function seatLabel(gameId: SocialGameId | string, seat: GameSeat): string {
  if (gameId === "chess") return seat === "red" ? "白方" : "黑方";
  if (BLACK_WHITE_GAME_IDS.has(gameId)) return seat === "red" ? "黑方" : "白方";
  if (RED_BLUE_GAME_IDS.has(gameId)) return seat === "red" ? "红方" : "蓝方";
  return seat === "red" ? "红方" : "黑方";
}

function roomExpiresAt(room: GameRoom): number {
  return room.expiresAt ?? room.updatedAt + ROOM_IDLE_TTL_MS;
}

function formatRemaining(milliseconds: number): string {
  if (milliseconds <= 0) return "已过期";
  const totalSeconds = Math.ceil(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return hours + "小时" + String(minutes).padStart(2, "0") + "分";
  if (minutes > 0) return minutes + "分" + String(seconds).padStart(2, "0") + "秒";
  return seconds + "秒";
}

function roomStatus(room: GameRoom): string {
  if (room.status === "playing") return "对局中 · 第 " + room.seq + " 手";
  if (room.status === "finished") return room.winner ? seatLabel(room.gameId, room.winner) + "获胜" : "本局已结束";
  if (room.status === "left") return "房间已结束";
  if (room.players.red && room.players.black) return "等待双方准备";
  return "等待对手加入";
}

function roomInviteUrl(room: GameRoom, snapshot: SocialClientSnapshot): string {
  const fallback = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const origin = snapshot.session.serverOrigin || resolveDefaultSocialOrigin() || fallback;
  try {
    const url = new URL(origin);
    url.searchParams.set("tab", "online");
    url.searchParams.set("room", room.code);
    return url.toString();
  } catch {
    return fallback + "/?tab=online&room=" + encodeURIComponent(room.code);
  }
}

function roomCodeFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const value = params.get("room")?.trim();
  return value || null;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function sessionLabel(session: SocialSession): string {
  if (session.connection === "connected") return "服务器已连接";
  if (session.connection === "connecting") return "正在连接服务器";
  if (session.connection === "offline") return "服务器离线";
  if (session.connection === "local") return "本地";
  return "服务器连接异常";
}

function AuthGate({
  client,
  snapshot,
  serverOrigin,
  setServerOrigin,
  onConnect,
  notice,
}: {
  client: SocialClient;
  snapshot: SocialClientSnapshot;
  serverOrigin: string;
  setServerOrigin: (value: string) => void;
  onConnect: () => void;
  notice: string;
}) {
  const [registerMode, setRegisterMode] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      if (registerMode) await client.register({ username, password, displayName });
      else await client.login({ username, password });
      setPassword("");
    } catch {
      // SocialClient publishes the authoritative error banner.
    }
  };

  return (
    <section className="social-auth-gate">
      <div className="social-auth-mark"><KeyRound size={25} /></div>
      <div className="social-auth-copy">
        <span className="eyebrow">服务器联机</span>
        <h3>{registerMode ? "创建小满账号" : "登录联机房间"}</h3>
        <p>登录后可以创建房间、分享邀请链接或邀请码，也可以输入房间号加入对局。</p>
      </div>
      <form className="social-auth-form" onSubmit={submit}>
        {registerMode && (
          <label>
            <span>显示名称</span>
            <input value={displayName} placeholder="例如 小满玩家" aria-label="显示名称" maxLength={32} autoComplete="nickname" onChange={(event) => setDisplayName(event.target.value)} />
          </label>
        )}
        <label>
          <span>账号</span>
          <input value={username} placeholder="输入账号" aria-label="账号" autoComplete="username" onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          <span>密码</span>
          <input value={password} placeholder="输入密码" aria-label="密码" type="password" autoComplete={registerMode ? "new-password" : "current-password"} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button className="primary-button" type="submit" disabled={snapshot.busy}>
          <LogIn size={16} />{registerMode ? "注册并登录" : "登录"}
        </button>
      </form>
      <button className="text-button social-auth-switch" type="button" onClick={() => setRegisterMode((value) => !value)}>
        {registerMode ? "已有账号，返回登录" : "没有账号？注册一个"}
      </button>
      <div className="social-server-connect">
        <div className="social-server-connect-title">
          <Server size={17} />
          <span><strong>服务器连接</strong><small>{sessionLabel(snapshot.session)}</small></span>
        </div>
        <div className="social-server-connect-form">
          <input value={serverOrigin} placeholder="服务器地址" aria-label="服务器地址" onChange={(event) => setServerOrigin(event.target.value)} />
          <button className="secondary-button" type="button" onClick={onConnect} disabled={!serverOrigin.trim() || snapshot.busy}>
            <RefreshCw size={15} />重新连接
          </button>
        </div>
        {serverOrigin.startsWith("http://") && <p className="social-security-note">当前使用 HTTP 连接；部署 HTTPS 后可直接替换服务器地址。</p>}
      </div>
      {notice && <div className="social-notice" role="status">{notice}</div>}
    </section>
  );
}

function IdentityBar({ client, snapshot }: { client: SocialClient; snapshot: SocialClientSnapshot }) {
  const user = snapshot.session.user;
  if (!user) return null;
  return (
    <section className="social-identity-panel">
      <div className="social-identity-main">
        <span className="social-avatar presence-online">{user.displayName.slice(0, 1)}</span>
        <span><strong>{user.displayName}</strong><small>@{user.username} · {sessionLabel(snapshot.session)}</small></span>
      </div>
      <button className="secondary-button" type="button" title="退出登录" aria-label="退出登录" onClick={() => void client.logout().catch(() => undefined)}>
        <LogOut size={15} />退出登录
      </button>
    </section>
  );
}

function SinglePlayerPanel({ onOpenSingleGames }: { onOpenSingleGames?: () => void }) {
  return (
    <section className="social-single-player-panel">
      <div className="social-single-player-hero">
        <span className="social-panel-icon"><Gamepad2 size={23} /></span>
        <div>
          <span className="eyebrow">单机游戏</span>
          <h3>服务器直接开始</h3>
          <p>象棋、俄罗斯方块、2048、马里奥等内容由服务器统一提供，桌面端和手机网页使用同一版本。</p>
        </div>
      </div>
      <div className="social-single-player-list">
        <span>无需登录</span>
        <span>无需下载游戏包</span>
        <span>支持桌面和手机操作</span>
      </div>
      <button className="primary-button" type="button" onClick={onOpenSingleGames} disabled={!onOpenSingleGames}>
        <Gamepad2 size={16} />打开单机游戏
      </button>
    </section>
  );
}

function RoomList({
  client,
  snapshot,
  initialRoomCode,
  selectedRoomId,
  onSelectRoom,
}: {
  client: SocialClient;
  snapshot: SocialClientSnapshot;
  initialRoomCode: string | null;
  selectedRoomId: string | null;
  onSelectRoom: (roomId: string | null) => void;
}) {
  const [code, setCode] = useState("");
  const [selectedGame, setSelectedGame] = useState<OnlineGameId>("gomoku");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const attemptedLink = useRef("");
  const rawActiveRoom = client.getRoom(selectedRoomId);
  const activeRoom = rawActiveRoom && roomExpiresAt(rawActiveRoom) > now ? rawActiveRoom : null;
  const roomRows = snapshot.rooms.filter((room) => roomExpiresAt(room) > now);
  const ownId = snapshot.session.user?.id ?? null;
  const ownSeat: GameSeat | null = activeRoom?.players.red?.user.id === ownId
    ? "red"
    : activeRoom?.players.black?.user.id === ownId
      ? "black"
      : null;
  const ownPlayer = ownSeat && activeRoom ? activeRoom.players[ownSeat] : null;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeRoom && rawActiveRoom && roomExpiresAt(rawActiveRoom) <= now) {
      onSelectRoom(null);
      setNotice("这个房间已因长时间无活动失效，请重新创建或输入其他房间号");
    }
  }, [activeRoom, now, onSelectRoom, rawActiveRoom]);

  useEffect(() => {
    if (snapshot.session.authState !== "authenticated" || !initialRoomCode || attemptedLink.current === initialRoomCode) return;
    attemptedLink.current = initialRoomCode;
    void client.joinRoom({ code: initialRoomCode }).then((room) => {
      onSelectRoom(room.id);
      setNotice("已通过邀请链接进入" + gameLabel(room.gameId) + "房间 " + room.code);
      try {
        const params = new URLSearchParams(window.location.search);
        params.delete("room");
        params.set("tab", "online");
        window.history.replaceState({}, "", window.location.pathname + "?" + params.toString());
      } catch {
        // History is optional in embedded webviews.
      }
    }).catch((error) => setNotice(socialErrorMessage(error)));
  }, [client, initialRoomCode, onSelectRoom, snapshot.session.authState]);

  useEffect(() => {
    if (snapshot.session.authState !== "authenticated") return undefined;
    const refresh = () => { void client.refreshRooms().catch(() => undefined); };
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [client, snapshot.session.authState]);

  useEffect(() => {
    if (activeRoom?.status === "playing" && notice === "再战邀请已发送，等待对方接受") {
      setNotice("对方已接受再战邀请，双方已自动准备并开始新游戏");
    }
  }, [activeRoom?.status, notice]);

  const setCopiedValue = (value: "code" | "link") => {
    setCopied(value);
    window.setTimeout(() => setCopied((current) => current === value ? null : current), 2_000);
  };

  const create = async () => {
    try {
      const room = await client.createRoom({ gameId: asSocialGameId(selectedGame) });
      onSelectRoom(room.id);
      setNotice(gameLabel(room.gameId) + "房间已创建：" + room.code + "，可以复制邀请链接或邀请码");
    } catch (error) {
      setNotice(socialErrorMessage(error));
    }
  };

  const join = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = code.trim();
    if (!normalized) return;
    try {
      const room = await client.joinRoom({ code: normalized });
      setCode("");
      onSelectRoom(room.id);
      setNotice("已加入" + gameLabel(room.gameId) + "房间：" + room.code);
    } catch (error) {
      setNotice(socialErrorMessage(error));
    }
  };

  const enterRoom = async (room: GameRoom) => {
    try {
      const joinedRoom = await client.joinRoom({ roomId: room.id });
      onSelectRoom(joinedRoom.id);
      setNotice("已进入" + gameLabel(room.gameId) + "房间：" + room.code);
    } catch (error) {
      setNotice(socialErrorMessage(error));
    }
  };

  const copyRoomCode = async (room: GameRoom) => {
    try {
      await copyText(room.code);
      setCopiedValue("code");
      setNotice("邀请码 " + room.code + " 已复制");
    } catch (error) {
      setNotice(socialErrorMessage(error));
    }
  };

  const copyInvite = async (room: GameRoom) => {
    try {
      await copyText(roomInviteUrl(room, snapshot));
      setCopiedValue("link");
      setNotice("邀请链接已复制，登录后即可加入");
    } catch (error) {
      setNotice(socialErrorMessage(error));
    }
  };

  const shareInvite = async (room: GameRoom) => {
    const url = roomInviteUrl(room, snapshot);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "加入小满联机房间", text: "加入" + gameLabel(room.gameId) + "房间 " + room.code, url });
        setNotice("邀请链接已分享");
      } else {
        await copyText(url);
        setCopiedValue("link");
        setNotice("当前设备不支持系统分享，邀请链接已复制");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice(socialErrorMessage(error));
    }
  };

  const ready = async () => {
    if (!activeRoom || !ownPlayer) return;
    try {
      await client.setReady(activeRoom.id, !ownPlayer.ready);
      setNotice(ownPlayer.ready ? "已取消准备" : "已准备，等待对手");
    } catch (error) {
      setNotice(socialErrorMessage(error));
    }
  };

  const leave = async () => {
    if (!activeRoom) return;
    try {
      await client.leaveRoom(activeRoom.id);
      onSelectRoom(null);
      setNotice("已离开房间");
    } catch (error) {
      setNotice(socialErrorMessage(error));
    }
  };

  const resign = async () => {
    if (!activeRoom || activeRoom.status !== "playing") return;
    if (!window.confirm("确定认输并结束这局对战吗？")) return;
    try { await client.resign(activeRoom.id); } catch (error) { setNotice(socialErrorMessage(error)); }
  };

  const rematch = async () => {
    if (!activeRoom || activeRoom.status !== "finished") return;
    const acceptingInvitation = Boolean(
      activeRoom.rematchRequest
      && ownPlayer
      && activeRoom.rematchRequest.requestedByUserId !== ownPlayer.user.id,
    );
    try {
      await client.rematch(activeRoom.id);
      setNotice(acceptingInvitation
        ? "已接受再战邀请，双方已自动准备并开始新游戏"
        : "再战邀请已发送，等待对方接受");
    } catch (error) {
      setNotice(socialErrorMessage(error));
    }
  };

  const requestUndo = async () => {
    if (!activeRoom) return;
    try {
      await client.requestUndo(activeRoom.id);
      setNotice("悔棋请求已发送，等待对手确认");
    } catch (error) {
      setNotice(socialErrorMessage(error));
    }
  };

  const respondUndo = async (accept: boolean) => {
    if (!activeRoom) return;
    try {
      await client.respondUndo({ roomId: activeRoom.id, accept });
      setNotice(accept ? "已同意悔棋，棋局已回到上一手" : "已拒绝悔棋请求");
    } catch (error) {
      setNotice(socialErrorMessage(error));
    }
  };

  const activeBoard = activeRoom
    ? activeRoom.gameId === "gomoku"
      ? <OnlineGomokuBoard room={activeRoom} seat={ownSeat} client={client} />
      : <OnlineBoardGame room={activeRoom} seat={ownSeat} client={client} />
    : null;

  if (activeRoom && activeBoard) {
    const remaining = formatRemaining(roomExpiresAt(activeRoom) - now);
    return (
      <section className="social-my-rooms-panel is-active-room">
        <div className="social-room-active-heading">
          <div>
            <span className="eyebrow">我的房间 · 对局</span>
            <h3>{gameLabel(activeRoom.gameId)} <small>{activeRoom.code}</small></h3>
            <p><Timer size={14} />剩余 {remaining} · 闲置 1 小时自动销毁</p>
          </div>
          <button className="secondary-button compact" type="button" onClick={() => onSelectRoom(null)}>
            <ArrowLeft size={15} />返回我的房间
          </button>
        </div>
        <div className="social-room-share-strip">
          <div><strong>邀请对方加入</strong><span>房间号：{activeRoom.code}</span></div>
          <div className="social-room-share-actions">
            <button className="secondary-button compact" type="button" onClick={() => void copyRoomCode(activeRoom)}><Copy size={14} />复制邀请码</button>
            <button className="secondary-button compact" type="button" onClick={() => void copyInvite(activeRoom)}><Link2 size={14} />复制邀请链接</button>
            <button className="primary-button compact" type="button" onClick={() => void shareInvite(activeRoom)}><Share2 size={14} />分享</button>
          </div>
        </div>
        <OnlineGameWorkspace
          room={activeRoom}
          seat={ownSeat}
          board={activeBoard}
          notice={notice}
          copied={copied === "link"}
          onCopyInvite={() => copyInvite(activeRoom)}
          onReady={ready}
          onLeave={leave}
          onResign={resign}
          onRematch={rematch}
          onRequestUndo={requestUndo}
          onRespondUndo={respondUndo}
          onBack={() => onSelectRoom(null)}
        />
      </section>
    );
  }

  return (
    <section className="social-my-rooms-panel">
      <div className="social-room-toolbar">
        <div>
          <span className="eyebrow">我的房间</span>
          <h3>创建或加入联机房间</h3>
          <p>创建后复制邀请链接、邀请码；也可以直接输入房间号加入。</p>
        </div>
        <span className="social-room-lifecycle"><Timer size={15} />闲置 1 小时自动销毁</span>
      </div>
      <div className="social-room-create-bar">
        <label className="social-room-game-select">
          <span>游戏</span>
          <select value={selectedGame} onChange={(event) => setSelectedGame(event.target.value as OnlineGameId)} disabled={snapshot.busy}>
            {ONLINE_GAME_OPTIONS.map((game) => <option value={game.id} key={game.id}>{game.label}</option>)}
          </select>
        </label>
        <button className="primary-button" type="button" onClick={() => void create()} disabled={snapshot.busy}>
          <Plus size={16} />创建房间
        </button>
        <form className="social-room-join-form" onSubmit={join}>
          <label><span>房间号</span><input value={code} placeholder="例如 XM123456" aria-label="房间号" maxLength={16} onChange={(event) => setCode(event.target.value)} /></label>
          <button className="secondary-button" type="submit" disabled={!code.trim() || snapshot.busy}><LogIn size={15} />加入</button>
        </form>
      </div>
      {notice && <div className="social-notice" role="status">{notice}</div>}
      {roomRows.length === 0 ? (
        <div className="social-empty social-my-rooms-empty"><Gamepad2 size={22} /><span>还没有自己的房间。创建或输入房间号后，房间会留在这里。</span></div>
      ) : (
        <div className="social-room-row-list" aria-label="我的房间列表">
          {roomRows.map((room) => {
            const remaining = formatRemaining(roomExpiresAt(room) - now);
            const playerCount = Number(Boolean(room.players.red)) + Number(Boolean(room.players.black));
            return (
              <article className="social-room-row-card" key={room.id}>
                <button className="social-room-row-main" type="button" onClick={() => void enterRoom(room)}>
                  <span className="social-room-row-game"><Gamepad2 size={17} /><strong>{gameLabel(room.gameId)}</strong><small>{roomStatus(room)}</small></span>
                  <span className="social-room-row-code"><b>{room.code}</b><small>{playerCount} / 2 人 · {remaining}</small></span>
                </button>
                <div className="social-room-row-actions">
                  <button className="icon-button compact" type="button" title="复制邀请码" aria-label={"复制" + room.code + "邀请码"} onClick={() => void copyRoomCode(room)}><Copy size={15} /></button>
                  <button className="icon-button compact" type="button" title="复制邀请链接" aria-label={"复制" + room.code + "邀请链接"} onClick={() => void copyInvite(room)}><Link2 size={15} /></button>
                  <button className="secondary-button compact" type="button" onClick={() => void shareInvite(room)}><Share2 size={14} />分享</button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="social-room-lifecycle-note"><Timer size={14} />房间每次创建、加入、准备、落子或重新连接都会刷新活动时间；连续 1 小时没有活动后由服务器销毁。</p>
    </section>
  );
}

function AuthenticatedSocialWorkspace({
  client,
  snapshot,
  initialSection,
  initialRoomCode,
  onSectionChange,
  onOpenSingleGames,
}: {
  client: SocialClient;
  snapshot: SocialClientSnapshot;
  initialSection: FriendsViewSection;
  initialRoomCode: string | null;
  onSectionChange?: (section: FriendsViewSection) => void;
  onOpenSingleGames?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<RoomTab>(() => initialRoomCode ? "mine" : initialSection === "online-games" ? "online" : "online");
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const notifySection = () => onSectionChange?.("online-games");

  useEffect(() => {
    if (initialRoomCode) setActiveTab("mine");
  }, [initialRoomCode]);

  const selectTab = (nextTab: RoomTab) => {
    setActiveTab(nextTab);
    notifySection();
  };

  const openRoom = (roomId: string) => {
    setSelectedRoomId(roomId);
    setActiveTab("mine");
    notifySection();
  };

  return (
    <>
      <IdentityBar client={client} snapshot={snapshot} />
      {snapshot.loading && <div className="social-loading"><RefreshCw size={18} className="is-spinning" />正在准备联机房间</div>}
      {!snapshot.loading && (
        <>
          <nav className="social-tabs" aria-label="联机房间导航" role="tablist">
            <button type="button" role="tab" aria-selected={activeTab === "single"} className={activeTab === "single" ? "is-active" : ""} onClick={() => selectTab("single")}>单机游戏</button>
            <button type="button" role="tab" aria-selected={activeTab === "online"} className={activeTab === "online" ? "is-active" : ""} onClick={() => selectTab("online")}>联机房间</button>
            <button type="button" role="tab" aria-selected={activeTab === "mine"} className={activeTab === "mine" ? "is-active" : ""} onClick={() => selectTab("mine")}>我的房间{snapshot.rooms.length > 0 && <em>{snapshot.rooms.length}</em>}</button>
          </nav>
          {activeTab === "single" && <SinglePlayerPanel onOpenSingleGames={onOpenSingleGames} />}
          {activeTab === "online" && (
            <OnlineGamesView
              client={client}
              snapshot={snapshot}
              onOpenRoom={openRoom}
              onOpenRooms={() => selectTab("mine")}
            />
          )}
          {activeTab === "mine" && (
            <RoomList
              client={client}
              snapshot={snapshot}
              initialRoomCode={initialRoomCode}
              selectedRoomId={selectedRoomId}
              onSelectRoom={setSelectedRoomId}
            />
          )}
        </>
      )}
    </>
  );
}

export function FriendsView({
  initialSection = "social",
  onSectionChange,
  onOpenSingleGames,
}: {
  initialSection?: FriendsViewSection;
  onSectionChange?: (section: FriendsViewSection) => void;
  onOpenSingleGames?: () => void;
} = {}) {
  const [client, setClient] = useState<SocialClient>(() => getDefaultSocialClient());
  const { snapshot } = useSocialClient(client);
  const [initialRoomCode] = useState<string | null>(() => roomCodeFromLocation());
  const [serverOrigin, setServerOrigin] = useState(() => resolveDefaultSocialOrigin() ?? "");
  const [connectionNotice, setConnectionNotice] = useState("");

  const connectServer = () => {
    try {
      const next = createSocialClient({ serverOrigin });
      const previous = client;
      setClient(next);
      setConnectionNotice("正在连接服务器");
      previous.dispose();
    } catch (error) {
      setConnectionNotice(socialErrorMessage(error));
    }
  };

  return (
    <div className="view social-view is-online-games">
      <section className="social-page-heading">
        <div>
          <span className="eyebrow">联机中心</span>
          <h2>联机房间</h2>
          <p>登录后创建房间，分享邀请链接或邀请码；输入房间号即可加入。</p>
        </div>
        <div className={"social-connection-pill is-" + snapshot.session.connection}><span />{sessionLabel(snapshot.session)}</div>
      </section>
      {connectionNotice && <div className="social-notice" role="status">{connectionNotice}</div>}
      {snapshot.error && (
        <div className="social-error" role="alert">
          <CircleAlert size={15} />{snapshot.error}
          <button className="icon-button compact" type="button" title="关闭提示" aria-label="关闭提示" onClick={() => client.clearError()}><X size={14} /></button>
        </div>
      )}
      {snapshot.session.authState !== "authenticated" ? (
        <AuthGate client={client} snapshot={snapshot} serverOrigin={serverOrigin} setServerOrigin={setServerOrigin} onConnect={connectServer} notice={connectionNotice} />
      ) : (
        <AuthenticatedSocialWorkspace
          client={client}
          snapshot={snapshot}
          initialSection={initialSection}
          initialRoomCode={initialRoomCode}
          onSectionChange={onSectionChange}
          onOpenSingleGames={onOpenSingleGames}
        />
      )}
    </div>
  );
}
