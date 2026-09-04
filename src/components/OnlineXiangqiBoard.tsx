import { CircleAlert, LoaderCircle, Shield, Wifi, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SocialClient } from "../social/client";
import { socialErrorMessage } from "../social/state";
import type { GameMove, GameRoom, GameSeat } from "../social/types";
import { articleGameServerUrl, serverOriginForPage } from "../shared/server-origin";

const BOARD_URL = articleGameServerUrl(
  serverOriginForPage(typeof window === "undefined" ? null : window.location),
  "xiangqi-h5",
);

export interface OnlineXiangqiBoardProps {
  room: GameRoom;
  seat: GameSeat | null;
  client: SocialClient;
}

function moveFromMessage(value: unknown, roomId: string): GameMove | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<GameMove>;
  if (item.roomId !== roomId || item.gameId !== "xiangqi" || (item.seat !== "red" && item.seat !== "black")) return null;
  const validPoint = (point: unknown): point is { x: number; y: number } => (
    Boolean(point)
    && typeof point === "object"
    && Number.isInteger((point as { x?: unknown }).x)
    && Number.isInteger((point as { y?: unknown }).y)
    && (point as { x: number }).x >= 0
    && (point as { x: number }).x <= 8
    && (point as { y: number }).y >= 0
    && (point as { y: number }).y <= 9
  );
  if (!validPoint(item.from) || !validPoint(item.to) || typeof item.position !== "string" || typeof item.seq !== "number") return null;
  return {
    roomId,
    gameId: "xiangqi",
    seat: item.seat,
    from: item.from,
    to: item.to,
    captured: item.captured ?? null,
    position: item.position,
    seq: item.seq,
    createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
  };
}

export function OnlineXiangqiBoard({ room, seat, client }: OnlineXiangqiBoardProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const lastSentRemoteSeq = useRef<number>(-1);

  const postMode = () => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    target.postMessage({
      channel: "xiaoman-xiangqi-mode",
      mode: "online",
      roomId: room.id,
      seat,
      status: room.status,
      turn: room.turn,
      position: room.position,
      seq: room.seq,
    }, "*");
    target.postMessage({
      channel: "xiaoman-xiangqi-room-state",
      roomId: room.id,
      status: room.status,
      turn: room.turn,
      seq: room.seq,
    }, "*");
  };

  useEffect(() => {
    setLoaded(false);
    setBridgeError(null);
    lastSentRemoteSeq.current = -1;
  }, [room.id]);

  useEffect(() => {
    postMode();
  }, [room.position, room.seq, room.status, room.turn, seat]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!event.data || typeof event.data !== "object") return;
      const data = event.data as { channel?: unknown; move?: unknown };
      if (data.channel !== "xiaoman-xiangqi-move") return;
      const move = moveFromMessage(data.move, room.id);
      if (!move) {
        setBridgeError("收到的走子数据无效");
        return;
      }
      if (seat !== move.seat || move.seq !== room.seq + 1 || room.turn !== move.seat) {
        setBridgeError("走子顺序与当前房间状态不匹配");
        return;
      }
      void client.sendMove(move).catch((error) => setBridgeError(socialErrorMessage(error)));
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [client, room.id, room.seq, room.turn, seat]);

  useEffect(() => {
    const remoteMove = room.lastMove;
    if (!loaded || !remoteMove || remoteMove.seat === seat || remoteMove.seq <= lastSentRemoteSeq.current) return;
    iframeRef.current?.contentWindow?.postMessage({
      channel: "xiaoman-xiangqi-remote-move",
      roomId: room.id,
      move: remoteMove,
      seq: remoteMove.seq,
    }, "*");
    lastSentRemoteSeq.current = remoteMove.seq;
  }, [loaded, room.id, room.lastMove, room.seq, seat]);

  return (
    <section className="online-xiangqi-board" aria-label="联机中国象棋棋盘">
      <div className="online-xiangqi-board-head">
        <div>
          <span className="eyebrow">房间 {room.code}</span>
          <h3>中国象棋联机棋盘</h3>
        </div>
        <span className={`online-room-state is-${room.status}`}>
          {room.status === "playing" ? <Wifi size={14} /> : <WifiOff size={14} />}
          {room.status === "playing" ? `轮到${room.turn === "red" ? "红方" : "黑方"}` : "等待双方准备"}
        </span>
      </div>
      {bridgeError && <div className="social-error"><CircleAlert size={15} />{bridgeError}</div>}
      <div className="online-xiangqi-frame-wrap">
        {!loaded && (
          <div className="online-xiangqi-loading"><LoaderCircle size={20} className="is-spinning" />正在载入棋盘</div>
        )}
        <iframe
          ref={iframeRef}
          className="online-xiangqi-frame"
          title="中国象棋联机棋盘"
          src={`${BOARD_URL}?mode=online&roomId=${encodeURIComponent(room.id)}`}
          onLoad={() => { setLoaded(true); postMode(); }}
        />
      </div>
      <p className="online-xiangqi-note"><Shield size={14} />只允许当前席位落子，房间序号由客户端严格校验。</p>
    </section>
  );
}
