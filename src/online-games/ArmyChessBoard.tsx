import { createContext, useContext, useMemo, type CSSProperties, type ReactElement } from "react";
import type { GameMove, GameSeat } from "../social/types";
import type { OnlineMoveCandidate, OnlinePoint, OnlinePositionState } from "./types";

const BOARD_WIDTH = 900;
const BOARD_HEIGHT = 1280;
const COLUMNS = 5;
const ROWS = 12;
const X_COORDINATES = [90, 270, 450, 630, 810] as const;
const TOP_Y_COORDINATES = [90, 180, 270, 360, 450, 540] as const;
const BOTTOM_Y_COORDINATES = [740, 830, 920, 1010, 1100, 1190] as const;

const CAMP_KEYS = new Set([
  "2:1", "2:3", "3:2", "4:1", "4:3",
  "7:1", "7:3", "8:2", "9:1", "9:3",
]);

const HEADQUARTER_KEYS = new Set(["0:1", "0:3", "11:1", "11:3"]);

const PIECE_LABELS: Record<string, string> = {
  f: "军旗", F: "军旗",
  l: "地雷", L: "地雷",
  b: "炸弹", B: "炸弹",
  a: "司令", A: "司令",
  j: "军长", J: "军长",
  s: "师长", S: "师长",
  t: "旅长", T: "旅长",
  r: "团长", R: "团长",
  y: "营长", Y: "营长",
  c: "连长", C: "连长",
  p: "排长", P: "排长",
  g: "工兵", G: "工兵",
  m: "军", M: "军",
};

const LOWER_PIECES = [
  "f", "l", "l", "l", "b", "b", "a", "j", "s", "s", "t", "t", "r", "r", "y", "y", "c", "c", "p", "p", "g", "g", "g", "m", "m",
];

const UPPER_PIECES = LOWER_PIECES.map((piece) => piece.toUpperCase());

export type ArmyChessMode = "dark" | "flip";

/** The sidebar owns the variant switch; the board only consumes its visual mode. */
export const ArmyChessModeContext = createContext<ArmyChessMode>("dark");

function pointKey(point: OnlinePoint): string {
  return `${point.x}:${point.y}`;
}

function pointIndex(point: OnlinePoint): number {
  return point.y * COLUMNS + point.x;
}

function pointForIndex(index: number): OnlinePoint {
  return { x: index % COLUMNS, y: Math.floor(index / COLUMNS) };
}

function yCoordinate(row: number): number {
  return row < 6 ? TOP_Y_COORDINATES[row] : BOTTOM_Y_COORDINATES[row - 6];
}

function pointStyle(point: OnlinePoint): CSSProperties {
  return {
    left: `${(X_COORDINATES[point.x] / BOARD_WIDTH) * 100}%`,
    top: `${(yCoordinate(point.y) / BOARD_HEIGHT) * 100}%`,
  };
}

function isCamp(point: OnlinePoint): boolean {
  return CAMP_KEYS.has(`${point.y}:${point.x}`);
}

function isHeadquarters(point: OnlinePoint): boolean {
  return HEADQUARTER_KEYS.has(`${point.y}:${point.x}`);
}

/**
 * The reference game reserves the ten camp locations and places 25 covered
 * pieces on each side's remaining locations. This gives the board the same
 * visual density even before a player reveals a piece.
 */
function createReferenceInitialBoard(): string[] {
  const board = Array.from({ length: COLUMNS * ROWS }, () => "0");
  const playable = Array.from({ length: COLUMNS * ROWS }, (_, index) => pointForIndex(index))
    .filter((point) => !isCamp(point));
  playable.slice(0, 25).forEach((point, index) => { board[pointIndex(point)] = LOWER_PIECES[index]; });
  playable.slice(25).forEach((point, index) => { board[pointIndex(point)] = UPPER_PIECES[index]; });
  return board;
}

const REFERENCE_INITIAL_BOARD = createReferenceInitialBoard();

function normalizedBoard(state: OnlinePositionState | null): string[] {
  const value = typeof state?.board === "string" ? state.board : "";
  const board = value.length === COLUMNS * ROWS
    ? value.split("")
    : Array.from({ length: COLUMNS * ROWS }, () => "0");

  // Rooms created by older builds contain a sparse 14-piece demo position.
  // Keep those rooms playable while presenting the same covered-piece layout.
  const nonEmpty = board.filter((piece) => piece !== "0").length;
  if (nonEmpty === 14 && board[0] === "f" && board[59] === "F") {
    return REFERENCE_INITIAL_BOARD.slice();
  }
  return board;
}

function sideForPiece(piece: string): GameSeat | null {
  if (!piece || piece === "0") return null;
  if (piece === "1") return "red";
  if (piece === "2") return "black";
  return piece === piece.toUpperCase() ? "red" : "black";
}

function pieceLabel(piece: string): string {
  return PIECE_LABELS[piece] ?? (piece === "1" ? "棋子" : piece === "2" ? "棋子" : piece.toUpperCase());
}

function railLines(): ReactElement[] {
  const lines: ReactElement[] = [];
  TOP_Y_COORDINATES.forEach((y) => lines.push(<line key={`top-h-${y}`} x1="90" y1={y} x2="810" y2={y} />));
  BOTTOM_Y_COORDINATES.forEach((y) => lines.push(<line key={`bottom-h-${y}`} x1="90" y1={y} x2="810" y2={y} />));
  X_COORDINATES.forEach((x) => {
    lines.push(<line key={`top-v-${x}`} x1={x} y1="90" x2={x} y2="540" />);
    lines.push(<line key={`bottom-v-${x}`} x1={x} y1="740" x2={x} y2="1190" />);
  });

  const diagonals = [
    [90, 180, 450, 360], [450, 180, 90, 360], [450, 180, 810, 360], [810, 180, 450, 360],
    [90, 360, 450, 540], [450, 360, 90, 540], [450, 360, 810, 540], [810, 360, 450, 540],
    [90, 740, 450, 920], [450, 740, 90, 920], [450, 740, 810, 920], [810, 740, 450, 920],
    [90, 920, 450, 1100], [450, 920, 90, 1100], [450, 920, 810, 1100], [810, 920, 450, 1100],
  ];
  diagonals.forEach(([x1, y1, x2, y2], index) => lines.push(<line key={`diag-${index}`} x1={x1} y1={y1} x2={x2} y2={y2} />));
  return lines;
}

function ArmyBoardBackground(): ReactElement {
  return (
    <svg className="online-army-chess-rails" viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
      <rect className="online-army-chess-fill" x="0" y="0" width={BOARD_WIDTH} height={BOARD_HEIGHT} />
      <g className="online-army-chess-thin-rails">{railLines()}</g>
      <g className="online-army-chess-heavy-rails">
        <line x1="90" y1="180" x2="810" y2="180" />
        <line x1="90" y1="540" x2="810" y2="540" />
        <line x1="90" y1="740" x2="810" y2="740" />
        <line x1="90" y1="1100" x2="810" y2="1100" />
        <line x1="90" y1="90" x2="90" y2="540" />
        <line x1="810" y1="90" x2="810" y2="540" />
        <line x1="90" y1="740" x2="90" y2="1190" />
        <line x1="810" y1="740" x2="810" y2="1190" />
        <line x1="90" y1="540" x2="90" y2="740" />
        <line x1="450" y1="540" x2="450" y2="740" />
        <line x1="810" y1="540" x2="810" y2="740" />
      </g>
      <g className="online-army-chess-camps">
        {[...CAMP_KEYS].map((key) => {
          const [row, col] = key.split(":").map(Number);
          return <circle key={key} cx={X_COORDINATES[col]} cy={yCoordinate(row)} r="25" />;
        })}
      </g>
      <g className="online-army-chess-headquarters">
        {[...HEADQUARTER_KEYS].map((key) => {
          const [row, col] = key.split(":").map(Number);
          const x = X_COORDINATES[col];
          const y = yCoordinate(row);
          return <g key={key}><rect x={x - 19} y={y - 13} width="38" height="26" rx="4" /><line x1={x - 14} y1={y + 9} x2={x + 14} y2={y + 9} /></g>;
        })}
      </g>
      <g className="online-army-chess-empty-slots">
        {Array.from({ length: COLUMNS * ROWS }, (_, index) => {
          const point = pointForIndex(index);
          if (isCamp(point) || isHeadquarters(point)) return null;
          const x = X_COORDINATES[point.x];
          const y = yCoordinate(point.y);
          return <rect key={`slot-${index}`} x={x - 36} y={y - 20} width="72" height="40" rx="8" />;
        })}
      </g>
      <g className="online-army-chess-river-labels"><text x="369" y="640">前</text><text x="531" y="640">线</text></g>
    </svg>
  );
}

function ArmyMovePath({ move }: { move: GameMove | null | undefined }): ReactElement | null {
  if (!move || move.gameId !== "army-chess") return null;
  const fromX = X_COORDINATES[move.from.x];
  const fromY = yCoordinate(move.from.y);
  const toX = X_COORDINATES[move.to.x];
  const toY = yCoordinate(move.to.y);
  return (
    <svg className="online-army-chess-move-path" viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <marker id="online-army-arrowhead" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
          <path d="M0,0 L9,4.5 L0,9 Z" />
        </marker>
      </defs>
      <line x1={fromX} y1={fromY} x2={toX} y2={toY} markerEnd="url(#online-army-arrowhead)" />
    </svg>
  );
}

export interface ArmyChessBoardProps {
  state: OnlinePositionState | null;
  selected: OnlinePoint | null;
  targets: OnlineMoveCandidate[];
  lastMove?: GameMove | null;
  onPoint: (point: OnlinePoint) => void;
}

export function ArmyChessBoard({ state, selected, targets, lastMove, onPoint }: ArmyChessBoardProps): ReactElement {
  const board = useMemo(() => normalizedBoard(state), [state]);
  const mode = useContext(ArmyChessModeContext);
  const revealed = useMemo(() => new Set(
    Array.isArray(state?.revealed)
      ? state.revealed.filter((value): value is number => Number.isInteger(value) && value >= 0 && value < COLUMNS * ROWS)
      : [],
  ), [state]);
  const targetKeys = useMemo(() => new Set(targets.map((move) => pointKey(move.to))), [targets]);
  const lastKey = lastMove?.gameId === "army-chess" ? pointKey(lastMove.to) : "";

  return (
    <div className="online-army-chess-wrap" data-army-mode={mode}>
      <div className="online-army-chess-board" role="grid" aria-label="联机军棋棋盘">
        <ArmyBoardBackground />
        <ArmyMovePath move={lastMove} />
        <div className="online-army-chess-interaction-layer">
          {Array.from({ length: COLUMNS * ROWS }, (_, index) => {
            const point = pointForIndex(index);
            const key = pointKey(point);
            const piece = board[index] ?? "0";
            const side = sideForPiece(piece);
            // Reveals are part of the server-owned position. Both players render
            // the same covered pieces and every reveal consumes one room turn.
            const hidden = Boolean(side && !revealed.has(index));
            const selectedHere = Boolean(selected && pointKey(selected) === key);
            const targetHere = targetKeys.has(key);
            const lastHere = lastKey === key;
            return (
              <button
                key={key}
                className={`online-army-slot ${isCamp(point) ? "is-camp" : ""} ${isHeadquarters(point) ? "is-headquarters" : ""} ${piece !== "0" ? "is-occupied" : "is-empty"} ${hidden ? "is-hidden" : "is-revealed"} ${side === "red" ? "is-red" : side === "black" ? "is-blue" : ""} ${selectedHere ? "is-selected" : ""} ${targetHere ? "is-target" : ""} ${lastHere ? "is-last" : ""}`}
                style={pointStyle(point)}
                type="button"
                role="gridcell"
                aria-label={`${point.y + 1} 行 ${point.x + 1} 列${piece === "0" ? "空位" : hidden ? "未翻开的棋子" : pieceLabel(piece)}`}
                onClick={() => onPoint(point)}
              >
                {piece !== "0" && <span className="online-army-piece" aria-hidden="true">{hidden ? "?" : pieceLabel(piece)}</span>}
                {targetHere && <span className={`online-army-target-dot ${piece !== "0" ? "is-attack" : ""}`} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="online-army-chess-log" aria-label="走子记录">
        <span>走子记录</span>
        <strong>{state?.turn === "red" ? "红方回合" : "蓝方回合"}</strong>
        <small>{lastMove ? `第 ${lastMove.seq} 手 · ${state?.lastAction === "reveal" ? "翻开" : `${lastMove.from.x + 1},${lastMove.from.y + 1} →`} ${lastMove.to.x + 1},${lastMove.to.y + 1}` : "等待第一步"}</small>
      </div>
    </div>
  );
}
