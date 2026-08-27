import { AlertCircle, CheckCircle2, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBridge } from "../bridge";
import type { XiaomanApi } from "../electron";
import type { GameId } from "../shared/types";

export type GameBridge = Pick<XiaomanApi, "setGameActive" | "completeGame">;

export type GamePhase = "starting" | "playing" | "finishing" | "finished" | "cancelled" | "error" | "disabled";

export interface GameLifecycle {
  start(): void;
  finish(score: number): Promise<boolean>;
  cancel(): void;
  dispose(): void;
}

export interface GameSession {
  readonly locked: boolean;
  readonly phase: GamePhase;
  finish(score: number): void;
  cancel(): void;
}

export interface GameShellProps {
  gameId: GameId;
  title: string;
  description: string;
  enabled?: boolean;
  gameBridge?: GameBridge;
  onClose?: () => void;
  onCompleted?: (score: number) => void;
  onCancelled?: () => void;
  children: (session: GameSession) => React.ReactNode;
}

/** Keep score normalization at the renderer boundary as a second line of defense. */
export function normalizeGameScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Own the temporary game flag and settlement idempotency in one small state
 * machine. The renderer can call finish from both a timer and a final click
 * without ever submitting a second reward.
 */
export function createGameLifecycle(gameId: GameId, api: GameBridge): GameLifecycle {
  let started = false;
  let released = false;
  let submitted = false;

  const release = () => {
    if (released) return;
    released = true;
    if (started) api.setGameActive(false);
  };

  return {
    start() {
      if (started || released) return;
      started = true;
      api.setGameActive(true);
    },
    async finish(score: number) {
      if (!started || released || submitted) return false;
      submitted = true;
      try {
        await api.completeGame(gameId, normalizeGameScore(score));
        return true;
      } finally {
        release();
      }
    },
    cancel() {
      release();
    },
    dispose() {
      release();
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "本局没有提交成功，请稍后再试";
}

function stopEvent(event: React.SyntheticEvent) {
  event.stopPropagation();
}

export function GameShell({
  gameId,
  title,
  description,
  enabled = true,
  gameBridge,
  onClose,
  onCompleted,
  onCancelled,
  children,
}: GameShellProps) {
  const resolvedBridge = useMemo(() => gameBridge ?? getBridge(), [gameBridge]);
  const [phase, setPhase] = useState<GamePhase>(enabled ? "starting" : "disabled");
  const [notice, setNotice] = useState("");
  const phaseRef = useRef<GamePhase>(phase);
  const lifecycleRef = useRef<GameLifecycle | null>(null);
  const finishStartedRef = useRef(false);

  const setShellPhase = useCallback((next: GamePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  useEffect(() => {
    const lifecycle = createGameLifecycle(gameId, resolvedBridge);
    lifecycleRef.current = lifecycle;
    finishStartedRef.current = false;

    if (!enabled) {
      setShellPhase("disabled");
    } else {
      lifecycle.start();
      setShellPhase("playing");
    }

    return () => {
      lifecycle.dispose();
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
    };
  }, [enabled, gameId, resolvedBridge, setShellPhase]);

  const finishGame = useCallback((score: number) => {
    if (!enabled || phaseRef.current !== "playing" || finishStartedRef.current) return;
    const lifecycle = lifecycleRef.current;
    if (!lifecycle) return;

    finishStartedRef.current = true;
    setShellPhase("finishing");
    setNotice("正在提交本局结果…");
    void lifecycle.finish(score).then((submitted) => {
      if (!submitted) {
        setShellPhase("cancelled");
        setNotice("本局已结束，没有发放奖励");
        return;
      }
      const safeScore = normalizeGameScore(score);
      setShellPhase("finished");
      setNotice(`本局得分 ${safeScore}，奖励已记入小满状态`);
      onCompleted?.(safeScore);
    }).catch((error: unknown) => {
      setShellPhase("error");
      setNotice(errorMessage(error));
    });
  }, [enabled, onCompleted, setShellPhase]);

  const cancelGame = useCallback(() => {
    if (phaseRef.current === "finishing" || phaseRef.current === "finished" || phaseRef.current === "error") return;
    finishStartedRef.current = true;
    lifecycleRef.current?.cancel();
    setShellPhase("cancelled");
    setNotice("本局已取消，不会发放奖励");
    onCancelled?.();
  }, [onCancelled, setShellPhase]);

  const closeGame = useCallback(() => {
    if (phaseRef.current === "finishing") return;
    if (phaseRef.current === "starting" || phaseRef.current === "playing") cancelGame();
    onClose?.();
  }, [cancelGame, onClose]);

  const session = useMemo<GameSession>(() => ({
    get locked() {
      return phaseRef.current !== "playing";
    },
    get phase() {
      return phaseRef.current;
    },
    finish: (score: number) => finishGame(score),
    cancel: () => cancelGame(),
  }), [cancelGame, finishGame]);

  const isRunning = phase === "playing" || phase === "finishing";

  return (
    <section
      className={`game-shell game-phase-${phase}`}
      aria-labelledby={`game-title-${gameId}`}
      onPointerDown={stopEvent}
      onMouseDown={stopEvent}
      onClick={stopEvent}
      onContextMenu={stopEvent}
    >
      <header className="game-shell-header">
        <img className="game-shell-avatar" src="./pet/avatar.png" alt="" aria-hidden="true" />
        <div>
          <span className="eyebrow">互动游戏</span>
          <h2 id={`game-title-${gameId}`}>{title}</h2>
          <p>{description}</p>
        </div>
        <button
          className="icon-button"
          type="button"
          title="退出游戏"
          aria-label="退出游戏"
          disabled={phase === "finishing"}
          onClick={closeGame}
        >
          <X size={18} />
        </button>
      </header>

      {phase === "disabled" && (
        <div className="game-shell-message" role="status">
          <AlertCircle size={20} aria-hidden="true" />
          <strong>游戏模式已关闭</strong>
          <span>请在桌宠功能中重新打开小游戏。</span>
        </div>
      )}

      {phase === "starting" && (
        <div className="game-shell-message" role="status">
          <LoaderCircle className="is-spinning" size={20} aria-hidden="true" />
          <strong>正在准备游戏</strong>
        </div>
      )}

      {isRunning && (
        <div className="game-shell-body">
          {children(session)}
          {phase === "finishing" && <div className="game-shell-busy" role="status">正在保存结果…</div>}
        </div>
      )}

      {phase === "finished" && (
        <div className="game-shell-message is-success" role="status">
          <CheckCircle2 size={21} aria-hidden="true" />
          <strong>本局完成</strong>
          <span>可以返回游戏列表继续玩。</span>
        </div>
      )}

      {phase === "cancelled" && (
        <div className="game-shell-message" role="status">
          <AlertCircle size={20} aria-hidden="true" />
          <strong>本局已取消</strong>
          <span>这次不会产生游戏奖励。</span>
        </div>
      )}

      {phase === "error" && (
        <div className="game-shell-message is-error" role="alert">
          <AlertCircle size={20} aria-hidden="true" />
          <strong>结果提交失败</strong>
          <span>{notice}</span>
        </div>
      )}

      <div className="game-shell-footer">
        <span className="game-shell-notice" aria-live="polite" aria-atomic="true">{notice}</span>
        {phase !== "finishing" && (phase === "finished" || phase === "cancelled" || phase === "error") && (
          <button className="secondary-button" type="button" onClick={closeGame}>返回游戏列表</button>
        )}
      </div>
    </section>
  );
}
