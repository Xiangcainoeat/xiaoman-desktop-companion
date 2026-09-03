import { CircleAlert, Flag, RotateCcw, Shield, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  boardFromString,
  boardToString,
  findGomokuWinner,
  isGomokuBoardFull,
  type GomokuPlayer,
} from "../gomoku/logic";
import { ReferenceLineBoard } from "../online-games/ReferenceBoards";
import { createOnlineMove, parseOnlinePosition } from "../online-games/engine";
import type { SocialClient } from "../social/client";
import { socialErrorMessage } from "../social/state";
import type { GameRoom, GameSeat } from "../social/types";

export interface OnlineGomokuBoardProps {
  room: GameRoom;
  seat: GameSeat | null;
  client: SocialClient;
}

function playerForSeat(seat: GameSeat): GomokuPlayer {
  return seat === "red" ? 1 : 2;
}

function seatLabel(seat: GameSeat): string {
  return seat === "red" ? "黑方" : "白方";
}

function roomStatus(room: GameRoom): string {
  if (room.status === "playing") return `轮到${seatLabel(room.turn)}`;
  if (room.status === "finished") {
    return room.winner ? `${seatLabel(room.winner)}获胜` : "和棋";
  }
  if (room.status === "left") return "房间已结束";
  return "等待双方准备";
}

function boardForPosition(position: string) {
  const parsed = parseOnlinePosition("gomoku", position);
  return typeof parsed?.board === "string" ? boardFromString(parsed.board) : boardFromString(position);
}

export function OnlineGomokuBoard({ room, seat, client }: OnlineGomokuBoardProps) {
  const [error, setError] = useState("");
  const pendingSeq = useRef<number | null>(null);
  const board = boardForPosition(room.position);
  const ownPlayer = seat ? playerForSeat(seat) : null;
  const winner = useMemo(() => findGomokuWinner(board), [room.position]);
  const winningKeys = useMemo(
    () => new Set(winner?.line.map((point) => `${point.col}:${point.row}`) ?? []),
    [winner],
  );
  const canMove = Boolean(
    seat
      && ownPlayer
      && room.status === "playing"
      && !room.undoRequest
      && room.turn === seat
      && pendingSeq.current === null,
  );

  useEffect(() => {
    if (pendingSeq.current !== null && room.seq >= pendingSeq.current) pendingSeq.current = null;
  }, [room.seq]);

  useEffect(() => {
    pendingSeq.current = null;
    setError("");
  }, [room.id]);

  const place = (row: number, col: number) => {
    if (!canMove || pendingSeq.current !== null || !seat || !ownPlayer || board[row][col] !== 0) return;
    const move = createOnlineMove({
      roomId: room.id,
      gameId: "gomoku",
      seat,
      seq: room.seq + 1,
      position: room.position,
      from: { x: col, y: row },
      to: { x: col, y: row },
    });
    if (!move) {
      setError("当前棋局已更新，请重新选择落点");
      return;
    }
    pendingSeq.current = move.seq;
    setError("");
    void client.sendMove(move).catch((sendError) => {
      pendingSeq.current = null;
      setError(socialErrorMessage(sendError));
    });
  };

  const resign = () => {
    if (!seat || room.status !== "playing") return;
    if (!window.confirm("确定认输并结束这局棋吗？")) return;
    void client.resign(room.id).catch((resignError) => setError(socialErrorMessage(resignError)));
  };

  const rematch = () => {
    void client.rematch(room.id).catch((rematchError) => setError(socialErrorMessage(rematchError)));
  };

  const boardFull = isGomokuBoardFull(board);
  const statusText = room.status === "finished"
    ? room.winner
      ? `${seatLabel(room.winner)}获胜`
      : boardFull
        ? "棋盘已满，和棋"
        : "本局结束"
    : roomStatus(room);

  return (
    <section
      className="online-gomoku-board"
      aria-label="联机五子棋棋盘"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <header className="online-gomoku-board-head">
        <div>
          <span className="eyebrow">房间 {room.code}</span>
          <h3>五子棋联机棋盘</h3>
        </div>
        <span className={`online-room-state is-${room.status}`}>
          {room.status === "playing" ? <Wifi size={14} /> : <WifiOff size={14} />}
          {statusText}
        </span>
      </header>

      {error && <div className="social-error online-gomoku-error" role="alert"><CircleAlert size={15} />{error}</div>}

      <div className="online-gomoku-surface">
        <ReferenceLineBoard
          gameId="gomoku"
          size={15}
          state={{ game: "gomoku", board: boardToString(board), turn: room.turn }}
          selected={null}
          targets={[]}
          lastMove={room.lastMove}
          winningKeys={winningKeys}
          disabled={(_point, value) => !canMove || value !== "0"}
          onPoint={(point) => place(point.y, point.x)}
        />
      </div>

      <footer className="online-gomoku-board-footer">
        <div className="online-gomoku-board-status">
          {room.status === "playing" && <span className="online-gomoku-turn-dot" />}
          <strong>{seat ? `你是${seatLabel(seat)}` : "观战中"}</strong>
          <span>第 {room.seq} 手</span>
        </div>
        <div className="online-gomoku-board-actions">
          {room.status === "playing" && seat && <button className="secondary-button compact" type="button" onClick={resign}><Flag size={14} />认输</button>}
          {room.status === "finished" && seat && <button className="primary-button compact" type="button" onClick={rematch}><RotateCcw size={14} />再来一局</button>}
        </div>
      </footer>
      <p className="online-gomoku-note"><Shield size={14} />服务器会校验落点、回合和棋盘状态；重新打开联机房间即可恢复这局棋。</p>
    </section>
  );
}
