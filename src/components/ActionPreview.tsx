import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { CompanionSettings } from "../shared/types";
import { PetSprite, type PetSpriteMotion, type PetSpriteState } from "./PetSprite";

export type ActionPreviewActionId =
  | "idle"
  | "idle-lick"
  | "idle-blink"
  | "idle-scratch"
  | "running-left"
  | "running-right"
  | "jumping"
  | "care-bath"
  | "care-feed"
  | "sleeping";

export interface ActionPreviewAction {
  id: ActionPreviewActionId;
  label: string;
}

export interface ActionPreviewPlayback {
  selectedAction: ActionPreviewActionId;
  playingAction: ActionPreviewActionId | null;
  cycle: number;
}

const DEFAULT_ACTIONS: ActionPreviewAction[] = [
  { id: "idle", label: "待机" },
  { id: "idle-lick", label: "舔嘴" },
  { id: "idle-blink", label: "眨眼" },
  { id: "idle-scratch", label: "举前爪" },
  { id: "running-left", label: "向左跑" },
  { id: "running-right", label: "向右跑" },
  { id: "jumping", label: "悬停跳跃" },
  { id: "care-bath", label: "洗澡" },
  { id: "care-feed", label: "喂食" },
  { id: "sleeping", label: "睡觉" },
];

const ACTION_DURATION_MS: Record<ActionPreviewActionId, number> = {
  idle: 1_000 / 2.2,
  "idle-lick": 30 / 5.6 * 1_000,
  "idle-blink": 30 / 6.8 * 1_000,
  "idle-scratch": 30 / 5.1 * 1_000,
  "running-left": 8 / 7.4 * 1_000,
  "running-right": 8 / 7.4 * 1_000,
  jumping: 5 / 6.2 * 1_000,
  "care-bath": 30 / 5.2 * 1_000,
  "care-feed": 30 / 5.2 * 1_000,
  sleeping: 30 / 5.2 * 1_000,
};

function spriteForAction(action: ActionPreviewActionId): {
  state: PetSpriteState;
  motion: PetSpriteMotion | null;
} {
  if (action === "sleeping") return { state: "sleeping", motion: null };
  if (action === "care-bath") return { state: "bathing", motion: "care-bath" };
  if (action === "care-feed") return { state: "eating", motion: "care-feed" };
  if (action === "idle") return { state: "idle", motion: null };
  return { state: "idle", motion: action };
}

export function startActionPreview(
  playback: ActionPreviewPlayback,
  action: ActionPreviewActionId,
): ActionPreviewPlayback {
  return {
    selectedAction: action,
    playingAction: action,
    cycle: playback.cycle + 1,
  };
}

export function finishActionPreview(playback: ActionPreviewPlayback): ActionPreviewPlayback {
  return {
    selectedAction: "idle",
    playingAction: null,
    cycle: playback.cycle,
  };
}

export function previewSpriteForPlayback(playback: ActionPreviewPlayback): {
  state: PetSpriteState;
  motion: PetSpriteMotion | null;
} {
  return spriteForAction(playback.playingAction ?? playback.selectedAction);
}

export function ActionPreview({
  settings,
  actions = DEFAULT_ACTIONS,
  onClose,
}: {
  settings: CompanionSettings;
  actions?: readonly ActionPreviewAction[];
  onClose: () => void;
}) {
  const [playback, setPlayback] = useState<ActionPreviewPlayback>({
    selectedAction: "idle",
    playingAction: null,
    cycle: 0,
  });

  useEffect(() => {
    if (!playback.playingAction) return undefined;
    const { cycle, playingAction } = playback;
    const timer = window.setTimeout(() => {
      setPlayback((current) => current.cycle === cycle && current.playingAction === playingAction
        ? finishActionPreview(current)
        : current);
    }, ACTION_DURATION_MS[playingAction]);
    return () => window.clearTimeout(timer);
  }, [playback.cycle, playback.playingAction]);

  const sprite = useMemo(() => previewSpriteForPlayback(playback), [playback]);

  return (
    <section className="action-preview" aria-label="动作预览">
      <div className="action-preview-heading">
        <div>
          <span className="eyebrow">动作预览</span>
          <h3>看看小满会做什么</h3>
        </div>
        <button className="icon-button" type="button" aria-label="关闭动作预览" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="action-preview-stage">
        <PetSprite
          key={playback.cycle}
          state={sprite.state}
          settings={settings}
          size={180}
          motion={playback.playingAction ? sprite.motion : null}
          gazeSuppressed
        />
      </div>
      <div className="action-preview-actions" role="group" aria-label="选择动作">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={playback.selectedAction === action.id ? "is-selected" : ""}
            aria-pressed={playback.selectedAction === action.id}
            onClick={() => setPlayback((current) => startActionPreview(current, action.id))}
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}
