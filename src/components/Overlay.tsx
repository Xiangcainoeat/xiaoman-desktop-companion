import { useRef } from "react";
import { Fish, PanelTopOpen } from "lucide-react";
import { PetSprite } from "./PetSprite";
import { bridge, useCompanion } from "../useCompanion";

export function Overlay() {
  const snapshot = useCompanion();
  const dragRef = useRef({ active: false, moved: false, x: 0, y: 0 });
  const clickTimerRef = useRef<number | null>(null);

  if (!snapshot) return <div className="overlay-root" />;

  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    dragRef.current = { active: true, moved: false, x: event.screenX, y: event.screenY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const deltaX = event.screenX - dragRef.current.x;
    const deltaY = event.screenY - dragRef.current.y;
    if (Math.hypot(deltaX, deltaY) >= 2) {
      dragRef.current.moved = true;
      bridge.moveOverlayBy(deltaX, deltaY);
      dragRef.current.x = event.screenX;
      dragRef.current.y = event.screenY;
    }
  };

  const pointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
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
      className="overlay-root"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onClick={petClick}
      onDoubleClick={openCenter}
      onContextMenu={(event) => {
        event.preventDefault();
        bridge.showOverlayMenu();
      }}
    >
      <div className={`pet-bubble source-${snapshot.stateSource}`} aria-live="polite">
        {snapshot.stateMessage}
      </div>
      <PetSprite state={snapshot.state} settings={snapshot.settings} size={240} className="overlay-pet" />
      <div className="overlay-actions">
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
