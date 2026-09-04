import { CircleAlert, CircleDot, LoaderCircle, Shield, Wifi } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import type { GameRoom, GameSeat } from "../social/types";
import { socialErrorMessage } from "../social/state";
import {
  getOnlineGameDefinition,
} from "./catalog";
import { ArmyChessBoard } from "./ArmyChessBoard";
import { ReferenceBoard } from "./ReferenceBoards";
import { createOnlineMove, getLegalMoves, isOnlineGameId, parseOnlinePosition } from "./engine";
import type {
  OnlineBoardClient,
  OnlineGameId,
  OnlineMoveCandidate,
  OnlinePoint,
  OnlinePositionState,
} from "./types";

export interface OnlineBoardGameProps {
  room: GameRoom;
  seat: GameSeat | null;
  client: OnlineBoardClient;
}

const ink = "#23302a";
const muted = "#68766f";
const sage = "#4f8064";
const pale = "#edf4ef";
const RED: GameSeat = "red";
const BLACK: GameSeat = "black";
const BLACK_WHITE_GAME_IDS = new Set(["gomoku", "go", "connect6", "reversi", "checkers"]);
const RED_BLUE_GAME_IDS = new Set(["shogi", "animal-chess", "chinese-checkers", "army-chess"]);

const shell: CSSProperties = {
  width: "100%",
  maxWidth: 980,
  margin: "0 auto",
  padding: 18,
  border: "1px solid #dce6df",
  borderRadius: 14,
  background: "#fbfdfb",
  color: ink,
  boxShadow: "0 12px 32px rgba(37, 57, 44, .08)",
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const buttonBase: CSSProperties = {
  border: "1px solid #d7e1da",
  background: "#fff",
  color: ink,
  cursor: "pointer",
  font: "inherit",
};

function pointKey(point: OnlinePoint): string {
  return `${point.x}:${point.y}`;
}

function samePoint(left: OnlinePoint, right: OnlinePoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function seatLabel(gameId: string, seat: GameSeat): string {
  if (gameId === "chess") return seat === "red" ? "白方" : "黑方";
  if (BLACK_WHITE_GAME_IDS.has(gameId)) return seat === "red" ? "黑方" : "白方";
  if (RED_BLUE_GAME_IDS.has(gameId)) return seat === "red" ? "红方" : "蓝方";
  return seat === "red" ? "红方" : "黑方";
}

function statusLabel(room: GameRoom): string {
  if (room.status === "playing") return `轮到${seatLabel(String(room.gameId), room.turn)}`;
  if (room.status === "finished") return room.winner ? `${seatLabel(String(room.gameId), room.winner)}获胜` : "本局结束";
  if (room.status === "paused") return "已暂停";
  if (room.status === "left") return "房间已结束";
  return "等待双方准备";
}

function markClass(value: string): string {
  return value === "1" || value === "r" || value === "R" ? "red" : value === "2" || value === "b" || value === "B" ? "black" : "empty";
}

const PIECE_GLYPHS: Record<string, string> = {
  p: "兵", P: "兵", r: "车", R: "车", n: "马", N: "马", b: "象", B: "象", q: "后", Q: "后", k: "王", K: "王",
  a: "士", A: "士", c: "炮", C: "炮", l: "将", L: "将", s: "银", S: "银", g: "金", G: "金",
  e: "象", E: "象", t: "虎", T: "虎", f: "狐", F: "狐", m: "军", M: "军",
};

function cellGlyph(gameId: OnlineGameId, value: string): string {
  if (value === "0" || value === ".") return "";
  if (gameId === "gomoku" || gameId === "connect6" || gameId === "go" || gameId === "reversi") return value === "1" ? "●" : "○";
  if (gameId === "tic-tac-toe") return value === "1" ? "×" : "○";
  if (gameId === "checkers" || gameId === "chinese-checkers") return "●";
  return PIECE_GLYPHS[value] ?? value.toUpperCase();
}

function boardString(state: OnlinePositionState | null): string | null {
  return state && typeof state.board === "string" ? state.board : null;
}

function simpleGridCells(
  gameId: OnlineGameId,
  state: OnlinePositionState | null,
  columns: number,
  rows: number,
  selected: OnlinePoint | null,
  targets: OnlineMoveCandidate[],
  onPoint: (point: OnlinePoint) => void,
): ReactElement {
  const board = boardString(state) ?? "";
  const targetKeys = new Set(targets.map((move) => pointKey(move.to)));
  return (
    <div
      role="grid"
      aria-label={`${columns}乘${rows}联机${getOnlineGameDefinition(gameId).label}棋盘`}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        aspectRatio: `${columns} / ${rows}`,
        width: "100%",
        maxHeight: 650,
        border: "2px solid #52705d",
        borderRadius: 10,
        overflow: "hidden",
        background: gameId === "go" || gameId === "gomoku" || gameId === "connect6" ? "#ead29b" : "#e7f0e8",
      }}
    >
      {Array.from({ length: columns * rows }, (_, index) => {
        const point = { x: index % columns, y: Math.floor(index / columns) };
        const value = board[index] ?? "0";
        const selectedHere = Boolean(selected && samePoint(selected, point));
        const targetHere = targetKeys.has(pointKey(point));
        const glyph = cellGlyph(gameId, value);
        const isBoardGame = gameId === "gomoku" || gameId === "connect6" || gameId === "go" || gameId === "reversi";
        return (
          <button
            key={pointKey(point)}
            type="button"
            role="gridcell"
            aria-label={`${point.y + 1}行${point.x + 1}列${glyph ? `，${glyph}` : "，空位"}`}
            onClick={() => onPoint(point)}
            style={{
              ...buttonBase,
              minWidth: 0,
              minHeight: 0,
              padding: 0,
              display: "grid",
              placeItems: "center",
              borderRadius: 0,
              borderColor: isBoardGame ? "rgba(92, 70, 36, .3)" : "#d1dfd4",
              background: selectedHere ? "#c7e1cf" : targetHere ? "#deefe2" : "transparent",
              color: markClass(value) === "red" ? "#bd5d52" : markClass(value) === "black" ? "#27312d" : ink,
              fontSize: gameId === "tic-tac-toe" ? "clamp(26px, 6vw, 52px)" : "clamp(12px, 3vw, 28px)",
              fontWeight: 700,
              position: "relative",
              boxShadow: targetHere ? "inset 0 0 0 2px #70a77f" : undefined,
            }}
          >
            {glyph && (isBoardGame && (gameId === "gomoku" || gameId === "connect6" || gameId === "go" || gameId === "reversi")
              ? <span aria-hidden="true" style={{ color: value === "1" ? "#202825" : "#fff", textShadow: value === "1" ? "0 1px 2px rgba(0,0,0,.35)" : "0 1px 2px rgba(0,0,0,.32)" }}>{glyph}</span>
              : <span aria-hidden="true">{glyph}</span>)}
            {targetHere && value === "0" && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: sage, position: "absolute" }} />}
          </button>
        );
      })}
    </div>
  );
}

function dotsBoard(
  state: OnlinePositionState | null,
  selected: OnlinePoint | null,
  targets: OnlineMoveCandidate[],
  onCandidate: (move: OnlineMoveCandidate) => void,
): ReactElement {
  const value = state?.board && typeof state.board === "object" ? state.board as { h?: string; v?: string; boxes?: string } : {};
  const h = value.h ?? "0".repeat(12);
  const v = value.v ?? "0".repeat(12);
  const boxes = value.boxes ?? "0".repeat(9);
  const targetKeys = new Set(targets.map((move) => `${pointKey(move.from)}-${pointKey(move.to)}`));
  const edges = [
    ...Array.from({ length: 12 }, (_, index) => ({ from: { x: index % 3, y: Math.floor(index / 3) }, to: { x: index % 3 + 1, y: Math.floor(index / 3) }, filled: h[index] !== "0" })),
    ...Array.from({ length: 12 }, (_, index) => ({ from: { x: index % 4, y: Math.floor(index / 4) }, to: { x: index % 4, y: Math.floor(index / 4) + 1 }, filled: v[index] !== "0" })),
  ];
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 620, aspectRatio: "1", margin: "0 auto", borderRadius: 12, background: "#f4e4bd", border: "2px solid #b18b58" }} role="grid" aria-label="点格棋点阵">
      {edges.map((edge) => {
        const horizontal = edge.from.y === edge.to.y;
        const left = `${(Math.min(edge.from.x, edge.to.x) / 3) * 100}%`;
        const top = `${(Math.min(edge.from.y, edge.to.y) / 3) * 100}%`;
        const key = `${pointKey(edge.from)}-${pointKey(edge.to)}`;
        const reverseKey = `${pointKey(edge.to)}-${pointKey(edge.from)}`;
        const active = targetKeys.has(key) || targetKeys.has(reverseKey);
        return (
          <button
            key={key}
            type="button"
            aria-label={`${horizontal ? "横" : "竖"}线${edge.filled ? "已连接" : "可连接"}`}
            onClick={() => onCandidate({ from: edge.from, to: edge.to, captured: null })}
            style={{
              ...buttonBase,
              position: "absolute",
              left: horizontal ? left : `calc(${left} - 7px)`,
              top: horizontal ? `calc(${top} - 7px)` : top,
              width: horizontal ? "33.333%" : 14,
              height: horizontal ? 14 : "33.333%",
              border: 0,
              background: edge.filled ? sage : active ? "#a8d1b4" : "transparent",
              borderRadius: 8,
              zIndex: 1,
            }}
          />
        );
      })}
      {Array.from({ length: 16 }, (_, index) => {
        const point = { x: index % 4, y: Math.floor(index / 4) };
        return <span key={pointKey(point)} aria-hidden="true" style={{ position: "absolute", left: `calc(${(point.x / 3) * 100}% - 6px)`, top: `calc(${(point.y / 3) * 100}% - 6px)`, width: 12, height: 12, borderRadius: "50%", background: "#405c48", zIndex: 2 }} />;
      })}
      {Array.from({ length: 9 }, (_, index) => {
        const x = index % 3;
        const y = Math.floor(index / 3);
        const owner = boxes[index];
        return <span key={`box-${index}`} aria-hidden="true" style={{ position: "absolute", left: `${x * 33.333 + 16.666}%`, top: `${y * 33.333 + 16.666}%`, transform: "translate(-50%, -50%)", color: owner === "1" ? "#bd5d52" : "#27312d", fontWeight: 800 }}>{owner === "1" ? "红" : owner === "2" ? "黑" : ""}</span>;
      })}
      {selected && <span aria-hidden="true" style={{ position: "absolute", left: `calc(${(selected.x / 3) * 100}% - 11px)`, top: `calc(${(selected.y / 3) * 100}% - 11px)`, width: 22, height: 22, border: "2px solid #bd5d52", borderRadius: "50%", zIndex: 3 }} />}
    </div>
  );
}

function mancalaBoard(
  state: OnlinePositionState | null,
  onPoint: (point: OnlinePoint) => void,
): ReactElement {
  const value = state?.board && typeof state.board === "object" ? state.board as { pits?: number[]; stores?: number[] } : {};
  const pits = value.pits ?? [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0];
  const stores = value.stores ?? [0, 0];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(70px, .7fr) 1fr minmax(70px, .7fr)", gap: 10, alignItems: "stretch", padding: 16, borderRadius: 16, background: "#b9784f", border: "3px solid #7c4932" }} aria-label="播棋棋盘">
      <button type="button" onClick={() => onPoint({ x: 6, y: 0 })} style={{ ...buttonBase, borderRadius: 40, background: "#e2b57a", fontWeight: 800 }}>黑仓<br />{stores[1] ?? 0}</button>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 7 }}>
          {[12, 11, 10, 9, 8, 7].map((index) => <button key={index} type="button" onClick={() => onPoint({ x: 12 - index, y: 0 })} style={{ ...buttonBase, aspectRatio: "1", borderRadius: "50%", background: "#f5d59f", fontWeight: 800 }}>{pits[index] ?? 0}</button>)}
        </div>
        <div style={{ height: 1, background: "rgba(64, 37, 23, .35)" }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 7 }}>
          {[0, 1, 2, 3, 4, 5].map((index) => <button key={index} type="button" onClick={() => onPoint({ x: index, y: 1 })} style={{ ...buttonBase, aspectRatio: "1", borderRadius: "50%", background: "#f5d59f", fontWeight: 800 }}>{pits[index] ?? 0}</button>)}
        </div>
      </div>
      <button type="button" onClick={() => onPoint({ x: 6, y: 1 })} style={{ ...buttonBase, borderRadius: 40, background: "#e2b57a", fontWeight: 800 }}>红仓<br />{stores[0] ?? 0}</button>
    </div>
  );
}

function ludoBoard(state: OnlinePositionState | null, onPoint: (point: OnlinePoint) => void): ReactElement {
  const value = state?.board && typeof state.board === "object" ? state.board as { tokens?: number[][] } : {};
  const tokens = value.tokens ?? [[-1, -1, -1, -1], [-1, -1, -1, -1]];
  return (
    <div style={{ display: "grid", gap: 14, padding: 18, borderRadius: 16, background: "#eaf1f5", border: "2px solid #b9cbd3" }} aria-label="飞行棋轨道">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(13, minmax(18px, 1fr))", gap: 4 }}>
        {Array.from({ length: 52 }, (_, index) => <span key={index} aria-hidden="true" style={{ aspectRatio: "1", borderRadius: "50%", background: index % 13 === 0 ? "#d98a73" : "#fff", border: "1px solid #b6c7ce" }} />)}
      </div>
      {[RED, BLACK].map((seat, side) => <div key={seat} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><strong style={{ color: side === 0 ? "#bd5d52" : "#334d83" }}>{seatLabel("ludo", seat)}棋子</strong>{tokens[side].map((token, index) => <button key={index} type="button" onClick={() => onPoint({ x: index, y: side })} style={{ ...buttonBase, width: 42, height: 34, borderRadius: 8, background: side === 0 ? "#f4c3b8" : "#c8d5ef", fontSize: 12 }}>{token < 0 ? "家" : token >= 57 ? "终" : `${token}步`}</button>)}</div>)}
      <small style={{ color: muted }}>点击己方棋子前进；房间状态会保存每一步位置。</small>
    </div>
  );
}

function backgammonBoard(state: OnlinePositionState | null, onPoint: (point: OnlinePoint) => void): ReactElement {
  const value = state?.board && typeof state.board === "object" ? state.board as { points?: number[]; borneOff?: number[] } : {};
  const points = value.points ?? [];
  const borneOff = value.borneOff ?? [0, 0];
  return (
    <div style={{ display: "grid", gap: 10, padding: 16, borderRadius: 16, background: "#31594e", border: "3px solid #1e3c35" }} aria-label="双陆棋棋盘">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(24px, 1fr))", gap: 6 }}>
        {Array.from({ length: 24 }, (_, index) => {
          const count = points[index] ?? 0;
          const point = { x: index < 12 ? index : index - 12, y: index < 12 ? 0 : 1 };
          return <button key={index} type="button" onClick={() => onPoint(point)} style={{ ...buttonBase, minHeight: 92, borderRadius: 8, background: index % 2 ? "#e6bd84" : "#f1d7a8", color: count < 0 ? "#263343" : "#6e332a", fontWeight: 800 }}>{index + 1}<br /><span style={{ fontSize: 22 }}>{Math.abs(count)}</span></button>;
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button type="button" onClick={() => onPoint({ x: 11, y: 2 })} style={{ ...buttonBase, padding: "9px 10px", borderRadius: 8, background: "#e7c995", color: "#263343", fontWeight: 700 }}>红方收棋区 · {borneOff[0] ?? 0}</button>
        <button type="button" onClick={() => onPoint({ x: 0, y: 2 })} style={{ ...buttonBase, padding: "9px 10px", borderRadius: 8, background: "#e7c995", color: "#263343", fontWeight: 700 }}>黑方收棋区 · {borneOff[1] ?? 0}</button>
      </div>
    </div>
  );
}

function starBoard(
  state: OnlinePositionState | null,
  selected: OnlinePoint | null,
  targets: OnlineMoveCandidate[],
  onPoint: (point: OnlinePoint) => void,
): ReactElement {
  const board = boardString(state) ?? "";
  const definition = state ? getOnlineGameDefinition(state.game) : null;
  const coordinates = definition?.engine.board.coordinates ?? [];
  const targetKeys = new Set(targets.map((move) => pointKey(move.to)));
  return (
    <div role="grid" aria-label="中国跳棋星形棋盘" style={{ position: "relative", width: "100%", maxWidth: 650, aspectRatio: "1", margin: "0 auto", borderRadius: "50%", background: "#e8d6b6", border: "3px solid #a78358" }}>
      {coordinates.map((point) => {
        const value = board[point.y * 13 + point.x] ?? "0";
        const selectedHere = Boolean(selected && samePoint(selected, point));
        const targetHere = targetKeys.has(pointKey(point));
        return <button key={pointKey(point)} type="button" role="gridcell" onClick={() => onPoint(point)} aria-label={`${point.y + 1}行${point.x + 1}列${cellGlyph("chinese-checkers", value) || "空位"}`} style={{ ...buttonBase, position: "absolute", left: `calc(${(point.x / 12) * 100}% - 13px)`, top: `calc(${(point.y / 12) * 100}% - 13px)`, width: 26, height: 26, padding: 0, borderRadius: "50%", background: selectedHere ? "#afd4b7" : targetHere ? "#d7ebdb" : value === "r" ? "#bd5d52" : value === "b" ? "#334d83" : "#f8f2e5", borderColor: targetHere ? sage : "#92734c", boxShadow: targetHere ? `0 0 0 3px ${sage}` : undefined }} />;
      })}
    </div>
  );
}

function gameBoard(
  gameId: OnlineGameId,
  room: GameRoom,
  state: OnlinePositionState | null,
  selected: OnlinePoint | null,
  targets: OnlineMoveCandidate[],
  onPoint: (point: OnlinePoint) => void,
  onCandidate: (move: OnlineMoveCandidate) => void,
): ReactElement {
  if (gameId === "army-chess") {
    return <ArmyChessBoard state={state} selected={selected} targets={targets} lastMove={room.lastMove} onPoint={onPoint} />;
  }
  return <ReferenceBoard gameId={gameId} state={state} selected={selected} targets={targets} lastMove={room.lastMove} onPoint={onPoint} onCandidate={onCandidate} />;
}

export function OnlineBoardGame({ room, seat, client }: OnlineBoardGameProps): ReactElement {
  const rawGameId = String(room.gameId);
  const gameId = isOnlineGameId(rawGameId) ? rawGameId : null;
  const definition = gameId ? getOnlineGameDefinition(gameId) : null;
  const state = useMemo(() => gameId ? parseOnlinePosition(gameId, room.position) : null, [gameId, room.position]);
  const [selected, setSelected] = useState<OnlinePoint | null>(null);
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [pendingSeq, setPendingSeq] = useState<number | null>(null);

  useEffect(() => {
    setSelected(null);
    setError("");
    setNotice("");
    setPendingSeq(null);
  }, [room.id, gameId]);

  useEffect(() => {
    if (pendingSeq !== null && room.seq >= pendingSeq) {
      setPendingSeq(null);
      setNotice("服务器已确认这一步");
    }
  }, [pendingSeq, room.seq]);

  useEffect(() => {
    if (room.undoRequest) setSelected(null);
  }, [room.undoRequest]);

  const targets = useMemo(
    () => gameId && seat && selected ? getLegalMoves(gameId, room.position, seat, selected) : [],
    [gameId, room.position, seat, selected],
  );

  if (!gameId || !definition) {
    return <section style={shell}><div style={{ display: "flex", alignItems: "center", gap: 8, color: "#a34f48" }}><CircleAlert size={18} />暂不支持这个联机棋类：{rawGameId}</div></section>;
  }

  const submit = (from: OnlinePoint, to?: OnlinePoint) => {
    if (!seat) { setError("当前为观战状态，不能落子"); return; }
    if (room.status !== "playing") { setError("房间尚未开始或本局已经结束"); return; }
    if (room.undoRequest) { setError("请先处理当前悔棋请求"); return; }
    if (room.turn !== seat) { setError(`还没轮到${seatLabel(gameId, seat)}`); return; }
    if (pendingSeq !== null) { setError("上一手正在等待服务器确认"); return; }
    const move = createOnlineMove({ roomId: room.id, gameId, seat, seq: room.seq + 1, position: room.position, from, ...(to ? { to } : {}) });
    if (!move) { setError("这个落点不符合当前棋局规则"); return; }
    setError("");
    setNotice("已提交，等待服务器确认");
    setPendingSeq(move.seq);
    void client.sendMove(move).catch((sendError) => {
      setPendingSeq(null);
      setNotice("");
      setError(socialErrorMessage(sendError));
    });
  };

  const onCandidate = (move: OnlineMoveCandidate) => submit(move.from, move.to);
  const onPoint = (point: OnlinePoint) => {
    if (!seat || room.status !== "playing" || room.turn !== seat || room.undoRequest) {
      if (room.undoRequest) {
        setError("请先处理当前悔棋请求");
        return;
      }
      setError(seat ? `还没轮到${seatLabel(gameId, seat)}` : "当前为观战状态，不能落子");
      return;
    }
    if (gameId === "dots-and-boxes") {
      const direct = getLegalMoves(gameId, room.position, seat).find((move) => samePoint(move.from, point));
      if (direct) { setSelected(null); return; }
    }
    if (gameId === "ludo" || gameId === "mancala") {
      const direct = getLegalMoves(gameId, room.position, seat, point)[0];
      if (direct) { submit(direct.from); return; }
    }
    const direct = getLegalMoves(gameId, room.position, seat, point).find((move) => samePoint(move.from, point) && samePoint(move.to, point));
    if (direct) { submit(point, point); return; }
    if (selected) {
      const target = targets.find((move) => samePoint(move.to, point));
      if (target) { setSelected(null); submit(target.from, target.to); return; }
    }
    const movable = getLegalMoves(gameId, room.position, seat, point);
    if (movable.length > 0) { setSelected(point); setError(""); return; }
    setSelected(null);
    setError("这里不是当前席位的合法落点");
  };

  return (
    <section
      className={`online-board-game is-${gameId}`}
      data-game-id={gameId}
      aria-label={`联机${definition.label}`}
      style={shell}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <header className="online-board-game-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap", paddingBottom: 14, borderBottom: "1px solid #e0e8e2" }}>
        <div>
          <span style={{ color: muted, fontSize: 12, letterSpacing: ".04em" }}>联机棋盘 · 房间 {room.code}</span>
          <h3 style={{ margin: "5px 0 4px", fontSize: 23, lineHeight: 1.2 }}>{definition.label}</h3>
          <p style={{ margin: 0, color: muted, fontSize: 13 }}>{definition.ruleSummary} · {definition.description}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 999, background: pale, color: sage, fontSize: 13, fontWeight: 700 }}><CircleDot size={14} />{statusLabel(room)}</span>
          <span style={{ color: muted, fontSize: 12 }}>第 {room.seq} 手</span>
        </div>
      </header>

      <div className="online-board-game-players" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, margin: "14px 0", fontSize: 13 }}>
        <div style={{ padding: "8px 10px", borderRadius: 8, background: room.turn === "red" && room.status === "playing" ? "#f9e7e3" : "#f3f6f3" }}><strong>{seatLabel(gameId, "red")}</strong>　{room.players.red?.user.displayName ?? "等待加入"}{seat === "red" ? " · 你" : ""}</div>
        <div style={{ padding: "8px 10px", borderRadius: 8, background: room.turn === "black" && room.status === "playing" ? "#e9eef0" : "#f3f6f3" }}><strong>{seatLabel(gameId, "black")}</strong>　{room.players.black?.user.displayName ?? "等待加入"}{seat === "black" ? " · 你" : ""}</div>
      </div>

      {(error || notice) && <div className="online-board-game-alert" role={error ? "alert" : "status"} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12, padding: "9px 11px", borderRadius: 8, background: error ? "#fff1ef" : "#edf7ef", color: error ? "#a34f48" : sage, fontSize: 13 }}>{error ? <CircleAlert size={15} /> : <LoaderCircle size={15} className={pendingSeq !== null ? "is-spinning" : undefined} />}{error || notice}</div>}

      <div className="online-board-game-core" style={{ display: "flex", justifyContent: "center", minHeight: 180 }}>
        {gameBoard(gameId, room, state, selected, targets, onPoint, onCandidate)}
      </div>

      <footer className="online-board-game-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 14, paddingTop: 12, borderTop: "1px solid #e0e8e2", color: muted, fontSize: 12 }}>
        <span>{seat ? `你是${seatLabel(gameId, seat)}` : "观战中"}{selected ? " · 已选择棋子，请点击目标位置" : " · 点击棋盘开始操作"}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Wifi size={14} />服务器实时房间</span>
      </footer>
      <p className="online-board-game-note" style={{ display: "flex", alignItems: "center", gap: 6, margin: "10px 0 0", color: muted, fontSize: 11 }}><Shield size={13} />每次点击都会生成完整新位置并交给服务器校验；客户端不会伪造落子成功。</p>
    </section>
  );
}
