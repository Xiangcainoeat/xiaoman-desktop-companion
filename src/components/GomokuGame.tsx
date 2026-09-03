import {
  CircleAlert,
  CircleDot,
  ChevronDown,
  Eye,
  Lightbulb,
  Pause,
  Play,
  RotateCcw,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { playPetSound } from "../audio";
import { bridge } from "../useCompanion";
import {
  applyGomokuMove,
  chooseGomokuMove,
  createGomokuBoard,
  findGomokuWinner,
  GOMOKU_SIZE,
  isGomokuBoardFull,
  playerLabel,
  type GomokuBoard,
  type GomokuDifficulty,
  type GomokuPlayer,
  type GomokuPoint,
  type GomokuWinner,
} from "../gomoku/logic";

type GomokuMode = "ai" | "local";
type GameSnapshot = {
  board: GomokuBoard;
  turn: GomokuPlayer;
  moves: number;
  lastMove: GomokuPoint | null;
};

const DIFFICULTIES: Array<{ value: GomokuDifficulty; label: string; hint: string }> = [
  { value: "easy", label: "简单", hint: "适合熟悉规则" },
  { value: "medium", label: "普通", hint: "会取胜也会防守" },
  { value: "hard", label: "困难", hint: "更重视连续棋形" },
  { value: "master", label: "大师", hint: "有限深度搜索" },
];

const BOARD_LABELS = Array.from({ length: GOMOKU_SIZE }, (_, index) => index + 1);

export interface GomokuGameProps {
  enabled: boolean;
  active?: boolean;
  sessionReady?: boolean;
  muted?: boolean;
  onToggleMute?: () => void;
  paused?: boolean;
  onTogglePause?: () => void;
  onClose: () => void;
  onLayoutSettled?: () => void;
  onOpenOnline?: () => void;
}

function pointKey(point: GomokuPoint | null): string {
  return point ? `${point.row}:${point.col}` : "";
}

function playGameSound(sound: "pop" | "chime" | "purr", muted: boolean): void {
  if (muted) return;
  void bridge.getSnapshot().then((snapshot) => {
    if (snapshot.settings.soundEnabled) playPetSound(sound, snapshot.settings.volume);
  }).catch(() => undefined);
}

export function GomokuGame({
  enabled,
  active = true,
  sessionReady = true,
  muted = true,
  onToggleMute = () => undefined,
  paused = false,
  onTogglePause = () => undefined,
  onClose,
  onLayoutSettled,
  onOpenOnline,
}: GomokuGameProps) {
  const [mode, setMode] = useState<GomokuMode>("ai");
  const [difficulty, setDifficulty] = useState<GomokuDifficulty>("medium");
  const [humanPlayer, setHumanPlayer] = useState<GomokuPlayer>(1);
  const [board, setBoard] = useState<GomokuBoard>(() => createGomokuBoard());
  const [turn, setTurn] = useState<GomokuPlayer>(1);
  const [moves, setMoves] = useState(0);
  const [lastMove, setLastMove] = useState<GomokuPoint | null>(null);
  const [winner, setWinner] = useState<GomokuWinner | null>(null);
  const [draw, setDraw] = useState(false);
  const [past, setPast] = useState<GameSnapshot[]>([]);
  const [hint, setHint] = useState<GomokuPoint | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const [notice, setNotice] = useState("");
  const completedRef = useRef(false);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const winningKeys = useMemo(() => new Set(winner?.line.map(pointKey) ?? []), [winner]);
  const isFinished = Boolean(winner || draw);
  // The reward/session bridge is auxiliary. A local board must remain
  // playable when that service is unavailable.
  const gameInteractive = enabled && active && !paused && !isFinished && !aiThinking;
  const aiPlayer: GomokuPlayer = humanPlayer === 1 ? 2 : 1;
  const isAiTurn = mode === "ai" && turn === aiPlayer;

  const resetGame = () => {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    aiTimerRef.current = null;
    hintTimerRef.current = null;
    setBoard(createGomokuBoard());
    setTurn(1);
    setMoves(0);
    setLastMove(null);
    setWinner(null);
    setDraw(false);
    setPast([]);
    setHint(null);
    setNotice("");
    setAiThinking(false);
    completedRef.current = false;
    onLayoutSettled?.();
  };

  const changeMode = (nextMode: GomokuMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    resetGame();
  };

  const changePlayer = (nextPlayer: GomokuPlayer) => {
    if (nextPlayer === humanPlayer) return;
    setHumanPlayer(nextPlayer);
    resetGame();
  };

  const finishIfNeeded = (nextBoard: GomokuBoard, point: GomokuPoint, player: GomokuPlayer) => {
    const nextWinner = findGomokuWinner(nextBoard);
    if (nextWinner) {
      setWinner(nextWinner);
      setNotice(`${playerLabel(nextWinner.player)}获胜`);
      playGameSound("chime", muted);
      if (!completedRef.current) {
        completedRef.current = true;
        const score = nextWinner.player === humanPlayer ? 100 : 40;
        void bridge.completeGame("gomoku", score).catch(() => undefined);
      }
      return true;
    }
    if (isGomokuBoardFull(nextBoard)) {
      setDraw(true);
      setNotice("棋盘已满，和棋");
      playGameSound("chime", muted);
      if (!completedRef.current) {
        completedRef.current = true;
        void bridge.completeGame("gomoku", 60).catch(() => undefined);
      }
      return true;
    }
    return false;
  };

  const placeStone = (point: GomokuPoint, player: GomokuPlayer) => {
    const nextBoard = applyGomokuMove(board, point, player);
    if (!nextBoard) return false;
    setPast((current) => [...current, { board, turn, moves, lastMove }]);
    setBoard(nextBoard);
    setLastMove(point);
    setHint(null);
    setMoves((current) => current + 1);
    playGameSound("pop", muted);
    if (finishIfNeeded(nextBoard, point, player)) return true;
    setTurn(player === 1 ? 2 : 1);
    return true;
  };

  useEffect(() => {
    if (!active || !enabled || paused || mode !== "ai" || turn !== aiPlayer || isFinished) return undefined;
    setAiThinking(true);
    aiTimerRef.current = setTimeout(() => {
      const point = chooseGomokuMove(board, aiPlayer, difficulty);
      if (point) placeStone(point, aiPlayer);
      setAiThinking(false);
      aiTimerRef.current = null;
    }, difficulty === "master" ? 280 : 180);
    return () => {
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
      aiTimerRef.current = null;
      setAiThinking(false);
    };
    // The board and turn are intentionally captured for one AI decision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, enabled, paused, mode, turn, aiPlayer, isFinished, board, difficulty]);

  useEffect(() => () => {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
  }, []);

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))) return;
      if (event.key.toLowerCase() === "p" || event.key === "Escape") {
        event.preventDefault();
        if (!isFinished) onTogglePause();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        resetGame();
      } else if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        requestHint();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
    // These handlers intentionally use the current game controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, isFinished, onTogglePause, mode, humanPlayer, board, turn, difficulty]);

  const requestHint = () => {
    if (!gameInteractive || isAiTurn) return;
    const point = chooseGomokuMove(board, turn, difficulty === "easy" ? "medium" : difficulty);
    if (!point) return;
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    setHint(point);
    setNotice(`建议落在 ${point.row + 1} 行 ${point.col + 1} 列`);
    hintTimerRef.current = setTimeout(() => {
      setHint(null);
      hintTimerRef.current = null;
    }, 2_400);
  };

  const undo = () => {
    if (past.length === 0 || aiThinking) return;
    const steps = mode === "ai" ? Math.min(2, past.length) : 1;
    const target = past[past.length - steps];
    setBoard(target.board);
    setTurn(target.turn);
    setMoves(target.moves);
    setLastMove(target.lastMove);
    setWinner(null);
    setDraw(false);
    setNotice("");
    setHint(null);
    setPast((current) => current.slice(0, -steps));
    completedRef.current = false;
  };

  const statusText = paused
    ? "游戏已暂停"
    : aiThinking
      ? "小满思考中"
      : winner
        ? `${playerLabel(winner.player)}获胜`
        : draw
          ? "和棋"
          : mode === "ai" && turn === humanPlayer
            ? "轮到你落子"
            : `轮到${playerLabel(turn)}`;

  return (
    <section className="gomoku-game" aria-label="五子棋游戏" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <header className="gomoku-game-toolbar">
        <div className="gomoku-game-title">
          <span className="gomoku-game-title-icon"><CircleDot size={19} /></span>
          <span><strong>五子棋</strong><small>本机棋盘 · {mode === "ai" ? "人机对战" : "本机双人"}</small></span>
        </div>
        <div className="gomoku-game-actions">
          <span className={`gomoku-status-pill ${isFinished ? "is-finished" : ""}`}><span />{statusText}</span>
          <button className="icon-button compact" type="button" title={paused ? "继续游戏" : "暂停游戏"} aria-label={paused ? "继续游戏" : "暂停游戏"} onClick={onTogglePause}>
            {paused ? <Play size={15} /> : <Pause size={15} />}
          </button>
          <button className="icon-button compact" type="button" title={muted ? "打开游戏声音" : "静音游戏"} aria-label={muted ? "打开游戏声音" : "静音游戏"} onClick={onToggleMute}>
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <button className="icon-button compact" type="button" title="重新开始" aria-label="重新开始" onClick={resetGame}><RotateCcw size={15} /></button>
          <button className="icon-button compact" type="button" title="关闭五子棋" aria-label="关闭五子棋" onClick={onClose}><X size={16} /></button>
        </div>
      </header>

      <div className="gomoku-game-content">
        <div className="gomoku-board-panel">
          <div className="gomoku-board-frame">
            <div className="gomoku-axis gomoku-axis-top" aria-hidden="true">{BOARD_LABELS.map((label) => <span key={label}>{label}</span>)}</div>
            <div className="gomoku-board-row">
              <div className="gomoku-axis gomoku-axis-side" aria-hidden="true">{BOARD_LABELS.map((label) => <span key={label}>{label}</span>)}</div>
              <div className="gomoku-board" role="grid" aria-label="五子棋棋盘">
                {board.map((row, rowIndex) => row.map((cell, colIndex) => {
                  const point = { row: rowIndex, col: colIndex };
                  const key = pointKey(point);
                  const isStar = [3, 7, 11].includes(rowIndex) && [3, 7, 11].includes(colIndex);
                  const isHint = pointKey(hint) === key;
                  const isLast = pointKey(lastMove) === key;
                  return (
                    <button
                      className={`gomoku-cell ${cell === 1 ? "is-black" : cell === 2 ? "is-white" : "is-empty"} ${isStar ? "is-star" : ""} ${isLast ? "is-last" : ""} ${winningKeys.has(key) ? "is-winning" : ""} ${isHint ? "is-hint" : ""}`}
                      key={key}
                      type="button"
                      role="gridcell"
                      aria-label={`${rowIndex + 1} 行 ${colIndex + 1} 列${cell === 0 ? "，空位" : `，${playerLabel(cell)}`}`}
                      disabled={!gameInteractive || cell !== 0}
                      onClick={() => placeStone(point, mode === "ai" ? humanPlayer : turn)}
                    >
                      {isStar && cell === 0 && <span className="gomoku-star-mark" aria-hidden="true" />}
                      {cell !== 0 && <span className="gomoku-stone-mark" aria-hidden="true" />}
                      {isHint && cell === 0 && <span className="gomoku-hint-mark" aria-hidden="true" />}
                    </button>
                  );
                }))}
              </div>
            </div>
          </div>
          <div className="gomoku-board-footer">
            <span><span className="gomoku-stone-key is-black" />黑方先手</span>
            <span>{moves} 手</span>
            <span>{notice || "连成五子即可获胜"}</span>
          </div>
          {(paused || isFinished) && (
            <div className="gomoku-board-overlay" role="status">
              {paused ? <Pause size={23} /> : <Trophy size={23} />}
              <strong>{paused ? "游戏已暂停" : statusText}</strong>
              <button className="secondary-button compact" type="button" onClick={paused ? onTogglePause : resetGame}>{paused ? "继续" : "再来一局"}</button>
            </div>
          )}
        </div>

        <aside className="gomoku-side-panel" aria-label="五子棋设置">
          <div className="gomoku-mode-tabs" role="tablist" aria-label="对战模式">
            <button type="button" role="tab" aria-selected={mode === "ai"} className={mode === "ai" ? "is-active" : ""} onClick={() => changeMode("ai")}>人机对战</button>
            <button type="button" role="tab" aria-selected={mode === "local"} className={mode === "local" ? "is-active" : ""} onClick={() => changeMode("local")}>本机双人</button>
          </div>

          {mode === "ai" && (
            <div className="gomoku-setting-group">
              <label className="gomoku-field"><span>难度</span><select value={difficulty} onChange={(event) => { setDifficulty(event.target.value as GomokuDifficulty); resetGame(); }}>{DIFFICULTIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <p className="gomoku-field-hint">{DIFFICULTIES.find((item) => item.value === difficulty)?.hint}</p>
              <div className="gomoku-color-choice" role="group" aria-label="选择执棋方">
                <span>我执</span>
                <button className={humanPlayer === 1 ? "is-selected" : ""} type="button" onClick={() => changePlayer(1)}><i className="gomoku-stone-key is-black" />黑方</button>
                <button className={humanPlayer === 2 ? "is-selected" : ""} type="button" onClick={() => changePlayer(2)}><i className="gomoku-stone-key is-white" />白方</button>
              </div>
            </div>
          )}

          <div className="gomoku-score-strip">
            <div><span>回合</span><strong>{moves}</strong></div>
            <div><span>状态</span><strong>{isFinished ? "结束" : paused ? "暂停" : "进行中"}</strong></div>
          </div>

          <div className="gomoku-side-actions">
            <button className="secondary-button" type="button" disabled={!gameInteractive || isAiTurn} onClick={requestHint}><Lightbulb size={15} />提示</button>
            <button className="secondary-button" type="button" disabled={past.length === 0 || aiThinking} onClick={undo}><RotateCcw size={15} />悔棋</button>
            {onOpenOnline && <button className="text-button gomoku-online-link" type="button" onClick={onOpenOnline}><Eye size={15} />联机房间</button>}
          </div>

          <button className="gomoku-rules-toggle" type="button" aria-expanded={showRules} onClick={() => setShowRules((value) => !value)}><span><CircleAlert size={15} />玩法与快捷键</span><ChevronDown size={15} className={showRules ? "is-open" : ""} /></button>
          {showRules && <div className="gomoku-rules" role="note"><p>双方轮流落子，横、竖或斜线连续五枚棋子即可获胜。棋盘满后无人连成五子则和棋。</p><dl><div><dt>暂停</dt><dd>P / Esc</dd></div><div><dt>重开</dt><dd>R</dd></div><div><dt>提示</dt><dd>H</dd></div></dl></div>}

          {!sessionReady && <p className="gomoku-session-note"><CircleAlert size={14} />奖励服务暂时不可用，棋局仍可正常进行。</p>}
        </aside>
      </div>
    </section>
  );
}
