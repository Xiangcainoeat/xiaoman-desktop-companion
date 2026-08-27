import { CircleDot, Fish, Hand, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AppSnapshot, GameId } from "../shared/types";
import { bridge } from "../useCompanion";
import { GameShell, type GameSession } from "./GameShell";
import { BubbleGame } from "./games/BubbleGame";
import { FishingGame } from "./games/FishingGame";
import { RockPaperScissors } from "./games/RockPaperScissors";

export interface GameDefinition {
  id: GameId;
  title: string;
  description: string;
  icon: ReactNode;
  render: (session: GameSession) => ReactNode;
}

export const GAME_DEFINITIONS: readonly GameDefinition[] = [
  {
    id: "rock-paper-scissors",
    title: "猜拳",
    description: "和小满来三局猜拳，看看今天谁更会读心。",
    icon: <Hand size={22} aria-hidden="true" />,
    render: (session) => <RockPaperScissors session={session} />,
  },
  {
    id: "fish-catch",
    title: "抓鱼干",
    description: "在二十秒内点击出现的鱼干，手快就能抓得更多。",
    icon: <Fish size={22} aria-hidden="true" />,
    render: (session) => <FishingGame session={session} />,
  },
  {
    id: "bubble-pop",
    title: "射泡泡",
    description: "二十秒内戳破泡泡，特殊泡泡会带来更高分数。",
    icon: <CircleDot size={22} aria-hidden="true" />,
    render: (session) => <BubbleGame session={session} />,
  },
];

export interface GamesViewProps {
  enabled?: boolean;
  gameModeEnabled?: boolean;
  snapshot?: Pick<AppSnapshot, "settings">;
  desktopInteractionActive?: boolean;
  onClose?: () => void;
}

function stopEvent(event: React.SyntheticEvent) {
  event.stopPropagation();
}

export function GamesView({ enabled, gameModeEnabled, snapshot, desktopInteractionActive = false, onClose }: GamesViewProps) {
  const gameEnabled = enabled ?? gameModeEnabled ?? snapshot?.settings.gameModeEnabled ?? true;
  const [selectedId, setSelectedId] = useState<GameId | null>(null);
  const [startingId, setStartingId] = useState<GameId | null>(null);
  const [startNotice, setStartNotice] = useState("");
  const startRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const selected = GAME_DEFINITIONS.find((definition) => definition.id === selectedId) ?? null;

  useEffect(() => {
    if (!gameEnabled) {
      startRequestRef.current += 1;
      setStartingId(null);
      setSelectedId(null);
    }
  }, [gameEnabled]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startRequestRef.current += 1;
    };
  }, []);

  const beginGame = async (gameId: GameId) => {
    if (!gameEnabled || desktopInteractionActive || startingId !== null) return;
    const requestId = ++startRequestRef.current;
    setStartingId(gameId);
    setStartNotice("");
    try {
      const result = await bridge.startGameSession();
      if (!mountedRef.current || requestId !== startRequestRef.current) {
        if (result.accepted) bridge.setGameActive(false);
        return;
      }
      if (!result.accepted) {
        setStartNotice(result.message ?? "当前无法开始这局游戏");
        return;
      }
      setSelectedId(gameId);
    } catch (error) {
      if (mountedRef.current && requestId === startRequestRef.current) {
        setStartNotice(error instanceof Error ? error.message : "当前无法开始这局游戏");
      }
    } finally {
      if (mountedRef.current && requestId === startRequestRef.current) setStartingId(null);
    }
  };

  return (
    <div className="view games-view" onPointerDown={stopEvent} onMouseDown={stopEvent} onClick={stopEvent} onContextMenu={stopEvent}>
      <header className="games-view-header">
        <div>
          <span className="eyebrow">轻松一下</span>
          <h2>和小满玩一会儿</h2>
          <p>游戏奖励只会在完成整局后结算，中途退出不会扣库存。</p>
        </div>
        {onClose && (
          <button className="icon-button" type="button" title="关闭游戏" aria-label="关闭游戏" onClick={onClose}>
            <X size={18} />
          </button>
        )}
      </header>

      {!gameEnabled && (
        <section className="games-disabled-message" role="status">
          <Sparkles size={22} aria-hidden="true" />
          <strong>游戏模式已关闭</strong>
          <span>到“桌宠功能”打开游戏模式后，这里就可以开始玩。</span>
        </section>
      )}

      {gameEnabled && desktopInteractionActive && !selected && (
        <section className="games-disabled-message games-blocked-message" role="status">
          <CircleDot size={22} aria-hidden="true" />
          <strong>桌面泡泡互动进行中</strong>
          <span>当前游戏结束后，才可以开始控制中心小游戏。</span>
        </section>
      )}

      {gameEnabled && !desktopInteractionActive && !selected && (
        <div className="game-definition-grid" role="list" aria-label="可玩的小游戏">
          {GAME_DEFINITIONS.map((definition) => (
            <article className="game-definition-card" key={definition.id} role="listitem">
              <div className="game-definition-icon">{definition.icon}</div>
              <div className="game-definition-copy">
                <h3>{definition.title}</h3>
                <p>{definition.description}</p>
              </div>
              <button
                className="primary-button"
                type="button"
                disabled={startingId !== null}
                aria-label={`开始${definition.title}`}
                onClick={() => void beginGame(definition.id)}
              >
                {startingId === definition.id ? "正在准备" : "开始游戏"}
              </button>
            </article>
          ))}
        </div>
      )}

      {gameEnabled && selected && (
        <GameShell
          key={selected.id}
          gameId={selected.id}
          title={selected.title}
          description={selected.description}
          enabled={gameEnabled}
          onClose={() => setSelectedId(null)}
        >
          {(session) => selected.render(session)}
        </GameShell>
      )}

      {startNotice && !selected && (
        <p className="games-start-notice" role="alert">{startNotice}</p>
      )}
    </div>
  );
}
