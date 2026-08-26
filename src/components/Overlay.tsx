import { useCallback, useEffect, useRef, useState } from "react";
import { Code2, Fish, PanelTopOpen } from "lucide-react";
import { chooseIdleMotion, randomizedDelayMs, resolveDragMotion } from "../shared/motion";
import type { PetMotion } from "../shared/types";
import { OverlayCodexPanel } from "./OverlayCodexPanel";
import { PetSprite } from "./PetSprite";
import { bridge, useCompanion } from "../useCompanion";

const MOTION_ALLOWED_STATES = new Set(["idle", "working", "happy", "sleepy"]);

type IdleActionMotion = Extract<PetMotion, "idle-lick" | "idle-blink" | "idle-scratch">;

const IDLE_ACTION_LOOPS: Record<IdleActionMotion, number> = {
  "idle-lick": 1,
  "idle-blink": 1,
  "idle-scratch": 1,
};

const IDLE_ACTION_FPS: Record<IdleActionMotion, number> = {
  "idle-lick": 5.6,
  "idle-blink": 6.8,
  "idle-scratch": 5.1,
};

const IDLE_ACTION_FRAME_COUNT = 30;

function idleActionDurationMs(motion: IdleActionMotion): number {
  const fps = IDLE_ACTION_FPS[motion];
  return (IDLE_ACTION_FRAME_COUNT / fps) * IDLE_ACTION_LOOPS[motion] * 1000;
}

export function Overlay() {
  const snapshot = useCompanion();
  const idlePhraseKey = snapshot?.idlePhrases.join("\u0000") ?? "";
  const dragRef = useRef({ active: false, moved: false, x: 0, y: 0, horizontal: 0 });
  const clickTimerRef = useRef<number | null>(null);
  const motionTimerRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const [dragMotion, setDragMotion] = useState<PetMotion | null>(null);
  const [hoverMotion, setHoverMotion] = useState<PetMotion | null>(null);
  const [idleMotion, setIdleMotion] = useState<PetMotion | null>(null);
  const [idlePhrase, setIdlePhrase] = useState<string | null>(null);
  const [gazeActive, setGazeActive] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);

  const handleGazeActivity = useCallback((active: boolean) => setGazeActive(active), []);
  const setTaskPanel = useCallback((open: boolean) => {
    setTasksOpen(open);
    bridge.setOverlayTaskPanel(open);
  }, []);
  const closeTaskPanel = useCallback(() => setTaskPanel(false), [setTaskPanel]);

  useEffect(() => () => {
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
    if (motionTimerRef.current) window.clearTimeout(motionTimerRef.current);
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    bridge.setOverlayTaskPanel(false);
  }, []);

  useEffect(() => {
    if (tasksOpen && snapshot && !snapshot.settings.codexSessionControls) {
      setTasksOpen(false);
      bridge.setOverlayTaskPanel(false);
    }
  }, [snapshot?.settings.codexSessionControls, tasksOpen]);

  useEffect(() => {
    if (
      !snapshot
      || snapshot.settings.petProfile !== "enhanced"
      || !snapshot.settings.overlayVisible
      || !snapshot.settings.idleActionsEnabled
    ) {
      setIdleMotion(null);
      return;
    }
    let active = true;
    let actionTimeout = 0;
    let finishTimeout = 0;
    const schedule = () => {
      actionTimeout = window.setTimeout(() => {
        if (!active) return;
        const canAnimate =
          snapshot.state === "idle" &&
          snapshot.settings.petProfile === "enhanced" &&
          snapshot.settings.overlayVisible &&
          !dragRef.current.active &&
          !dragMotion &&
          !hoverMotion &&
          !gazeActive;
        const motion = canAnimate ? chooseIdleMotion(snapshot.settings) : null;
        if (!motion || !motion.startsWith("idle-")) {
          schedule();
          return;
        }
        setIdleMotion(motion);
        finishTimeout = window.setTimeout(() => {
          if (!active) return;
          setIdleMotion(null);
          schedule();
        }, idleActionDurationMs(motion as IdleActionMotion));
      }, randomizedDelayMs(snapshot.settings.idleActionIntervalSec));
    };
    schedule();
    return () => {
      active = false;
      window.clearTimeout(actionTimeout);
      window.clearTimeout(finishTimeout);
      setIdleMotion(null);
    };
  }, [
    dragMotion,
    gazeActive,
    hoverMotion,
    snapshot?.settings.idleActionIntervalSec,
    snapshot?.settings.idleActionsEnabled,
    snapshot?.settings.petProfile,
    snapshot?.settings.idleBlinkEnabled,
    snapshot?.settings.idleLickEnabled,
    snapshot?.settings.overlayVisible,
    snapshot?.settings.idleScratchEnabled,
    snapshot?.state,
  ]);

  useEffect(() => {
    if (
      !snapshot
      || !snapshot.settings.overlayVisible
      || !snapshot.settings.idleSpeechEnabled
      || snapshot.idlePhrases.length === 0
    ) {
      setIdlePhrase(null);
      return;
    }
    let active = true;
    let speechTimeout = 0;
    let hideTimeout = 0;
    const schedule = () => {
      speechTimeout = window.setTimeout(() => {
        if (!active) return;
        if (
          snapshot.state !== "idle"
          || !snapshot.settings.overlayVisible
          || dragRef.current.active
          || dragMotion
          || hoverMotion
          || gazeActive
        ) {
          schedule();
          return;
        }
        const phrase = snapshot.idlePhrases[Math.floor(Math.random() * snapshot.idlePhrases.length)];
        setIdlePhrase(phrase);
        hideTimeout = window.setTimeout(() => {
          if (!active) return;
          setIdlePhrase(null);
          schedule();
        }, 4800);
      }, randomizedDelayMs(snapshot.settings.idleSpeechIntervalSec));
    };
    schedule();
    return () => {
      active = false;
      window.clearTimeout(speechTimeout);
      window.clearTimeout(hideTimeout);
      setIdlePhrase(null);
    };
  }, [
    dragMotion,
    gazeActive,
    hoverMotion,
    idlePhraseKey,
    snapshot?.settings.overlayVisible,
    snapshot?.settings.idleSpeechEnabled,
    snapshot?.settings.idleSpeechIntervalSec,
    snapshot?.state,
  ]);

  if (!snapshot) return <div className="overlay-root" />;

  const canUseTransientMotion = MOTION_ALLOWED_STATES.has(snapshot.state);
  const motion = canUseTransientMotion ? dragMotion ?? hoverMotion ?? idleMotion : null;

  const clearMotionTimer = () => {
    if (motionTimerRef.current) window.clearTimeout(motionTimerRef.current);
    motionTimerRef.current = null;
  };

  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    clearMotionTimer();
    setHoverMotion(null);
    setIdleMotion(null);
    dragRef.current = { active: true, moved: false, x: event.screenX, y: event.screenY, horizontal: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const deltaX = event.screenX - dragRef.current.x;
    const deltaY = event.screenY - dragRef.current.y;
    dragRef.current.horizontal += deltaX;
    if (Math.hypot(deltaX, deltaY) >= 1) {
      dragRef.current.moved = true;
      if (snapshot.settings.dragRunEnabled && canUseTransientMotion) {
        const initialMotion = resolveDragMotion(dragRef.current.horizontal);
        if (initialMotion) {
          setDragMotion(Math.abs(deltaX) >= 0.5 ? (deltaX > 0 ? "running-right" : "running-left") : initialMotion);
        }
      }
      bridge.moveOverlayBy(deltaX, deltaY);
      dragRef.current.x = event.screenX;
      dragRef.current.y = event.screenY;
    }
  };

  const stopDragging = (clearMoved: boolean) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    dragRef.current.horizontal = 0;
    if (clearMoved) dragRef.current.moved = false;
    clearMotionTimer();
    motionTimerRef.current = window.setTimeout(() => setDragMotion(null), 160);
  };

  const pointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    stopDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const pointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    stopDragging(true);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const pointerEnter = () => {
    if (!snapshot.settings.hoverJumpEnabled || !canUseTransientMotion || dragRef.current.active) return;
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    setHoverMotion("jumping");
    hoverTimerRef.current = window.setTimeout(() => setHoverMotion(null), 900);
  };

  const pointerLeave = () => {
    if (dragRef.current.active) return;
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHoverMotion(null);
  };

  const petClick = () => {
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = window.setTimeout(() => void bridge.interact("pet"), 210);
  };

  const openCenter = () => {
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = null;
    bridge.showCenter();
  };

  return (
    <main
      className={`overlay-root ${tasksOpen ? "has-task-panel" : ""}`}
      onContextMenu={(event) => {
        event.preventDefault();
        bridge.showOverlayMenu();
      }}
    >
      {tasksOpen && (
        <OverlayCodexPanel
          onClose={closeTaskPanel}
          replyTransport={snapshot.settings.codexReplyTransport}
        />
      )}
      <div className={`pet-bubble source-${snapshot.stateSource}`} aria-live="polite">
        {idlePhrase ?? snapshot.stateMessage}
      </div>
      <div
        className="overlay-pet-hitbox"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerCancel}
        onLostPointerCapture={() => stopDragging(true)}
        onPointerEnter={pointerEnter}
        onPointerLeave={pointerLeave}
        onClick={petClick}
        onDoubleClick={openCenter}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void bridge.interact("pet");
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="摸摸小满，双击打开控制中心"
      >
        <PetSprite
          state={snapshot.state}
          settings={snapshot.settings}
          size={snapshot.settings.petSize}
          motion={motion}
          gazeSuppressed={tasksOpen}
          onGazeActivityChange={handleGazeActivity}
          className="overlay-pet"
        />
      </div>
      <div className="overlay-actions">
        {snapshot.settings.codexSessionControls && (
          <button
            className={`icon-button overlay-action ${tasksOpen ? "is-active" : ""}`}
            type="button"
            title={tasksOpen ? "关闭 Codex 任务" : "快捷回复 Codex 任务"}
            aria-label={tasksOpen ? "关闭 Codex 任务" : "快捷回复 Codex 任务"}
            aria-pressed={tasksOpen}
            onClick={(event) => {
              event.stopPropagation();
              setTaskPanel(!tasksOpen);
            }}
          >
            <Code2 size={18} />
          </button>
        )}
        <button
          className="icon-button overlay-action"
          type="button"
          title="喂鱼干"
          aria-label="喂鱼干"
          onClick={(event) => {
            event.stopPropagation();
            void bridge.interact("feed");
          }}
        >
          <Fish size={18} />
        </button>
        <button
          className="icon-button overlay-action"
          type="button"
          title="打开控制中心"
          aria-label="打开控制中心"
          onClick={(event) => {
            event.stopPropagation();
            bridge.showCenter();
          }}
        >
          <PanelTopOpen size={18} />
        </button>
      </div>
      <div className="overlay-need-meter" title={`饱食度 ${Math.round(snapshot.stats.fullness)}`}>
        <span style={{ width: `${snapshot.stats.fullness}%` }} />
      </div>
    </main>
  );
}
