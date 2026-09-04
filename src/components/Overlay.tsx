import { useCallback, useEffect, useRef, useState } from "react";
import { Code2, Gamepad2, Heart, Moon, PanelTopOpen, Power, Sun } from "lucide-react";
import {
  chooseIdleMotion,
  hoverJumpDurationMs,
  isPrimaryDragPointer,
  releaseDragState,
  resetDragState,
  randomizedDelayMs,
  resolveDragMotion,
} from "../shared/motion";
import type { DragState } from "../shared/motion";
import type { OverlayPanelMode, PetMotion } from "../shared/types";
import { OverlayCodexPanel } from "./OverlayCodexPanel";
import { DesktopBubbleLayer } from "./DesktopBubbleLayer";
import { PetSprite } from "./PetSprite";
import { QuickActionsView } from "./QuickActionsView";
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
  const dragRef = useRef<DragState>({
    active: false,
    moved: false,
    x: 0,
    y: 0,
    horizontal: 0,
    pointerId: null,
  });
  const hitboxRef = useRef<HTMLDivElement | null>(null);
  const clickSuppressionRef = useRef(false);
  const clickTimerRef = useRef<number | null>(null);
  const motionTimerRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const [dragMotion, setDragMotion] = useState<PetMotion | null>(null);
  const [hoverMotion, setHoverMotion] = useState<PetMotion | null>(null);
  const [idleMotion, setIdleMotion] = useState<PetMotion | null>(null);
  const [idlePhrase, setIdlePhrase] = useState<string | null>(null);
  const [gazeActive, setGazeActive] = useState(false);
  const [panelMode, setPanelMode] = useState<OverlayPanelMode | null>(null);
  const bubbleInteractiveRef = useRef(false);
  const tasksOpen = panelMode === "codex";
  const hasAuxiliaryPanel = panelMode !== null;

  const clearMotionTimer = useCallback(() => {
    if (motionTimerRef.current !== null) window.clearTimeout(motionTimerRef.current);
    motionTimerRef.current = null;
  }, []);

  const clearHoverMotion = useCallback(() => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHoverMotion(null);
  }, []);

  const resetPointerInteraction = useCallback((preserveClickSuppression = false) => {
    const pointerId = dragRef.current.pointerId;
    dragRef.current = resetDragState(dragRef.current);
    if (!preserveClickSuppression) clickSuppressionRef.current = false;
    if (!preserveClickSuppression) {
      clearMotionTimer();
      setDragMotion(null);
    }
    clearHoverMotion();
    setIdleMotion(null);

    const hitbox = hitboxRef.current;
    if (pointerId !== null && hitbox?.hasPointerCapture(pointerId)) {
      hitbox.releasePointerCapture(pointerId);
    }
  }, [clearHoverMotion, clearMotionTimer]);

  const handleGazeActivity = useCallback((active: boolean) => setGazeActive(active), []);
  const handleBubbleInteractiveChange = useCallback((active: boolean) => {
    bubbleInteractiveRef.current = active;
    if (active || hasAuxiliaryPanel) bridge.setOverlayMouseMode("interactive");
    else bridge.setOverlayMouseMode("passthrough");
  }, [hasAuxiliaryPanel]);
  const enterInteractiveArea = useCallback(() => bridge.setOverlayMouseMode("interactive"), []);
  const leaveInteractiveArea = useCallback(() => {
    if (!bubbleInteractiveRef.current && !hasAuxiliaryPanel) bridge.setOverlayMouseMode("passthrough");
  }, [hasAuxiliaryPanel]);
  const notifySleeping = useCallback(() => {
    void bridge.interact("pet").catch(() => undefined);
  }, []);
  const setPanel = useCallback((mode: OverlayPanelMode | null) => {
    if (mode !== null && snapshot?.sleeping) {
      notifySleeping();
      return;
    }
    setPanelMode(mode);
    bridge.setOverlayPanel(mode);
    bridge.setOverlayMouseMode(mode !== null || bubbleInteractiveRef.current ? "interactive" : "passthrough");
  }, [notifySleeping, snapshot?.sleeping]);
  const setTaskPanel = useCallback((open: boolean) => {
    setPanel(open ? "codex" : null);
  }, [setPanel]);
  const closePanel = useCallback(() => setPanel(null), [setPanel]);
  const openQuickPanel = useCallback((mode: Extract<OverlayPanelMode, "care" | "interaction">) => {
    setPanel(mode);
  }, [setPanel]);

  useEffect(() => () => {
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
    clearMotionTimer();
    clearHoverMotion();
    dragRef.current = resetDragState(dragRef.current);
    clickSuppressionRef.current = false;
    bridge.setOverlayPanel(null);
  }, [clearHoverMotion, clearMotionTimer]);

  useEffect(() => {
    const resetOnWindowBlur = () => resetPointerInteraction();
    const resetOnVisibilityLoss = () => {
      if (document.visibilityState !== "visible") resetPointerInteraction();
    };

    window.addEventListener("blur", resetOnWindowBlur);
    document.addEventListener("visibilitychange", resetOnVisibilityLoss);
    return () => {
      window.removeEventListener("blur", resetOnWindowBlur);
      document.removeEventListener("visibilitychange", resetOnVisibilityLoss);
    };
  }, [resetPointerInteraction]);

  useEffect(() => {
    if (panelMode === "codex" && snapshot && !snapshot.settings.codexSessionControls) {
      setPanelMode(null);
      bridge.setOverlayPanel(null);
    }
  }, [panelMode, snapshot?.settings.codexSessionControls]);

  useEffect(() => bridge.onOverlayPanel((mode) => setPanelMode(mode)), []);

  useEffect(() => {
    if (!snapshot?.sleeping || !hasAuxiliaryPanel) return;
    setPanelMode(null);
    bridge.setOverlayMouseMode("passthrough");
  }, [hasAuxiliaryPanel, snapshot?.sleeping]);

  useEffect(() => {
    if (
      !snapshot
      || !snapshot.settings.overlayVisible
      || !snapshot.settings.hoverJumpEnabled
      || !MOTION_ALLOWED_STATES.has(snapshot.state)
    ) {
      clearHoverMotion();
    }
  }, [clearHoverMotion, snapshot?.settings.hoverJumpEnabled, snapshot?.settings.overlayVisible, snapshot?.state]);

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

  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const buttonTarget = event.target instanceof Element && event.target.closest("button");
    if (buttonTarget || !isPrimaryDragPointer(event)) {
      resetPointerInteraction();
      return;
    }
    if (snapshot.sleeping) {
      resetPointerInteraction();
      notifySleeping();
      return;
    }
    resetPointerInteraction();
    clearMotionTimer();
    dragRef.current = {
      active: true,
      moved: false,
      x: event.screenX,
      y: event.screenY,
      horizontal: 0,
      pointerId: event.pointerId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || dragRef.current.pointerId !== event.pointerId) return;
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

  const pointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.active && dragRef.current.pointerId === event.pointerId) {
      clickSuppressionRef.current = dragRef.current.moved;
      dragRef.current = releaseDragState(dragRef.current);
      clearMotionTimer();
      motionTimerRef.current = window.setTimeout(() => setDragMotion(null), 160);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const pointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    resetPointerInteraction();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const pointerEnter = () => {
    enterInteractiveArea();
    if (snapshot.sleeping) return;
    if (!snapshot.settings.hoverJumpEnabled || !canUseTransientMotion || dragRef.current.active) return;
    clearHoverMotion();
    setHoverMotion("jumping");
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      setHoverMotion(null);
    }, hoverJumpDurationMs(snapshot.settings.hoverJumpCount));
  };

  const pointerLeave = () => {
    clearHoverMotion();
  };

  const petClick = () => {
    if (snapshot.sleeping) {
      notifySleeping();
      return;
    }
    if (clickSuppressionRef.current || dragRef.current.moved) {
      clickSuppressionRef.current = false;
      dragRef.current.moved = false;
      return;
    }
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = window.setTimeout(() => void bridge.interact("pet").catch(() => undefined), 210);
  };

  const openCenter = () => {
    if (snapshot.sleeping) {
      notifySleeping();
      return;
    }
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = null;
    bridge.showCenter();
  };

  const lostPointerCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.active && dragRef.current.pointerId !== event.pointerId) return;
    // Preserve only the normal release tail; the drag state itself is always reset.
    resetPointerInteraction(!dragRef.current.active && clickSuppressionRef.current);
  };

  const handleOverlayPointerDownCapture = (event: React.PointerEvent<HTMLElement>) => {
    if (!hasAuxiliaryPanel) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".overlay-codex-panel, .overlay-quick-panel, .overlay-pet-hitbox, .overlay-actions, .pet-bubble, .overlay-need-meter")) return;
    closePanel();
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    resetPointerInteraction();
    bridge.showOverlayMenu();
  };

  return (
    <main
      className={`overlay-root ${hasAuxiliaryPanel ? "has-auxiliary-panel has-task-panel" : ""} ${panelMode ? `panel-${panelMode}` : ""}`}
      onPointerDownCapture={handleOverlayPointerDownCapture}
      onContextMenu={handleContextMenu}
    >
      {panelMode === "codex" && (
        <OverlayCodexPanel
          onClose={closePanel}
          replyTransport={snapshot.settings.codexReplyTransport}
        />
      )}
      {(panelMode === "care" || panelMode === "interaction") && (
        <QuickActionsView mode={panelMode} embedded onClose={closePanel} />
      )}
      <DesktopBubbleLayer snapshot={snapshot} onInteractiveChange={handleBubbleInteractiveChange} />
      <div className={`pet-bubble source-${snapshot.stateSource}`} aria-live="polite">
        {idlePhrase ?? snapshot.stateMessage}
      </div>
      <div
        ref={hitboxRef}
        className="overlay-pet-hitbox"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerCancel}
        onLostPointerCapture={lostPointerCapture}
        onPointerEnter={pointerEnter}
        onPointerLeave={() => {
          pointerLeave();
          leaveInteractiveArea();
        }}
        onClick={petClick}
        onDoubleClick={openCenter}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (snapshot.sleeping) notifySleeping();
            else void bridge.interact("pet").catch(() => undefined);
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
          gazeSuppressed={hasAuxiliaryPanel}
          onGazeActivityChange={handleGazeActivity}
          className="overlay-pet"
        />
      </div>
      <div className="overlay-actions" onPointerEnter={enterInteractiveArea} onPointerLeave={leaveInteractiveArea}>
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
          className={`icon-button overlay-action ${snapshot.sleeping ? "is-active" : ""}`}
          type="button"
          title={snapshot.sleeping ? "叫醒小满" : "让小满睡觉"}
          aria-label={snapshot.sleeping ? "叫醒小满" : "让小满睡觉"}
          aria-pressed={snapshot.sleeping}
          onClick={(event) => {
            event.stopPropagation();
            void bridge.interact(snapshot.sleeping ? "wake" : "sleep").catch(() => undefined);
          }}
        >
          {snapshot.sleeping ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button
          className="icon-button overlay-action"
          type="button"
          title="打开养成"
          aria-label="打开养成"
          onClick={(event) => {
            event.stopPropagation();
            if (snapshot.sleeping) notifySleeping();
            else openQuickPanel("care");
          }}
        >
          <Heart size={18} />
        </button>
        <button
          className="icon-button overlay-action"
          type="button"
          title="打开互动"
          aria-label="打开互动"
          onClick={(event) => {
            event.stopPropagation();
            if (snapshot.sleeping) notifySleeping();
            else openQuickPanel("interaction");
          }}
        >
          <Gamepad2 size={18} />
        </button>
        <button
          className="icon-button overlay-action"
          type="button"
          title="打开控制中心"
          aria-label="打开控制中心"
          onClick={(event) => {
            event.stopPropagation();
            if (snapshot.sleeping) notifySleeping();
            else bridge.showCenter();
          }}
        >
          <PanelTopOpen size={18} />
        </button>
        <button
          className="icon-button overlay-action danger"
          type="button"
          title="退出小满桌面伴侣"
          aria-label="退出小满桌面伴侣"
          onClick={(event) => {
            event.stopPropagation();
            bridge.quitApp();
          }}
        >
          <Power size={18} />
        </button>
      </div>
      <div className="overlay-need-meter" title={`饱食度 ${Math.round(snapshot.stats.fullness)}`}>
        <span style={{ width: `${snapshot.stats.fullness}%` }} />
      </div>
    </main>
  );
}
