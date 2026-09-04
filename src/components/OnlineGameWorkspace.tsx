import {
  ArrowLeft,
  Check,
  CircleAlert,
  Clock3,
  Copy,
  DoorOpen,
  Flag,
  Gamepad2,
  Maximize2,
  RotateCcw,
  Share2,
  ShieldCheck,
  Users,
  Volume2,
  VolumeX,
  Wifi,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { GameRoom, GameSeat } from "../social/types";
import { ROOM_IDLE_TTL_MS } from "../social/types";
import { getOnlineGameDefinition } from "../online-games";
import { ArmyChessModeContext } from "../online-games/ArmyChessBoard";

export interface OnlineGameWorkspaceProps {
  room: GameRoom;
  seat: GameSeat | null;
  board: ReactNode;
  notice?: string;
  onCopyInvite: () => void | Promise<void>;
  copied: boolean;
  onReady: () => void | Promise<void>;
  onLeave: () => void | Promise<void>;
  onResign: () => void | Promise<void>;
  onRematch: () => void | Promise<void>;
  onRequestUndo: () => void | Promise<void>;
  onRespondUndo: (accept: boolean) => void | Promise<void>;
  onBack?: () => void;
}

type PlayerTone = "red" | "black" | "white" | "blue";
type SideDefinition = { label: string; tone: PlayerTone };
type SideDefinitions = Record<GameSeat, SideDefinition>;

const RED_BLACK_SIDES: SideDefinitions = {
  red: { label: "红方", tone: "red" },
  black: { label: "黑方", tone: "black" },
};

const BLACK_WHITE_SIDES: SideDefinitions = {
  red: { label: "黑方", tone: "black" },
  black: { label: "白方", tone: "white" },
};

// The protocol keeps the first seat as `red`; the visible side names follow
// each game's conventional colors instead of exposing that transport name.
const CHESS_SIDES: SideDefinitions = {
  red: { label: "白方", tone: "white" },
  black: { label: "黑方", tone: "black" },
};

const RED_BLUE_SIDES: SideDefinitions = {
  red: { label: "红方", tone: "red" },
  black: { label: "蓝方", tone: "blue" },
};

const BLACK_WHITE_GAME_IDS = new Set(["go", "gomoku", "connect6", "reversi", "checkers"]);
const RED_BLUE_GAME_IDS = new Set(["shogi", "animal-chess", "chinese-checkers", "army-chess"]);

function sideDefinitionsFor(gameId: string): SideDefinitions {
  if (gameId === "chess") return CHESS_SIDES;
  if (BLACK_WHITE_GAME_IDS.has(gameId)) return BLACK_WHITE_SIDES;
  if (RED_BLUE_GAME_IDS.has(gameId)) return RED_BLUE_SIDES;
  return RED_BLACK_SIDES;
}

function gameSide(gameId: string, seat: GameSeat): SideDefinition {
  return sideDefinitionsFor(gameId)[seat];
}

function gameSeatLabel(gameId: string, seat: GameSeat): string {
  return gameSide(gameId, seat).label;
}

function gameSeatTone(gameId: string, seat: GameSeat): PlayerTone {
  return gameSide(gameId, seat).tone;
}

const PLAYER_TONE_STYLES: Record<PlayerTone, CSSProperties> = {
  red: { backgroundColor: "#bf4b3d" },
  black: { backgroundColor: "#29363f" },
  white: { color: "#5f6b72", backgroundColor: "#f5f5ef", border: "1px solid #d5d3ca" },
  blue: { backgroundColor: "#4b78a8" },
};

function playerToneStyle(tone: PlayerTone): CSSProperties {
  return PLAYER_TONE_STYLES[tone];
}

function statusLabel(room: GameRoom, gameId: string): string {
  if (room.status === "playing") return `轮到${gameSeatLabel(gameId, room.turn)}`;
  if (room.status === "finished") return room.winner ? `${gameSeatLabel(gameId, room.winner)}获胜` : "本局结束";
  if (room.status === "paused") return "已暂停";
  if (room.status === "left") return "房间已结束";
  if (!room.players.red) return `等待${gameSeatLabel(gameId, "red")}加入`;
  if (!room.players.black) return `等待${gameSeatLabel(gameId, "black")}加入`;
  return "等待双方准备";
}

function copyValue(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
  return Promise.resolve();
}

function lastActivityLabel(updatedAt: number): string {
  const elapsed = Math.max(0, Date.now() - updatedAt);
  if (elapsed < 60_000) return "刚刚有活动";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes} 分钟前有活动`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时前有活动`;
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

function playerName(room: GameRoom, seat: GameSeat): string {
  return room.players[seat]?.user.displayName ?? `等待${gameSeatLabel(room.gameId, seat)}`;
}

function PlayerBadge({ room, seat, ownSeat }: { room: GameRoom; seat: GameSeat; ownSeat: GameSeat | null }) {
  const tone = gameSeatTone(room.gameId, seat);
  const label = gameSeatLabel(room.gameId, seat);
  const filled = Boolean(room.players[seat]);
  return (
    <div className={`online-match-player is-${tone} ${filled ? "is-filled" : "is-empty"}`}>
      <span className="online-match-player-mark" style={playerToneStyle(tone)} aria-label={`${label}圆点`} title={label}>{tone === "white" ? "○" : "●"}</span>
      <span className="online-match-player-copy">
        <small>{label}{ownSeat === seat ? " · 你" : ""}</small>
        <strong>{playerName(room, seat)}</strong>
      </span>
      {room.turn === seat && room.status === "playing" && <span className="online-match-turn" aria-label="当前回合" />}
    </div>
  );
}

export function OnlineGameWorkspace({
  room,
  seat,
  board,
  notice,
  onCopyInvite,
  copied,
  onReady,
  onLeave,
  onResign,
  onRematch,
  onRequestUndo,
  onRespondUndo,
  onBack,
}: OnlineGameWorkspaceProps) {
  const definition = getOnlineGameDefinition(room.gameId as Parameters<typeof getOnlineGameDefinition>[0]);
  const [muted, setMuted] = useState(false);
  const [localNotice, setLocalNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [dismissedResultKey, setDismissedResultKey] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const [armyMode, setArmyMode] = useState<"dark" | "flip">("dark");
  const ownPlayer = seat ? room.players[seat] : null;
  const hasOpponent = Boolean(room.players.red && room.players.black);
  const canReady = Boolean(ownPlayer && (room.status === "waiting" || room.status === "ready"));
  const canResign = Boolean(seat && room.status === "playing");
  const ownUserId = ownPlayer?.user.id ?? null;
  const canRematch = Boolean(ownUserId && hasOpponent && room.status === "finished");
  const rematchRequestedByMe = Boolean(room.rematchRequest && room.rematchRequest.requestedByUserId === ownUserId);
  const rematchRequestedByOpponent = Boolean(room.rematchRequest && ownUserId && !rematchRequestedByMe);
  const rematchRequester = room.rematchRequest
    ? Object.values(room.players).find((player) => player?.user.id === room.rematchRequest?.requestedByUserId)?.user.displayName
    : null;
  const undoRequestedByMe = Boolean(room.undoRequest && room.undoRequest.requestedByUserId === ownUserId);
  const canRequestUndo = Boolean(
    seat
      && ownUserId
      && room.status === "playing"
      && room.seq > 0
      && room.lastMove?.seat === seat
      && !room.undoRequest,
  );
  const canRespondUndo = Boolean(room.undoRequest && ownUserId && !undoRequestedByMe);
  const undoRequester = room.undoRequest
    ? Object.values(room.players).find((player) => player?.user.id === room.undoRequest?.requestedByUserId)?.user.displayName
    : null;
  const resultDialogKey = `${room.id}:${room.seq}:${room.winner ?? "draw"}:${room.updatedAt}`;
  const showResultDialog = room.status === "finished" && dismissedResultKey !== resultDialogKey;
  const resultTitle = room.winner == null
    ? "本局结束"
    : room.winner === seat
      ? "你赢了"
      : seat
        ? "本局落败"
        : `${gameSeatLabel(room.gameId, room.winner)}获胜`;
  const rematchButtonLabel = rematchRequestedByMe
    ? "等待对方接受"
    : rematchRequestedByOpponent
      ? "接受并开始"
      : "邀请再来一局";
  const ownReady = Boolean(ownPlayer?.ready);
  const opponentSeat: GameSeat | null = seat === "red" ? "black" : seat === "black" ? "red" : null;
  const opponentReady = opponentSeat ? Boolean(room.players[opponentSeat]?.ready) : false;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      setMuted(localStorage.getItem(`xiaoman.online-game.muted.${room.gameId}`) === "1");
    } catch {
      setMuted(false);
    }
  }, [room.gameId]);

  useEffect(() => {
    try { localStorage.setItem(`xiaoman.online-game.muted.${room.gameId}`, muted ? "1" : "0"); } catch { /* storage is optional */ }
    window.dispatchEvent(new CustomEvent("xiaoman-game-audio", { detail: { gameId: room.gameId, muted } }));
  }, [muted, room.gameId]);

  const copyRoomCode = async () => {
    try {
      await copyValue(room.code);
      setLocalNotice("房间码已复制");
    } catch {
      setLocalNotice("复制失败，请手动记录房间码");
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await workspaceRef.current?.requestFullscreen?.();
    } catch {
      setLocalNotice("当前窗口不支持全屏显示");
    }
  };

  const runAction = async (action: () => void | Promise<void>) => {
    setLocalNotice("");
    try { await action(); } catch { /* parent action renders the authoritative error */ }
  };

  return (
    <section
      ref={workspaceRef}
      className={`online-game-workspace is-${room.gameId} is-${room.status} is-room-${room.status}`}
      data-game-id={room.gameId}
      data-status={room.status}
      data-focus-mode={room.status === "playing" ? "game" : "room"}
      aria-label={`${definition.label}联机对局`}
    >
      <main className="online-game-main">
        <header className="online-game-matchbar">
          <div className="online-game-matchbar-back">
            {onBack && <button className="online-game-icon-button" type="button" title="返回游戏大厅" aria-label="返回游戏大厅" onClick={onBack}><ArrowLeft size={18} /></button>}
            <span className="online-game-live-mark"><Wifi size={14} />实时对局</span>
          </div>
          <div className="online-game-matchup">
            <PlayerBadge room={room} seat="red" ownSeat={seat} />
            <div className="online-game-vs"><strong>VS</strong><small>{statusLabel(room, room.gameId)}</small></div>
            <PlayerBadge room={room} seat="black" ownSeat={seat} />
          </div>
          <div className="online-game-matchbar-tools">
            {room.gameId === "army-chess" && <div className="online-army-score-strip" aria-label="军棋剩余棋子"><span><i className="is-red" />25</span><span><i className="is-blue" />25</span></div>}
            <span className="online-game-seq">第 {room.seq} 手</span>
            <button className="online-game-icon-button" type="button" title="全屏显示" aria-label="全屏显示" onClick={() => void toggleFullscreen()}><Maximize2 size={17} /></button>
          </div>
        </header>
        {(notice || localNotice) && <div className="online-game-inline-notice" role="status"><CircleAlert size={15} />{localNotice || notice}</div>}
        {room.undoRequest && (
          <div className="online-game-undo-banner" role="status">
            <span className="online-game-undo-copy">
              <RotateCcw size={18} />
              <span>
                <strong>{undoRequestedByMe ? "已发送悔棋请求" : `${undoRequester ?? "对手"}申请悔棋`}</strong>
                <small>{undoRequestedByMe ? "等待对手确认，确认前双方暂停落子" : "同意后将撤回上一手，并由原落子方重新行棋"}</small>
              </span>
            </span>
            {canRespondUndo && (
              <span className="online-game-undo-actions">
                <button type="button" onClick={() => void runAction(() => onRespondUndo(false))}>拒绝悔棋</button>
                <button className="is-primary" type="button" onClick={() => void runAction(() => onRespondUndo(true))}>同意悔棋</button>
              </span>
            )}
          </div>
        )}
        <div className="online-game-board-stage">
          <div className="online-game-board-host">
            <ArmyChessModeContext.Provider value={room.gameId === "army-chess" ? armyMode : "dark"}>{board}</ArmyChessModeContext.Provider>
          </div>
          {(room.status === "waiting" || room.status === "ready") && (
            <div className="online-game-board-overlay">
              <Users size={23} />
              <strong>{hasOpponent ? (ownReady ? "已准备，等待对方" : "对手已到，准备开局") : "等待对手加入"}</strong>
              <span>{hasOpponent ? (opponentReady ? "对方已准备，现在轮到你" : "双方准备后会自动开始") : "分享邀请链接，让对方加入房间"}</span>
              {hasOpponent && canReady && (
                <button className="online-game-overlay-ready" type="button" onClick={() => void runAction(onReady)}>
                  <Check size={17} />{ownReady ? "取消准备" : "立即准备"}
                </button>
              )}
              {!hasOpponent && (
                <button className="online-game-overlay-ready" type="button" onClick={() => void runAction(onCopyInvite)}>
                  <Share2 size={17} />{copied ? "邀请链接已复制" : "复制邀请链接"}
                </button>
              )}
            </div>
          )}
        </div>
        <footer className="online-game-main-footer">
          <span><ShieldCheck size={14} />服务器校验每一步落子</span>
          <span><Clock3 size={14} />{lastActivityLabel(room.updatedAt)} · 剩余 {formatRemaining(roomExpiresAt(room) - now)}</span>
        </footer>
      </main>

      <aside className="online-game-sidebar" aria-label="对局控制栏">
        <div className="online-game-sidebar-scroll">
          {(room.status === "waiting" || room.status === "ready") && (
            <section className="online-game-sidebar-section online-game-ready-panel" aria-live="polite">
              <div className="online-game-ready-heading">
                <span><Check size={18} /></span>
                <div><strong>{ownReady ? "你已准备" : "准备开局"}</strong><small>{hasOpponent ? (opponentReady ? "对方已准备，轮到你确认" : "双方准备后自动开始") : "等待另一位玩家进入房间"}</small></div>
              </div>
              <div className="online-game-ready-seats">
                {(["red", "black"] as const).map((playerSeat) => {
                  const player = room.players[playerSeat];
                  const tone = gameSeatTone(room.gameId, playerSeat);
                  return <div key={playerSeat}><span className={`online-game-room-player-dot is-${tone}`} style={playerToneStyle(tone)} /><strong>{player?.user.displayName ?? `等待${gameSeatLabel(room.gameId, playerSeat)}`}</strong><small>{player ? (player.ready ? "已准备" : "未准备") : "空席位"}</small></div>;
                })}
              </div>
              {canReady && <button className="online-game-ready-button" type="button" onClick={() => void runAction(onReady)}><Check size={18} />{ownReady ? "取消准备" : "准备开始"}</button>}
            </section>
          )}

          <section className="online-game-sidebar-section online-game-room-summary">
            <span className="online-game-sidebar-eyebrow">房间信息</span>
            <div className="online-game-room-code-row"><div><small>房间码</small><strong>{room.code}</strong></div><span className="online-game-room-code-actions"><button className="online-game-small-icon" type="button" title={copied ? "邀请链接已复制" : "复制邀请链接"} aria-label={copied ? "邀请链接已复制" : "复制邀请链接"} onClick={() => void runAction(onCopyInvite)}>{copied ? <Check size={17} /> : <Share2 size={17} />}</button><button className="online-game-small-icon" type="button" title="复制房间码" aria-label="复制房间码" onClick={() => void copyRoomCode()}><Copy size={17} /></button></span></div>
            <p><Clock3 size={14} />剩余 {formatRemaining(roomExpiresAt(room) - now)} · 无活动超过 1 小时后自动销毁</p>
          </section>

          {room.status !== "waiting" && room.status !== "ready" && (
            <section className="online-game-sidebar-section online-game-players-section">
              <div className="online-game-sidebar-section-title"><span>对局席位</span><span>{Number(Boolean(room.players.red)) + Number(Boolean(room.players.black))} / 2</span></div>
              {(["red", "black"] as const).map((playerSeat) => {
                const player = room.players[playerSeat];
                const playerTone = gameSeatTone(room.gameId, playerSeat);
                const playerLabel = gameSeatLabel(room.gameId, playerSeat);
                return <div className={`online-game-room-player ${player ? "is-filled" : "is-empty"}`} key={playerSeat}><span className={`online-game-room-player-dot is-${playerTone}`} style={playerToneStyle(playerTone)} aria-label={`${playerLabel}圆点`} /><span><strong>{player?.user.displayName ?? `等待${playerLabel}`}</strong><small>{player ? `${player.ready ? "已准备" : "未准备"}${playerSeat === seat ? " · 你" : ""}` : "空席位"}</small></span>{player?.ready && <Check size={16} />}</div>;
              })}
            </section>
          )}

          <section className="online-game-sidebar-section online-game-rules-section">
            <div className="online-game-sidebar-section-title"><span>玩法</span><Gamepad2 size={16} /></div>
            {room.gameId === "army-chess" ? (
              <div className="online-army-mode-picker" role="group" aria-label="军棋玩法模式">
                <button type="button" className={armyMode === "dark" ? "is-active" : ""} onClick={() => setArmyMode("dark")} aria-pressed={armyMode === "dark"}>暗棋</button>
                <button type="button" className={armyMode === "flip" ? "is-active" : ""} onClick={() => setArmyMode("flip")} aria-pressed={armyMode === "flip"}>翻棋</button>
              </div>
            ) : <div className="online-game-rule-summary"><strong>{definition.ruleSummary}</strong><p>{definition.description}</p></div>}
            {room.gameId === "army-chess" && <label className="online-game-difficulty"><span>规则</span><select value="online" aria-label="军棋规则" onChange={() => undefined}><option value="online">联机规则</option></select><small>双方轮流操作，服务器校验每一步</small></label>}
            <div className="online-game-turn-summary"><span className={`online-game-turn-dot is-${room.status}`} />{statusLabel(room, room.gameId)}</div>
          </section>

          <section className="online-game-sidebar-section online-game-audio-section">
            <div className="online-game-control-row">
              {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
              <span><strong>音效</strong><small>只控制当前游戏</small></span>
              <button className={`online-game-switch ${muted ? "is-off" : "is-on"}`} type="button" role="switch" aria-checked={!muted} aria-label={muted ? "打开游戏音效" : "关闭游戏音效"} onClick={() => setMuted((value) => !value)}><i /></button>
            </div>
          </section>

          {(room.status === "playing" || room.status === "finished") && (
            <section className="online-game-sidebar-section online-game-match-actions">
              <div className="online-game-sidebar-section-title"><span>本局操作</span><Flag size={16} /></div>
              <div className="online-game-action-grid">
                {room.status === "playing" && <button type="button" disabled={!canRequestUndo} onClick={() => void runAction(onRequestUndo)}><RotateCcw size={17} /><span>{undoRequestedByMe ? "等待对方回应" : "申请悔棋"}</span></button>}
                {room.status === "finished" && <button className={rematchRequestedByOpponent ? "is-primary" : ""} type="button" disabled={!canRematch || rematchRequestedByMe} onClick={() => void runAction(onRematch)}><RotateCcw size={17} /><span>{rematchButtonLabel}</span></button>}
              </div>
              {room.status === "playing" && <button className="online-game-resign-link" type="button" disabled={!canResign} onClick={() => void runAction(onResign)}><Flag size={15} />认输并结束本局</button>}
            </section>
          )}

          <section className="online-game-sidebar-section online-game-room-actions-section">
            <button className="online-game-leave-button" type="button" onClick={() => void runAction(onLeave)}><DoorOpen size={17} />离开房间</button>
          </section>
        </div>
      </aside>

      {showResultDialog && (
        <div className="online-game-result-backdrop" role="presentation">
          <section className="online-game-result-dialog" role="dialog" aria-modal="true" aria-labelledby="online-game-result-title">
            <span className="online-game-result-icon"><Flag size={24} /></span>
            <div className="online-game-result-copy">
              <small>对局结果</small>
              <h2 id="online-game-result-title">{resultTitle}</h2>
              <p>{rematchRequestedByMe
                ? "再战邀请已发出。对方接受后，双方会自动准备并立即开始新游戏。"
                : rematchRequestedByOpponent
                  ? `${rematchRequester ?? "对方"}邀请你再来一局，接受后会直接开始。`
                  : "本局已经结束，可以邀请对方再来一局。"}</p>
            </div>
            <div className="online-game-result-actions">
              <button className="is-primary" type="button" disabled={!canRematch || rematchRequestedByMe} onClick={() => void runAction(onRematch)}><RotateCcw size={17} />{rematchButtonLabel}</button>
              <button type="button" onClick={() => setDismissedResultKey(resultDialogKey)}>稍后处理</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
