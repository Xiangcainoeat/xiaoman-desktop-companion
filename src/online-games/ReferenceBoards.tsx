import type { ReactElement } from "react";
import { articleGameServerUrl, serverOriginForPage } from "../shared/server-origin";
import type { GameMove } from "../social/types";
import { getOnlineGameDefinition } from "./catalog";
import type { OnlineGameId, OnlineMoveCandidate, OnlinePoint, OnlinePositionState } from "./types";

export interface ReferenceBoardProps {
  gameId: OnlineGameId;
  state: OnlinePositionState | null;
  selected: OnlinePoint | null;
  targets: OnlineMoveCandidate[];
  lastMove: GameMove | null;
  onPoint: (point: OnlinePoint) => void;
  onCandidate: (move: OnlineMoveCandidate) => void;
}

type LineGameId = "gomoku" | "connect6" | "go";

export interface ReferenceLineBoardProps {
  gameId: LineGameId;
  state: OnlinePositionState | null;
  selected: OnlinePoint | null;
  targets: OnlineMoveCandidate[];
  lastMove: GameMove | null;
  onPoint: (point: OnlinePoint) => void;
  size: number;
  disabled?: (point: OnlinePoint, value: string) => boolean;
  winningKeys?: ReadonlySet<string>;
}

function pointKey(point: OnlinePoint): string {
  return `${point.x}:${point.y}`;
}

function samePoint(left: OnlinePoint | null, right: OnlinePoint | null): boolean {
  return Boolean(left && right && left.x === right.x && left.y === right.y);
}

function boardString(state: OnlinePositionState | null): string {
  return state && typeof state.board === "string" ? state.board : "";
}

function valueAt(board: string, point: OnlinePoint, columns: number): string {
  return board[point.y * columns + point.x] ?? "0";
}

function percent(value: number, max: number): string {
  return `${(value / max) * 100}%`;
}

function targetSet(targets: OnlineMoveCandidate[]): Set<string> {
  return new Set(targets.map((move) => pointKey(move.to)));
}

function movePoint(lastMove: GameMove | null, gameId: OnlineGameId): OnlinePoint | null {
  return lastMove?.gameId === gameId ? lastMove.to : null;
}

/**
 * Piece encodings differ by game: checkers uses r/b, while the chess-family
 * engines use uppercase/lowercase to represent the two sides. Keep that
 * protocol detail out of the visual components so every board gets a real
 * owner style instead of silently falling back to an empty piece.
 */
function pieceTone(gameId: OnlineGameId, value: string): "red" | "black" | "empty" {
  if (isEmpty(value)) return "empty";
  if (gameId === "checkers" || gameId === "chinese-checkers") {
    if (value === "r" || value === "R") return "red";
    if (value === "b" || value === "B") return "black";
  }
  if (value === "1") return "red";
  if (value === "2") return "black";
  return value === value.toUpperCase() ? "red" : "black";
}

function isEmpty(value: string): boolean {
  return value === "0" || value === "." || value === "";
}

const CHESS_LABELS: Record<string, string> = {
  p: "黑方兵", r: "黑方车", n: "黑方马", b: "黑方象", q: "黑方后", k: "黑方王",
  P: "白方兵", R: "白方车", N: "白方马", B: "白方象", Q: "白方后", K: "白方王",
};

const XIANGQI_GLYPHS: Record<string, string> = {
  r: "車", n: "馬", b: "象", a: "士", k: "將", c: "砲", p: "卒",
  R: "車", N: "傌", B: "相", A: "仕", K: "帥", C: "炮", P: "兵",
};

const XIANGQI_ASSET_KINDS: Record<string, string> = {
  r: "c",
  n: "m",
  b: "x",
  a: "s",
  k: "j",
  c: "p",
  p: "z",
};

const XIANGQI_ASSET_ROOT = articleGameServerUrl(
  serverOriginForPage(typeof window === "undefined" ? null : window.location),
  "xiangqi-h5",
  "img/stype_2",
);
const XIANGQI_GRID_LEFT = 4.53;
const XIANGQI_GRID_TOP = 4.31;
const XIANGQI_GRID_WIDTH = 89.06;
const XIANGQI_GRID_HEIGHT = 91.38;

function xiangqiPieceSource(value: string): string | null {
  const kind = XIANGQI_ASSET_KINDS[value.toLowerCase()];
  if (!kind) return null;
  const side = pieceTone("xiangqi", value) === "red" ? "r" : "b";
  return `${XIANGQI_ASSET_ROOT}/${side}_${kind}.png`;
}

const SHOGI_GLYPHS: Record<string, string> = {
  p: "歩", l: "香", n: "桂", s: "銀", g: "金", k: "玉", r: "飛", b: "角",
  P: "歩", L: "香", N: "桂", S: "銀", G: "金", K: "王", R: "飛", B: "角",
};

const SHOGI_LABELS: Record<string, string> = {
  p: "步兵", l: "香车", n: "桂马", s: "银将", g: "金将", k: "玉将", r: "飞车", b: "角行",
  P: "步兵", L: "香车", N: "桂马", S: "银将", G: "金将", K: "王将", R: "飞车", B: "角行",
};

const SHOGI_FILES = ["9", "8", "7", "6", "5", "4", "3", "2", "1"];
const SHOGI_RANKS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

const ANIMAL_EMOJI: Record<string, string> = {
  e: "🐘", l: "🦁", t: "🐯", f: "🐆", w: "🐺", d: "🐶", c: "🐱", r: "🐭",
  E: "🐘", L: "🦁", T: "🐯", F: "🐆", W: "🐺", D: "🐶", C: "🐱", R: "🐭",
};

const ANIMAL_LABELS: Record<string, string> = {
  e: "象", l: "狮", t: "虎", f: "豹", w: "狼", d: "犬", c: "猫", r: "鼠",
  E: "象", L: "狮", T: "虎", F: "豹", W: "狼", D: "犬", C: "猫", R: "鼠",
};

type ChessKind = "p" | "r" | "n" | "b" | "q" | "k";

/**
 * The reference site uses illustrated chessmen rather than text glyphs. These
 * small, local vectors keep the same visual idea without bundling an unknown
 * third-party asset, and scale cleanly inside every square size.
 */
function ChessVectorPiece({ value }: { value: string }): ReactElement {
  const side = pieceTone("chess", value);
  const kind = value.toLowerCase() as ChessKind;
  const light = side === "red";
  const fill = light ? "#f7f3e6" : "#293337";
  const outline = light ? "#9b8057" : "#101719";
  const highlight = light ? "#ffffff" : "#69767b";
  const common = {
    fill,
    stroke: outline,
    strokeWidth: 2.4,
    strokeLinejoin: "round" as const,
    strokeLinecap: "round" as const,
  };
  const pedestal = (
    <>
      <path d="M31 71h38l5 14H26l5-14Z" />
      <rect x="21" y="84" width="58" height="9" rx="3" />
    </>
  );
  let art: ReactElement;
  switch (kind) {
    case "r":
      art = <><path d="M28 14h10v8h8v-8h12v8h8v-8h10v20l-7 7 4 30H27l4-30-7-7V14Z" />{pedestal}</>;
      break;
    case "n":
      art = <><path d="M29 78c-1-11 4-19 13-25-2-9-1-18 5-29l-4-10 12 5 11-7-2 13c10 5 15 14 13 24-2 10-10 15-17 19l8 10H29Z" />{pedestal}</>;
      break;
    case "b":
      art = <><circle cx="50" cy="19" r="10" /><path d="M50 29c-8 8-15 18-15 27 0 8 5 13 11 16H29v9h42v-9H54c6-3 11-8 11-16 0-9-7-19-15-27Z" /><path d="m44 39 12 13" fill="none" stroke={highlight} strokeWidth="3" />{pedestal}</>;
      break;
    case "q":
      art = <><path d="m24 25 12 16 14-23 14 23 12-16-6 47H30l-6-47Z" /><circle cx="24" cy="22" r="5" /><circle cx="50" cy="15" r="5" /><circle cx="76" cy="22" r="5" />{pedestal}</>;
      break;
    case "k":
      art = <><path d="M44 10h12v12h12v10H56v10c9 7 15 15 15 24 0 7-3 11-8 14H37c-5-3-8-7-8-14 0-9 6-17 15-24V32H32V22h12V10Z" />{pedestal}</>;
      break;
    case "p":
    default:
      art = <><circle cx="50" cy="22" r="11" /><path d="M40 34c-1 7 2 12 8 16l-7 21h18l-7-21c6-4 9-9 8-16H40Z" />{pedestal}</>;
      break;
  }
  return (
    <span
      className={`reference-chess-piece is-${side} reference-chess-vector-piece`}
      data-piece-kind={kind}
      data-piece-side={side}
      data-piece-label={CHESS_LABELS[value] ?? "棋子"}
      data-piece-renderer="inline-svg"
      style={{ display: "block", width: "84%", height: "90%", filter: "drop-shadow(0 2px 2px rgba(30, 35, 31, .34))" }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" focusable="false">
        <g {...common}>{art}</g>
        <path d="M33 80h34" fill="none" stroke={highlight} strokeWidth="2" strokeLinecap="round" opacity=".7" />
      </svg>
    </span>
  );
}

function lineBoard(
  gameId: LineGameId,
  state: OnlinePositionState | null,
  selected: OnlinePoint | null,
  targets: OnlineMoveCandidate[],
  lastMove: GameMove | null,
  onPoint: (point: OnlinePoint) => void,
  size: number,
  options: Pick<ReferenceLineBoardProps, "disabled" | "winningKeys"> = {},
): ReactElement {
  const board = boardString(state);
  const targetKeys = targetSet(targets);
  const last = movePoint(lastMove, gameId);
  const coordinates = Array.from({ length: size }, (_, index) => index);
  const stars = size === 15 ? [3, 7, 11] : size === 19 ? [3, 9, 15] : [2, 4, 6];
  return (
    <div className={`reference-board reference-line-board is-${gameId}`} data-reference-board="freeplayisok-inspired" role="grid" aria-label={`${size}乘${size}${getOnlineGameDefinition(gameId).label}棋盘`} aria-rowcount={size} aria-colcount={size}>
      <svg className="reference-line-board-graphic" viewBox={`0 0 ${size - 1} ${size - 1}`} preserveAspectRatio="none" aria-hidden="true">
        <rect className="reference-line-board-fill" x="0" y="0" width={size - 1} height={size - 1} />
        {coordinates.slice(1, -1).map((coordinate) => (
          <g key={coordinate}>
            <line x1={coordinate} y1="0" x2={coordinate} y2={size - 1} />
            <line x1="0" y1={coordinate} x2={size - 1} y2={coordinate} />
          </g>
        ))}
        <rect className="reference-line-board-outline" x="0" y="0" width={size - 1} height={size - 1} />
        {stars.flatMap((y) => stars.map((x) => <circle className="reference-line-board-star" key={`${x}:${y}`} cx={x} cy={y} r={size > 15 ? ".13" : ".11"} />))}
      </svg>
      <div className="reference-line-board-points">
        {coordinates.flatMap((y) => coordinates.map((x) => {
          const point = { x, y };
          const value = valueAt(board, point, size);
          const key = pointKey(point);
          const target = targetKeys.has(key);
          const selectedHere = samePoint(selected, point);
          const lastHere = samePoint(last, point);
          const winningHere = options.winningKeys?.has(key) ?? false;
          const tone = isEmpty(value) ? "is-empty" : value === "1" ? "is-black" : "is-white";
          return (
            <button
              key={key}
              type="button"
              className={`reference-line-point ${tone} ${target ? "is-target" : ""} ${selectedHere ? "is-selected" : ""} ${lastHere ? "is-last" : ""} ${winningHere ? "is-winning" : ""}`}
              style={{ left: percent(x, size - 1), top: percent(y, size - 1) }}
              role="gridcell"
              aria-rowindex={y + 1}
              aria-colindex={x + 1}
              aria-label={`${y + 1}行${x + 1}列${isEmpty(value) ? "空位" : value === "1" ? "黑子" : "白子"}`}
              disabled={options.disabled?.(point, value)}
              onClick={() => onPoint(point)}
            >
              {!isEmpty(value) && <span className="reference-stone" aria-hidden="true" />}
              {target && isEmpty(value) && <span className="reference-target" aria-hidden="true" />}
              {winningHere && <span className="reference-winning-mark" aria-hidden="true" />}
            </button>
          );
        }))}
      </div>
    </div>
  );
}

export function ReferenceLineBoard(props: ReferenceLineBoardProps): ReactElement {
  const { gameId, state, selected, targets, lastMove, onPoint, size, disabled, winningKeys } = props;
  return lineBoard(gameId, state, selected, targets, lastMove, onPoint, size, { disabled, winningKeys });
}

function renderGridPiece(gameId: OnlineGameId, value: string): ReactElement | null {
  if (isEmpty(value)) return null;
  if (gameId === "reversi") return <span className={`reference-disc is-${pieceTone(gameId, value)}`} aria-hidden="true" />;
  if (gameId === "checkers") return <span className={`reference-checker-piece is-${pieceTone(gameId, value)} ${value === value.toUpperCase() ? "is-king" : ""}`} aria-hidden="true"><i /></span>;
  if (gameId === "chess") return <ChessVectorPiece value={value} />;
  if (gameId === "tic-tac-toe") return <span className={`reference-tic-mark is-${pieceTone(gameId, value)}`} aria-hidden="true">{value === "1" ? "×" : "○"}</span>;
  return <span className={`reference-generic-piece is-${pieceTone(gameId, value)}`} aria-hidden="true">{value.toUpperCase()}</span>;
}

function squareGridBoard(
  gameId: OnlineGameId,
  state: OnlinePositionState | null,
  selected: OnlinePoint | null,
  targets: OnlineMoveCandidate[],
  lastMove: GameMove | null,
  onPoint: (point: OnlinePoint) => void,
  columns: number,
  rows: number,
): ReactElement {
  const board = boardString(state);
  const targetKeys = targetSet(targets);
  const last = movePoint(lastMove, gameId);
  return (
    <div className={`reference-board reference-square-board is-${gameId}`} data-reference-board="freeplayisok-inspired" role="grid" aria-label={`${columns}乘${rows}${getOnlineGameDefinition(gameId).label}棋盘`} aria-rowcount={rows} aria-colcount={columns} style={gameId === "chess" ? { background: "#dfe7d7", borderColor: "#6a7a47", padding: "11px" } : undefined}>
      <div className="reference-square-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {Array.from({ length: columns * rows }, (_, index) => {
          const point = { x: index % columns, y: Math.floor(index / columns) };
          const value = valueAt(board, point, columns);
          const key = pointKey(point);
          const target = targetKeys.has(key);
          const selectedHere = samePoint(selected, point);
          const lastHere = samePoint(last, point);
          const light = (point.x + point.y) % 2 === 0;
          const pieceLabel = isEmpty(value) ? "空位" : gameId === "chess" ? CHESS_LABELS[value] ?? "棋子" : "有棋子";
          return (
            <button
              key={key}
              type="button"
              className={`reference-square-cell ${light ? "is-light" : "is-dark"} ${target ? "is-target" : ""} ${selectedHere ? "is-selected" : ""} ${lastHere ? "is-last" : ""}`}
              style={gameId === "chess" ? { background: light ? "#ebecd0" : "#739552" } : undefined}
              role="gridcell"
              aria-label={`${point.y + 1}行${point.x + 1}列${pieceLabel}`}
              onClick={() => onPoint(point)}
            >
              {renderGridPiece(gameId, value)}
              {target && isEmpty(value) && <span className="reference-target" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {gameId === "chess" && (
        <>
          <div className="reference-square-files" aria-hidden="true"><span>a</span><span>b</span><span>c</span><span>d</span><span>e</span><span>f</span><span>g</span><span>h</span></div>
          <div className="reference-square-ranks" aria-hidden="true"><span>8</span><span>7</span><span>6</span><span>5</span><span>4</span><span>3</span><span>2</span><span>1</span></div>
        </>
      )}
    </div>
  );
}

function xiangqiBoard(
  state: OnlinePositionState | null,
  selected: OnlinePoint | null,
  targets: OnlineMoveCandidate[],
  lastMove: GameMove | null,
  onPoint: (point: OnlinePoint) => void,
): ReactElement {
  const board = boardString(state);
  const targetKeys = targetSet(targets);
  const last = movePoint(lastMove, "xiangqi");
  const xs = Array.from({ length: 9 }, (_, index) => index);
  const ys = Array.from({ length: 10 }, (_, index) => index);
  return (
    <div className="reference-board reference-xiangqi-board" data-reference-board="freeplayisok-inspired" role="grid" aria-label="九路十行中国象棋棋盘" aria-rowcount={10} aria-colcount={9}>
      <img className="reference-xiangqi-graphic" src={`${XIANGQI_ASSET_ROOT}/bg.png`} alt="" draggable={false} />
      <div className="reference-xiangqi-points">
        {ys.flatMap((y) => xs.map((x) => {
          const point = { x, y };
          const value = valueAt(board, point, 9);
          const key = pointKey(point);
          const target = targetKeys.has(key);
          const selectedHere = samePoint(selected, point);
          const lastHere = samePoint(last, point);
          const pieceSource = xiangqiPieceSource(value);
          return (
            <button key={key} type="button" className={`reference-xiangqi-point ${target ? "is-target" : ""} ${selectedHere ? "is-selected" : ""} ${lastHere ? "is-last" : ""}`} style={{ left: `${XIANGQI_GRID_LEFT + (x / 8) * XIANGQI_GRID_WIDTH}%`, top: `${XIANGQI_GRID_TOP + (y / 9) * XIANGQI_GRID_HEIGHT}%` }} role="gridcell" aria-rowindex={y + 1} aria-colindex={x + 1} aria-label={`${y + 1}行${x + 1}列${isEmpty(value) ? "空位" : XIANGQI_GLYPHS[value] ?? "棋子"}`} onClick={() => onPoint(point)}>
              {isEmpty(value) ? target && <span className="reference-target" aria-hidden="true" /> : <span className={`reference-xiangqi-piece is-${pieceTone("xiangqi", value)}`} aria-hidden="true">{pieceSource ? <img src={pieceSource} alt="" draggable={false} /> : <span className="reference-xiangqi-piece-glyph">{XIANGQI_GLYPHS[value] ?? value}</span>}</span>}
            </button>
          );
        }))}
      </div>
    </div>
  );
}

function shogiBoard(
  state: OnlinePositionState | null,
  selected: OnlinePoint | null,
  targets: OnlineMoveCandidate[],
  lastMove: GameMove | null,
  onPoint: (point: OnlinePoint) => void,
): ReactElement {
  const board = boardString(state);
  const targetKeys = targetSet(targets);
  const last = movePoint(lastMove, "shogi");
  return (
    <div className="reference-board reference-shogi-board" data-reference-board="freeplayisok-inspired" data-board-layout="shogi-camp-frame" role="grid" aria-label="九路日本将棋棋盘" aria-rowcount={9} aria-colcount={9} style={{ background: "#d4b483", backgroundImage: "repeating-linear-gradient(125deg, rgba(255,255,255,.1) 0 2px, transparent 2px 8px), repeating-linear-gradient(35deg, rgba(102,72,36,.08) 0 1px, transparent 1px 7px)" }}>
      <div className="reference-shogi-zone is-top" data-reference-zone="gote" aria-hidden="true" style={{ position: "absolute", top: "1.5%", left: "9%", right: "9%", height: "6.5%", display: "flex", alignItems: "center", gap: "5%", color: "#526b82", fontSize: "clamp(10px, 2.4cqw, 16px)", fontWeight: 800, letterSpacing: ".04em", pointerEvents: "none", zIndex: 3, borderBottom: "1px solid rgba(105,76,40,.35)" }}>
        <span style={{ whiteSpace: "nowrap" }}>后手 · 蓝方</span>
        <span style={{ display: "grid", flex: 1, gridTemplateColumns: "repeat(9, minmax(0, 1fr))", textAlign: "center", color: "rgba(82,66,47,.72)", fontSize: ".82em", fontWeight: 700 }}>{SHOGI_FILES.map((file) => <span key={`top-${file}`}>{file}</span>)}</span>
      </div>
      <div className="reference-shogi-zone is-bottom" data-reference-zone="sente" aria-hidden="true" style={{ position: "absolute", right: "9%", bottom: "1.5%", left: "9%", height: "6.5%", display: "flex", alignItems: "center", gap: "5%", color: "#a6433b", fontSize: "clamp(10px, 2.4cqw, 16px)", fontWeight: 800, letterSpacing: ".04em", pointerEvents: "none", zIndex: 3, borderTop: "1px solid rgba(105,76,40,.35)" }}>
        <span style={{ display: "grid", flex: 1, gridTemplateColumns: "repeat(9, minmax(0, 1fr))", textAlign: "center", color: "rgba(82,66,47,.72)", fontSize: ".82em", fontWeight: 700 }}>{SHOGI_FILES.map((file) => <span key={`bottom-${file}`}>{file}</span>)}</span>
        <span style={{ whiteSpace: "nowrap" }}>先手 · 红方</span>
      </div>
      <div className="reference-shogi-ranks is-left" aria-hidden="true" style={{ position: "absolute", top: "9%", bottom: "9%", left: "1.4%", display: "grid", gridTemplateRows: "repeat(9, minmax(0, 1fr))", alignItems: "center", color: "rgba(82,66,47,.72)", fontSize: "clamp(9px, 2cqw, 14px)", fontWeight: 700, pointerEvents: "none", zIndex: 3 }}>{SHOGI_RANKS.map((rank) => <span key={`left-${rank}`}>{rank}</span>)}</div>
      <div className="reference-shogi-ranks is-right" aria-hidden="true" style={{ position: "absolute", top: "9%", right: "1.4%", bottom: "9%", display: "grid", gridTemplateRows: "repeat(9, minmax(0, 1fr))", alignItems: "center", color: "rgba(82,66,47,.72)", fontSize: "clamp(9px, 2cqw, 14px)", fontWeight: 700, pointerEvents: "none", zIndex: 3 }}>{SHOGI_RANKS.map((rank) => <span key={`right-${rank}`}>{rank}</span>)}</div>
      <div className="reference-shogi-grid" style={{ top: "9%", right: "8%", bottom: "9%", left: "8%", width: "auto", height: "auto" }}>
        {Array.from({ length: 81 }, (_, index) => {
          const point = { x: index % 9, y: Math.floor(index / 9) };
          const value = valueAt(board, point, 9);
          const key = pointKey(point);
          const target = targetKeys.has(pointKey(point));
          const selectedHere = samePoint(selected, point);
          const lastHere = samePoint(last, point);
          const side = pieceTone("shogi", value);
          const pieceLabel = SHOGI_LABELS[value] ?? "棋子";
          const sideLabel = side === "red" ? "先手红方" : "后手蓝方";
          return <button key={key} type="button" className={`reference-shogi-cell ${target ? "is-target" : ""} ${selectedHere ? "is-selected" : ""} ${lastHere ? "is-last" : ""}`} data-coordinate={`${SHOGI_FILES[point.x]}${SHOGI_RANKS[point.y]}`} role="gridcell" aria-rowindex={point.y + 1} aria-colindex={point.x + 1} aria-label={`${point.y + 1}行${point.x + 1}列${isEmpty(value) ? "空位" : `${sideLabel}${pieceLabel}`}`} onClick={() => onPoint(point)}>{isEmpty(value) ? target && <span className="reference-target" aria-hidden="true" /> : <span className={`reference-shogi-piece is-${side}`} data-piece-kind={value.toLowerCase()} data-piece-side={side} data-piece-label={pieceLabel} title={`${sideLabel}${pieceLabel}`} aria-hidden="true" style={{ background: side === "red" ? "#f8f0df" : "#dce5e9", color: side === "red" ? "#a6433b" : "#42617a", boxShadow: "0 2px 3px rgba(82, 59, 31, .28)" }}><i style={{ fontStyle: "normal", lineHeight: 1 }}>{SHOGI_GLYPHS[value] ?? value}</i><span aria-hidden="true" style={{ position: "absolute", right: "11%", bottom: "8%", color: "currentColor", fontFamily: "ui-sans-serif, sans-serif", fontSize: ".22em", fontWeight: 800, lineHeight: 1 }}>{side === "red" ? "先" : "後"}</span></span>}</button>;
        })}
      </div>
    </div>
  );
}

function animalBoard(
  state: OnlinePositionState | null,
  selected: OnlinePoint | null,
  targets: OnlineMoveCandidate[],
  lastMove: GameMove | null,
  onPoint: (point: OnlinePoint) => void,
): ReactElement {
  const board = boardString(state);
  const targetKeys = targetSet(targets);
  const last = movePoint(lastMove, "animal-chess");
  const water = new Set(["1:1", "2:1", "5:1", "6:1", "1:2", "2:2", "5:2", "6:2"]);
  const den = new Set(["0:3", "7:0"]);
  const trap = new Set(["2:0", "3:0", "4:0", "2:3", "3:3", "4:3"]);
  return (
    <div className="reference-board reference-animal-board" data-reference-board="freeplayisok-inspired" data-protocol-layout="8x4" role="grid" aria-label="八乘四斗兽棋棋盘" aria-rowcount={4} aria-colcount={8} style={{ background: "#d4b483", borderColor: "#9c7b45", padding: "7px" }}>
      <div className="reference-animal-banner is-top" data-reference-zone="blue" aria-hidden="true" style={{ position: "absolute", top: "1%", right: "4%", left: "4%", height: "8%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2%", color: "#3d6177", fontSize: "clamp(10px, 2.4cqw, 16px)", fontWeight: 800, pointerEvents: "none", zIndex: 3 }}><span>蓝方</span><span style={{ color: "rgba(82,66,47,.7)", fontSize: ".82em", letterSpacing: ".08em" }}>斗兽棋 · 8 × 4</span><span aria-hidden="true">后场</span></div>
      <div className="reference-animal-banner is-bottom" data-reference-zone="red" aria-hidden="true" style={{ position: "absolute", right: "4%", bottom: "1%", left: "4%", height: "8%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2%", color: "#b7463e", fontSize: "clamp(10px, 2.4cqw, 16px)", fontWeight: 800, pointerEvents: "none", zIndex: 3 }}><span>前场</span><span style={{ color: "rgba(82,66,47,.7)", fontSize: ".82em", letterSpacing: ".08em" }}>本地协议保持 8 × 4</span><span aria-hidden="true">红方</span></div>
      <div className="reference-animal-grid" style={{ position: "absolute", top: "10%", right: "1.5%", bottom: "10%", left: "1.5%", width: "auto", height: "auto" }}>
        {Array.from({ length: 32 }, (_, index) => {
          const point = { x: index % 8, y: Math.floor(index / 8) };
          const key = pointKey(point);
          const value = valueAt(board, point, 8);
          const target = targetKeys.has(key);
          const selectedHere = samePoint(selected, point);
          const lastHere = samePoint(last, point);
          const terrain = den.has(key) ? "is-den" : trap.has(key) ? "is-trap" : water.has(key) ? "is-water" : "";
          const side = pieceTone("animal-chess", value);
          const animalLabel = ANIMAL_LABELS[value] ?? "棋子";
          const sideLabel = side === "red" ? "红方" : "蓝方";
          const cellStyle = water.has(key)
            ? { backgroundColor: "#91c5ca", backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,.32) 0 2px, transparent 2px 8px)" }
            : den.has(key)
              ? { backgroundColor: "#b9d2a0", boxShadow: "inset 0 0 0 3px rgba(110,145,83,.28)" }
              : trap.has(key)
                ? { backgroundColor: "#ddc294", backgroundImage: "linear-gradient(135deg, transparent 46%, rgba(164,108,60,.28) 47% 53%, transparent 54%), linear-gradient(45deg, transparent 46%, rgba(164,108,60,.28) 47% 53%, transparent 54%)" }
                : undefined;
          const pieceStyle = side === "red"
            ? { background: "radial-gradient(circle at 32% 24%, #ffb09c 0 10%, #df5d4e 48%, #a92d2a 100%)", borderColor: "rgba(255,247,232,.84)" }
            : { background: "radial-gradient(circle at 32% 24%, #a7d5e1 0 10%, #477f98 48%, #23495c 100%)", borderColor: "rgba(239,249,250,.82)" };
          return <button key={key} type="button" className={`reference-animal-cell ${terrain} ${target ? "is-target" : ""} ${selectedHere ? "is-selected" : ""} ${lastHere ? "is-last" : ""}`} style={cellStyle} data-coordinate={key} role="gridcell" aria-rowindex={point.y + 1} aria-colindex={point.x + 1} aria-label={`${point.y + 1}行${point.x + 1}列${isEmpty(value) ? "空位" : `${sideLabel}${animalLabel}`}`} onClick={() => onPoint(point)}>{isEmpty(value) ? <span className="reference-animal-terrain" aria-hidden="true" style={{ fontFamily: "ui-sans-serif, sans-serif", fontSize: "clamp(11px, 3.4cqw, 22px)", fontWeight: 800, color: den.has(key) ? "rgba(74,111,67,.72)" : trap.has(key) ? "rgba(126,83,49,.62)" : "rgba(43,106,119,.56)" }}>{den.has(key) ? "巢" : trap.has(key) ? "陷" : water.has(key) ? "≈" : ""}</span> : <span className={`reference-animal-piece is-${side}`} data-piece-kind={value.toLowerCase()} data-piece-side={side} data-visual-side={side === "red" ? "red" : "blue"} data-piece-label={animalLabel} data-piece-renderer="emoji" title={`${sideLabel}${animalLabel}`} aria-hidden="true" style={{ ...pieceStyle, width: "76%", height: "76%", aspectRatio: "1", borderWidth: "3px", borderStyle: "solid", borderRadius: "50%", boxShadow: "0 3px 5px rgba(43,56,39,.32), inset 2px 2px 3px rgba(255,255,255,.24)" }}><i style={{ display: "grid", placeItems: "center", width: "100%", height: "100%", fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", sans-serif', fontStyle: "normal", fontSize: "clamp(17px, 5.2cqw, 34px)", lineHeight: 1, filter: "drop-shadow(0 1px 1px rgba(35,43,42,.32))" }}>{ANIMAL_EMOJI[value] ?? "❔"}</i></span>}{target && isEmpty(value) && <span className="reference-target" aria-hidden="true" />}</button>;
        })}
      </div>
    </div>
  );
}

function dotsBoard(
  state: OnlinePositionState | null,
  selected: OnlinePoint | null,
  targets: OnlineMoveCandidate[],
  onCandidate: (move: OnlineMoveCandidate) => void,
): ReactElement {
  const value = state?.board && typeof state.board === "object" ? state.board as { h?: string; v?: string; boxes?: string; scores?: number[] } : {};
  const h = value.h ?? "0".repeat(12);
  const v = value.v ?? "0".repeat(12);
  const boxes = value.boxes ?? "0".repeat(9);
  const targetKeys = new Set(targets.map((move) => `${pointKey(move.from)}-${pointKey(move.to)}`));
  return (
    <div className="reference-board reference-dots-board" data-reference-board="freeplayisok-inspired" role="grid" aria-label="点格棋棋盘">
      <div className="reference-dots-lines">
        {Array.from({ length: 12 }, (_, index) => { const from = { x: index % 3, y: Math.floor(index / 3) }; const to = { x: from.x + 1, y: from.y }; const key = `${pointKey(from)}-${pointKey(to)}`; const active = h[index] !== "0"; return <button key={key} type="button" className={`reference-dot-edge is-horizontal ${active ? "is-filled" : targetKeys.has(key) ? "is-target" : ""}`} style={{ left: `${from.x * 33.333}%`, top: `${from.y * 33.333}%` }} aria-label="横向连线" onClick={() => onCandidate({ from, to, captured: null })} />; })}
        {Array.from({ length: 12 }, (_, index) => { const from = { x: index % 4, y: Math.floor(index / 4) }; const to = { x: from.x, y: from.y + 1 }; const key = `${pointKey(from)}-${pointKey(to)}`; const active = v[index] !== "0"; return <button key={key} type="button" className={`reference-dot-edge is-vertical ${active ? "is-filled" : targetKeys.has(key) ? "is-target" : ""}`} style={{ left: `${from.x * 33.333}%`, top: `${from.y * 33.333}%` }} aria-label="纵向连线" onClick={() => onCandidate({ from, to, captured: null })} />; })}
        {Array.from({ length: 16 }, (_, index) => { const point = { x: index % 4, y: Math.floor(index / 4) }; return <span key={pointKey(point)} className="reference-dot" style={{ left: percent(point.x, 3), top: percent(point.y, 3) }} aria-hidden="true" />; })}
        {Array.from({ length: 9 }, (_, index) => { const owner = boxes[index]; return <span key={`box-${index}`} className={`reference-dot-box is-${owner}`} style={{ left: `${(index % 3) * 33.333 + 16.666}%`, top: `${Math.floor(index / 3) * 33.333 + 16.666}%` }} aria-hidden="true">{owner === "1" ? "红" : owner === "2" ? "黑" : ""}</span>; })}
      </div>
      {selected && <span className="reference-dots-selection" style={{ left: percent(selected.x, 3), top: percent(selected.y, 3) }} aria-hidden="true" />}
    </div>
  );
}

function mancalaBoard(state: OnlinePositionState | null, onPoint: (point: OnlinePoint) => void): ReactElement {
  const value = state?.board && typeof state.board === "object" ? state.board as { pits?: number[]; stores?: number[] } : {};
  const pits = value.pits ?? [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0];
  const stores = value.stores ?? [0, 0];
  return <div className="reference-board reference-mancala-board" data-reference-board="freeplayisok-inspired" role="grid" aria-label="播棋棋盘"><button type="button" className="reference-mancala-store is-black" onClick={() => onPoint({ x: 6, y: 0 })}><small>黑方仓</small><strong>{stores[1] ?? 0}</strong></button><div className="reference-mancala-pits"><div>{[12, 11, 10, 9, 8, 7].map((index) => <button key={index} type="button" className="reference-mancala-pit is-black" onClick={() => onPoint({ x: 12 - index, y: 0 })}>{pits[index] ?? 0}</button>)}</div><div>{[0, 1, 2, 3, 4, 5].map((index) => <button key={index} type="button" className="reference-mancala-pit is-red" onClick={() => onPoint({ x: index, y: 1 })}>{pits[index] ?? 0}</button>)}</div></div><button type="button" className="reference-mancala-store is-red" onClick={() => onPoint({ x: 6, y: 1 })}><small>红方仓</small><strong>{stores[0] ?? 0}</strong></button></div>;
}

function ludoBoard(state: OnlinePositionState | null, onPoint: (point: OnlinePoint) => void): ReactElement {
  const value = state?.board && typeof state.board === "object" ? state.board as { tokens?: number[][]; roll?: number } : {};
  const tokens = value.tokens ?? [[-1, -1, -1, -1], [-1, -1, -1, -1]];
  const tokenLabel = (token: number): string => token < 0 ? "家" : token >= 57 ? "终" : String(token);
  return <div className="reference-board reference-ludo-board" data-reference-board="freeplayisok-inspired" role="grid" aria-label="飞行棋棋盘"><div className="reference-ludo-home is-red"><span>红方</span>{tokens[0].map((token, index) => <button type="button" key={index} onClick={() => onPoint({ x: index, y: 0 })}>{tokenLabel(token)}</button>)}</div><div className="reference-ludo-track">{Array.from({ length: 52 }, (_, index) => <button type="button" key={index} className={index % 13 === 0 ? "is-start" : ""} onClick={() => onPoint({ x: index % 13, y: 2 + Math.floor(index / 13) })}>{index + 1}</button>)}</div><div className="reference-ludo-home is-black"><span>黑方</span>{tokens[1].map((token, index) => <button type="button" key={index} onClick={() => onPoint({ x: index, y: 1 })}>{tokenLabel(token)}</button>)}</div><div className="reference-ludo-roll">骰子 {value.roll ?? 1}</div></div>;
}

function backgammonBoard(state: OnlinePositionState | null, onPoint: (point: OnlinePoint) => void): ReactElement {
  const value = state?.board && typeof state.board === "object" ? state.board as { points?: number[]; borneOff?: number[]; roll?: number } : {};
  const points = value.points ?? [];
  const borneOff = value.borneOff ?? [0, 0];
  return <div className="reference-board reference-backgammon-board" data-reference-board="freeplayisok-inspired" role="grid" aria-label="双陆棋棋盘"><div className="reference-backgammon-points">{Array.from({ length: 24 }, (_, index) => { const point = { x: index % 12, y: index < 12 ? 0 : 1 }; const count = points[index] ?? 0; return <button type="button" key={index} className={`reference-backgammon-point ${index % 2 === 0 ? "is-light" : "is-dark"}`} onClick={() => onPoint(point)}><i className="reference-backgammon-triangle" /><span>{Math.abs(count)}</span></button>; })}</div><div className="reference-backgammon-footer"><span>红方收棋 <strong>{borneOff[0] ?? 0}</strong></span><span>骰子 <strong>{value.roll ?? 1}</strong></span><span>黑方收棋 <strong>{borneOff[1] ?? 0}</strong></span></div></div>;
}

function starBoard(
  state: OnlinePositionState | null,
  selected: OnlinePoint | null,
  targets: OnlineMoveCandidate[],
  lastMove: GameMove | null,
  onPoint: (point: OnlinePoint) => void,
): ReactElement {
  const board = boardString(state);
  const coordinates = getOnlineGameDefinition("chinese-checkers").engine.board.coordinates ?? [];
  const targetKeys = targetSet(targets);
  const last = movePoint(lastMove, "chinese-checkers");
  return <div className="reference-board reference-star-board" data-reference-board="freeplayisok-inspired" role="grid" aria-label="中国跳棋星形棋盘"><div className="reference-star-shape" aria-hidden="true"><i className="is-top" /><i className="is-right-top" /><i className="is-right-bottom" /><i className="is-bottom" /><i className="is-left-bottom" /><i className="is-left-top" /></div><div className="reference-star-points">{coordinates.map((point) => { const value = valueAt(board, point, 13); const key = pointKey(point); const target = targetKeys.has(key); const selectedHere = samePoint(selected, point); const lastHere = samePoint(last, point); return <button key={key} type="button" className={`reference-star-point is-${pieceTone("chinese-checkers", value)} ${target ? "is-target" : ""} ${selectedHere ? "is-selected" : ""} ${lastHere ? "is-last" : ""}`} style={{ left: percent(point.x, 12), top: percent(point.y, 12) }} role="gridcell" aria-label={`${point.y + 1}行${point.x + 1}列${isEmpty(value) ? "空位" : "棋子"}`} onClick={() => onPoint(point)}>{!isEmpty(value) && <span className="reference-marble" aria-hidden="true" />}{target && isEmpty(value) && <span className="reference-target" aria-hidden="true" />}</button>; })}</div></div>;
}

export function ReferenceBoard(props: ReferenceBoardProps): ReactElement {
  const { gameId, state, selected, targets, lastMove, onPoint, onCandidate } = props;
  if (gameId === "gomoku") return lineBoard(gameId, state, selected, targets, lastMove, onPoint, 15);
  if (gameId === "connect6") return lineBoard(gameId, state, selected, targets, lastMove, onPoint, 19);
  if (gameId === "go") return lineBoard(gameId, state, selected, targets, lastMove, onPoint, 9);
  if (gameId === "xiangqi") return xiangqiBoard(state, selected, targets, lastMove, onPoint);
  if (gameId === "shogi") return shogiBoard(state, selected, targets, lastMove, onPoint);
  if (gameId === "animal-chess") return animalBoard(state, selected, targets, lastMove, onPoint);
  if (gameId === "chinese-checkers") return starBoard(state, selected, targets, lastMove, onPoint);
  if (gameId === "dots-and-boxes") return dotsBoard(state, selected, targets, onCandidate);
  if (gameId === "mancala") return mancalaBoard(state, onPoint);
  if (gameId === "ludo") return ludoBoard(state, onPoint);
  if (gameId === "backgammon") return backgammonBoard(state, onPoint);
  if (gameId === "reversi") return squareGridBoard(gameId, state, selected, targets, lastMove, onPoint, 8, 8);
  if (gameId === "checkers") return squareGridBoard(gameId, state, selected, targets, lastMove, onPoint, 8, 8);
  if (gameId === "chess") return squareGridBoard(gameId, state, selected, targets, lastMove, onPoint, 8, 8);
  return squareGridBoard(gameId, state, selected, targets, lastMove, onPoint, 3, 3);
}
