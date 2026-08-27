import { CircleDot } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  advanceDesktopBubble,
  createDesktopBubble,
  DESKTOP_SESSION_DURATION_MS,
  type DesktopBubbleBounds,
} from "../shared/desktop-interaction";
import type { AppSnapshot, DesktopBubble } from "../shared/types";
import { bridge } from "../useCompanion";

export type DesktopBubblePhase = "entering" | "active" | "hitting" | "exiting";

export interface DesktopBubbleEntry {
  bubble: DesktopBubble;
  phase: DesktopBubblePhase;
}

export function advanceDesktopBubbles(
  bubbles: readonly DesktopBubble[],
  elapsedMs: number,
  bounds: DesktopBubbleBounds,
): DesktopBubble[] {
  return bubbles.flatMap((bubble) => {
    const next = advanceDesktopBubble(bubble, elapsedMs, bounds);
    return next ? [next] : [];
  });
}

export function desktopBubblePhaseClass(phase: DesktopBubblePhase): string {
  return `desktop-bubble is-${phase}`;
}

const SPAWN_INTERVAL_MS = 760;
const MAX_VISIBLE_BUBBLES = 4;
const PHASE_HOLD_MS = 110;
const FRAME_DELTA_LIMIT_MS = 100;

function measureBounds(element: HTMLDivElement): DesktopBubbleBounds {
  const rect = element.getBoundingClientRect();
  return {
    width: Math.max(0, Math.floor(rect.width || element.clientWidth)),
    height: Math.max(0, Math.floor(rect.height || element.clientHeight)),
  };
}

function bubbleTransform(bubble: DesktopBubble): string {
  return `translate3d(${Math.round(bubble.x - bubble.radius)}px, ${Math.round(bubble.y - bubble.radius)}px, 0)`;
}

export function DesktopBubbleLayer({
  snapshot,
  onInteractiveChange,
}: {
  snapshot: Pick<AppSnapshot, "settings" | "desktopInteraction">;
  onInteractiveChange?: (active: boolean) => void;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const bubbleRefs = useRef(new Map<string, HTMLButtonElement>());
  const entriesRef = useRef<DesktopBubbleEntry[]>([]);
  const hitIdsRef = useRef(new Set<string>());
  const sequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const statusRef = useRef(snapshot.desktopInteraction);
  const callbackRef = useRef(onInteractiveChange);
  const interactiveRef = useRef<boolean | null>(null);
  const phaseTimersRef = useRef(new Set<number>());
  const pendingStopRef = useRef<{ timer: number; sessionId: string } | null>(null);
  const [entries, setEntries] = useState<DesktopBubbleEntry[]>([]);

  statusRef.current = snapshot.desktopInteraction;
  callbackRef.current = onInteractiveChange;

  const notifyInteractive = useCallback((active: boolean) => {
    if (interactiveRef.current === active) return;
    interactiveRef.current = active;
    callbackRef.current?.(active);
  }, []);

  const publishEntries = useCallback((next: DesktopBubbleEntry[]) => {
    if (!mountedRef.current) return;
    entriesRef.current = next;
    setEntries(next);
    notifyInteractive(next.some((entry) => entry.phase === "active"));
  }, [notifyInteractive]);

  const removeBubble = useCallback((bubbleId: string) => {
    bubbleRefs.current.delete(bubbleId);
    publishEntries(entriesRef.current.filter((entry) => entry.bubble.id !== bubbleId));
  }, [publishEntries]);

  const attachBubbleRef = useCallback((node: HTMLButtonElement | null) => {
    if (!node) return;
    const bubbleId = node.dataset.bubbleId;
    if (!bubbleId) return;
    bubbleRefs.current.set(bubbleId, node);
    const entry = entriesRef.current.find((candidate) => candidate.bubble.id === bubbleId);
    if (entry) node.style.transform = bubbleTransform(entry.bubble);
  }, []);

  const holdThenRemove = useCallback((bubbleId: string) => {
    if (!mountedRef.current) return;
    const timer = window.setTimeout(() => {
      phaseTimersRef.current.delete(timer);
      removeBubble(bubbleId);
    }, PHASE_HOLD_MS);
    phaseTimersRef.current.add(timer);
  }, [removeBubble]);

  const handleBubbleClick = useCallback((event: React.MouseEvent<HTMLButtonElement>, bubbleId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const entry = entriesRef.current.find((candidate) => candidate.bubble.id === bubbleId);
    const sessionId = statusRef.current.sessionId;
    if (!entry || entry.phase !== "active" || !statusRef.current.active || !sessionId || hitIdsRef.current.has(bubbleId)) return;

    hitIdsRef.current.add(bubbleId);
    publishEntries(entriesRef.current.map((candidate) => candidate.bubble.id === bubbleId
      ? { ...candidate, phase: "hitting" }
      : candidate));
    void bridge.hitDesktopBubble(sessionId, bubbleId)
      .catch(() => undefined)
      .finally(() => holdThenRemove(bubbleId));
  }, [holdThenRemove, publishEntries]);

  useEffect(() => {
    mountedRef.current = true;
    const enabled = snapshot.settings.gameModeEnabled;
    const sessionId = enabled && snapshot.desktopInteraction.active ? snapshot.desktopInteraction.sessionId : null;
    const startedAt = enabled && snapshot.desktopInteraction.active ? snapshot.desktopInteraction.startedAt : null;
    const timers = phaseTimersRef.current;
    let animationFrame = 0;
    let disposed = false;
    let stopRequested = false;
    let lastTime = performance.now();
    let spawnElapsed = SPAWN_INTERVAL_MS;

    if (sessionId && pendingStopRef.current?.sessionId === sessionId) {
      window.clearTimeout(pendingStopRef.current.timer);
      pendingStopRef.current = null;
    }

    const clearTimers = () => {
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
    };

    const clearVisuals = () => {
      clearTimers();
      hitIdsRef.current.clear();
      entriesRef.current = [];
      bubbleRefs.current.clear();
      setEntries([]);
      notifyInteractive(false);
    };

    const stopSession = () => {
      if (!sessionId || stopRequested) return;
      stopRequested = true;
      void bridge.stopDesktopBubbleSession(sessionId, false).catch(() => undefined);
    };

    const schedulePhase = (bubbleId: string, phase: DesktopBubblePhase) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (disposed) return;
        if (phase === "exiting") {
          removeBubble(bubbleId);
          return;
        }
        publishEntries(entriesRef.current.map((entry) => entry.bubble.id === bubbleId && entry.phase === phase
          ? { ...entry, phase: "active" }
          : entry));
      }, PHASE_HOLD_MS);
      timers.add(timer);
    };

    const markExiting = (bubbleIds: readonly string[]) => {
      if (bubbleIds.length === 0) return;
      const ids = new Set(bubbleIds);
      publishEntries(entriesRef.current.map((entry) => ids.has(entry.bubble.id)
        ? { ...entry, phase: "exiting" }
        : entry));
      for (const bubbleId of bubbleIds) schedulePhase(bubbleId, "exiting");
    };

    const spawnBubble = (now: number) => {
      const element = layerRef.current;
      if (!element || entriesRef.current.length >= MAX_VISIBLE_BUBBLES) return;
      const bounds = measureBounds(element);
      try {
        const bubble = createDesktopBubble(
          `${sessionId ?? "desktop"}-bubble-${sequenceRef.current++}`,
          bounds,
          Math.random,
          now,
        );
        publishEntries([...entriesRef.current, { bubble, phase: "entering" }]);
        schedulePhase(bubble.id, "entering");
      } catch {
        // A transparent window can be between resize states; wait for the next frame.
      }
    };

    const frame = (time: number) => {
      if (disposed) return;
      const deltaMs = Math.min(FRAME_DELTA_LIMIT_MS, Math.max(0, time - lastTime));
      lastTime = time;
      const currentTime = Date.now();

      if (!sessionId || startedAt === null || !enabled || currentTime >= startedAt + DESKTOP_SESSION_DURATION_MS) {
        stopSession();
        markExiting(entriesRef.current.map((entry) => entry.bubble.id));
        if (entriesRef.current.length === 0) notifyInteractive(false);
        return;
      }

      const element = layerRef.current;
      const bounds = element ? measureBounds(element) : { width: 0, height: 0 };
      const expiredIds: string[] = [];
      const nextEntries = entriesRef.current.map((entry) => {
        if (entry.phase === "hitting" || entry.phase === "exiting") return entry;
        const next = advanceDesktopBubble(entry.bubble, deltaMs, bounds);
        if (!next) {
          expiredIds.push(entry.bubble.id);
          return { ...entry, phase: "exiting" as const };
        }
        const node = bubbleRefs.current.get(entry.bubble.id);
        if (node) node.style.transform = bubbleTransform(next);
        return { ...entry, bubble: next };
      });
      entriesRef.current = nextEntries;
      if (expiredIds.length > 0) {
        publishEntries(nextEntries);
        for (const bubbleId of expiredIds) schedulePhase(bubbleId, "exiting");
      }

      spawnElapsed += deltaMs;
      if (spawnElapsed >= SPAWN_INTERVAL_MS) {
        spawnElapsed = 0;
        spawnBubble(currentTime);
      }
      animationFrame = requestAnimationFrame(frame);
    };

    clearVisuals();
    if (sessionId && startedAt !== null && enabled) {
      spawnBubble(Date.now());
      animationFrame = requestAnimationFrame(frame);
    }

    return () => {
      disposed = true;
      mountedRef.current = false;
      cancelAnimationFrame(animationFrame);
      clearTimers();
      const latest = statusRef.current;
      if (sessionId && latest.active && latest.sessionId === sessionId && !stopRequested) {
        const timer = window.setTimeout(() => {
          if (pendingStopRef.current?.timer === timer) pendingStopRef.current = null;
          const current = statusRef.current;
          if (current.active && current.sessionId === sessionId) {
            void bridge.stopDesktopBubbleSession(sessionId, false).catch(() => undefined);
          }
        }, 0);
        pendingStopRef.current = { timer, sessionId };
      }
      entriesRef.current = [];
      bubbleRefs.current.clear();
      setEntries([]);
      notifyInteractive(false);
    };
  }, [notifyInteractive, publishEntries, removeBubble, snapshot.desktopInteraction.active, snapshot.desktopInteraction.sessionId, snapshot.desktopInteraction.startedAt, snapshot.settings.gameModeEnabled]);

  return (
    <div ref={layerRef} className="desktop-bubble-layer" aria-label="桌面泡泡互动">
      {entries.map((entry) => (
        <button
          key={entry.bubble.id}
          ref={attachBubbleRef}
          data-bubble-id={entry.bubble.id}
          className={desktopBubblePhaseClass(entry.phase)}
          type="button"
          disabled={entry.phase !== "active"}
          style={{
            width: entry.bubble.radius * 2,
            height: entry.bubble.radius * 2,
          }}
          aria-label={`戳破泡泡，已得 ${statusRef.current.score} 分`}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => handleBubbleClick(event, entry.bubble.id)}
        >
          <CircleDot size={Math.max(18, Math.round(entry.bubble.radius * 0.72))} aria-hidden="true" />
          <span>+1</span>
        </button>
      ))}
    </div>
  );
}
