import { CircleAlert, Gamepad2, Home, Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AppSnapshot } from "../shared/types";
import {
  ARTICLE_GAME_DEFINITIONS,
  type ArticleGameDefinition,
  type ArticleGameId,
} from "../article-games/registry";
import {
  activeTabAfterClose,
  closeArticleGameTab,
  normalizeArticleGameTab,
  openArticleGameTab,
  type ArticleGameWorkspaceTab,
} from "../article-games/workspace";
import { ArticleGameView, GameIcon, type ArticleGameSessionState } from "./ArticleGameView";
import { bridge } from "../useCompanion";

function restoreGameWindowIfAvailable(): void {
  void bridge.restoreGameWindow().catch(() => undefined);
}

export interface GamesViewProps {
  enabled?: boolean;
  gameModeEnabled?: boolean;
  snapshot?: Pick<AppSnapshot, "settings">;
  desktopInteractionActive?: boolean;
  visible?: boolean;
  onClose?: () => void;
  onWorkspaceChange?: () => void;
}

function stopEvent(event: React.SyntheticEvent) {
  event.stopPropagation();
}

function articleGameBadge(definition: ArticleGameDefinition): string {
  return definition.requiresNetwork ? "在线" : "本机内置";
}

function definitionFor(id: ArticleGameId): ArticleGameDefinition {
  const definition = ARTICLE_GAME_DEFINITIONS.find((item) => item.id === id);
  if (!definition) throw new Error(`未知的文章游戏：${id}`);
  return definition;
}

export function GamesView({ enabled, gameModeEnabled, snapshot, desktopInteractionActive = false, visible = true, onClose, onWorkspaceChange }: GamesViewProps) {
  const gameEnabled = enabled ?? gameModeEnabled ?? snapshot?.settings.gameModeEnabled ?? true;
  const [workspace, setWorkspace] = useState<{
    openTabs: ArticleGameId[];
    activeTab: ArticleGameWorkspaceTab;
  }>({ openTabs: [], activeTab: "home" });
  const [sessionState, setSessionState] = useState<ArticleGameSessionState>("idle");
  const [sessionMessage, setSessionMessage] = useState("当前无法开始这局游戏");
  const [muted, setMuted] = useState(true);
  const [pausedGames, setPausedGames] = useState<Partial<Record<ArticleGameId, boolean>>>({});
  const gamesViewRef = useRef<HTMLDivElement>(null);
  const homeScrollRef = useRef<HTMLDivElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const sessionOwnedRef = useRef(false);
  const sessionRequestRef = useRef<symbol | null>(null);
  const needSessionRef = useRef({ enabled: gameEnabled, offlineCount: 0 });

  const offlineOpenCount = workspace.openTabs.filter((id) => definitionFor(id).availability === "offline").length;
  needSessionRef.current = { enabled: gameEnabled, offlineCount: offlineOpenCount };
  const showHome = workspace.activeTab === "home";
  const activeDefinition = showHome ? null : definitionFor(workspace.activeTab as ArticleGameId);
  const activeGameIsOffline = activeDefinition?.availability === "offline";

  useEffect(() => {
    if (!gameEnabled) {
      setWorkspace({ openTabs: [], activeTab: "home" });
    }
  }, [gameEnabled]);

  useEffect(() => {
    const shouldHaveSession = gameEnabled && offlineOpenCount > 0;
    if (!shouldHaveSession) {
      if (sessionOwnedRef.current) bridge.setGameActive(false);
      sessionOwnedRef.current = false;
      sessionRequestRef.current = null;
      setSessionState("idle");
      return;
    }
    if (sessionOwnedRef.current || sessionRequestRef.current) return;

    const requestToken = Symbol("article-game-session");
    sessionRequestRef.current = requestToken;
    setSessionState("starting");
    setSessionMessage("正在准备本机游戏");
    void bridge.startGameSession().then((result) => {
      if (sessionRequestRef.current !== requestToken) {
        if (result.accepted) bridge.setGameActive(false);
        return;
      }
      sessionRequestRef.current = null;
      const stillNeeded = needSessionRef.current.enabled && needSessionRef.current.offlineCount > 0;
      if (!stillNeeded) {
        if (result.accepted) bridge.setGameActive(false);
        setSessionState("idle");
        return;
      }
      if (!result.accepted) {
        setSessionState("error");
        setSessionMessage(result.message ?? "当前无法开始这局游戏");
        return;
      }
      sessionOwnedRef.current = true;
      setSessionState("ready");
      setSessionMessage("");
    }).catch((error) => {
      if (sessionRequestRef.current !== requestToken) return;
      sessionRequestRef.current = null;
      setSessionState("error");
      setSessionMessage(error instanceof Error ? error.message : "当前无法开始这局游戏");
    });
  }, [gameEnabled, offlineOpenCount]);

  useEffect(() => () => {
    if (sessionOwnedRef.current) bridge.setGameActive(false);
    sessionOwnedRef.current = false;
    sessionRequestRef.current = null;
    restoreGameWindowIfAvailable();
  }, []);

  useEffect(() => {
    if (!visible || showHome || !activeGameIsOffline) restoreGameWindowIfAvailable();
  }, [activeGameIsOffline, showHome, visible]);

  useLayoutEffect(() => {
    if (!visible) return;
    const reset = () => {
      if (gamesViewRef.current) gamesViewRef.current.scrollTop = 0;
      if (homeScrollRef.current) homeScrollRef.current.scrollTop = 0;
      onWorkspaceChange?.();
    };
    gamesViewRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    homeScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    reset();
    const firstFrame = window.requestAnimationFrame(reset);
    const secondFrame = window.requestAnimationFrame(() => window.requestAnimationFrame(reset));
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [onWorkspaceChange, visible, workspace.activeTab, workspace.openTabs.length]);

  useEffect(() => {
    const list = tabListRef.current;
    if (!list) return;
    const selected = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!selected) return;
    const left = selected.offsetLeft;
    const right = left + selected.offsetWidth;
    const visibleLeft = list.scrollLeft;
    const visibleRight = visibleLeft + list.clientWidth;
    const nextLeft = right > visibleRight
      ? right - list.clientWidth
      : left < visibleLeft
        ? left
        : visibleLeft;
    if (nextLeft !== list.scrollLeft) list.scrollTo({ left: nextLeft, behavior: "auto" });
  }, [workspace.activeTab, workspace.openTabs.length]);

  const selectHome = () => setWorkspace((current) => ({ ...current, activeTab: "home" }));
  const selectGame = (definition: ArticleGameDefinition) => {
    if (!gameEnabled || desktopInteractionActive) return;
    setWorkspace((current) => ({
      openTabs: openArticleGameTab(current.openTabs, definition.id),
      activeTab: definition.id,
    }));
  };
  const closeGame = (id: ArticleGameId) => {
    setPausedGames((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setWorkspace((current) => {
      const openTabs = closeArticleGameTab(current.openTabs, id);
      return {
        openTabs,
        activeTab: normalizeArticleGameTab(activeTabAfterClose(current.activeTab, current.openTabs, id), openTabs),
      };
    });
  };

  return (
    <div ref={gamesViewRef} className={`view games-view ${showHome ? "is-home" : "is-game-active"}`} aria-hidden={!visible} onPointerDown={stopEvent} onMouseDown={stopEvent} onClick={stopEvent} onContextMenu={stopEvent}>
      {gameEnabled && (
        <nav className="article-game-tabs" aria-label="游戏标签页" role="tablist">
          <button
            className={`article-game-tab ${showHome ? "is-active" : ""}`}
            type="button"
            role="tab"
            aria-selected={showHome}
            onClick={selectHome}
          >
            <Home size={15} aria-hidden="true" />
            主页
          </button>
          <div className="article-game-tab-list" ref={tabListRef}>
            {workspace.openTabs.map((id) => {
              const definition = definitionFor(id);
              const active = workspace.activeTab === id;
              return (
                <div className={`article-game-tab-item ${active ? "is-active" : ""}`} key={id}>
                  <button
                    className="article-game-tab article-game-tab-label"
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setWorkspace((current) => ({ ...current, activeTab: id }))}
                  >
                    <GameIcon name={definition.icon} size={15} />
                    <span>{definition.title}</span>
                  </button>
                  <button
                    className="icon-button compact article-game-tab-close"
                    type="button"
                    title={`关闭${definition.title}`}
                    aria-label={`关闭${definition.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeGame(id);
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
          {onClose && (
            <button className="icon-button compact article-game-workspace-close" type="button" title="关闭游戏" aria-label="关闭游戏" onClick={onClose}>
              <X size={16} />
            </button>
          )}
        </nav>
      )}

      {!gameEnabled && (
        <section className="games-disabled-message" role="status">
          <Sparkles size={22} aria-hidden="true" />
          <strong>游戏模式已关闭</strong>
          <span>到“桌宠功能”打开游戏模式后，这里就可以开始玩。</span>
        </section>
      )}

      {gameEnabled && showHome && (
        <div ref={homeScrollRef} className="article-game-home-scroll">
          {gameEnabled && desktopInteractionActive && (
            <section className="games-disabled-message games-blocked-message" role="status">
              <CircleAlert size={22} aria-hidden="true" />
              <strong>桌面泡泡互动进行中</strong>
              <span>当前桌面互动结束后，才可以开始控制中心游戏。</span>
            </section>
          )}

          <section className="article-games-catalog" aria-labelledby="article-games-heading">
            <div className="games-catalog-heading ui-section-heading">
              <div>
                <span className="eyebrow">Article projects + H5 象棋</span>
                <h3 id="article-games-heading">10 个开源游戏</h3>
              </div>
              <span className="games-catalog-note">统一中文外壳 · 本机资源 · iframe 沙箱</span>
            </div>
            <div className="article-game-grid" role="list" aria-label="开源游戏列表">
              {ARTICLE_GAME_DEFINITIONS.map((definition) => (
                <article className="article-game-card" key={definition.id} role="listitem">
                  <div className={`article-game-card-icon article-game-card-icon-${definition.icon}`}>
                    <GameIcon name={definition.icon} size={22} />
                  </div>
                  <div className="article-game-card-copy">
                    <div className="article-game-title-row">
                      <h3>{definition.title}</h3>
                      <span>{articleGameBadge(definition)}</span>
                    </div>
                    <p>{definition.description}</p>
                    <div className="article-game-card-meta">
                      <span>{definition.controls}</span>
                      <span>{definition.difficulty}</span>
                      <span>{definition.license}</span>
                    </div>
                  </div>
                  <button
                    className="primary-button article-game-launch"
                    type="button"
                    aria-label={`打开${definition.title}`}
                    onClick={() => selectGame(definition)}
                  >
                    <Gamepad2 size={15} aria-hidden="true" />
                    打开
                  </button>
                </article>
              ))}
            </div>
            <p className="article-games-notice" role="note">
              <CircleAlert size={15} aria-hidden="true" />
              上游项目的规则、AI 和关卡由各自仓库提供；小满只负责统一入口、窗口和生命周期，不虚报额外能力。
            </p>
          </section>
        </div>
      )}

      {gameEnabled && workspace.openTabs.length > 0 && (
        <div className="article-game-tab-panels">
          {workspace.openTabs.map((id) => {
            const definition = definitionFor(id);
            const active = workspace.activeTab === id;
            return (
              <div
                className={`article-game-tab-panel ${active ? "is-active" : "is-inactive"}`}
                key={id}
                role="tabpanel"
                aria-hidden={!active}
              >
                <ArticleGameView
                  definition={definition}
                  enabled={gameEnabled}
                  active={active && visible}
                  sessionState={sessionState}
                  sessionMessage={sessionMessage}
                  muted={muted}
                  onToggleMute={() => setMuted((value) => !value)}
                  paused={Boolean(pausedGames[id])}
                  onTogglePause={() => setPausedGames((current) => ({ ...current, [id]: !current[id] }))}
                  onLayoutSettled={onWorkspaceChange}
                  onClose={() => closeGame(id)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
