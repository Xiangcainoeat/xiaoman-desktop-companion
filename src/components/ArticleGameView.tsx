import {
  AlertCircle,
  Blocks,
  ChevronDown,
  ExternalLink,
  Gamepad2,
  Keyboard,
  LoaderCircle,
  RefreshCw,
  Rocket,
  Shield,
  Star,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ArticleGameDefinition } from "../article-games/registry";
import { articleGameFrameLayout, articleGameFrameSpec } from "../article-games/layout";
import { bridge } from "../useCompanion";

export interface ArticleGameViewProps {
  definition: ArticleGameDefinition;
  enabled: boolean;
  onClose: () => void;
  active?: boolean;
  sessionState?: ArticleGameSessionState;
  sessionMessage?: string;
  muted?: boolean;
  onToggleMute?: () => void;
  onLayoutSettled?: () => void;
}

type GameLoadState = "starting" | "ready" | "error";
export type ArticleGameSessionState = "idle" | "starting" | "ready" | "error";

const FORWARDED_KEY_CODES = new Set([13, 27, 32, 37, 38, 39, 40, 65, 68, 83, 87, 88, 90]);

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function keyCodeForEvent(event: KeyboardEvent): number {
  if (event.keyCode) return event.keyCode;
  const keyCodes: Record<string, number> = {
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    " ": 32,
    Enter: 13,
    Escape: 27,
    a: 65,
    A: 65,
    d: 68,
    D: 68,
    s: 83,
    S: 83,
    w: 87,
    W: 87,
    x: 88,
    X: 88,
    z: 90,
    Z: 90,
  };
  return keyCodes[event.key] ?? 0;
}

type KeyboardHelpRow = readonly [label: string, keys: string];

function keyboardHelpRows(definition: ArticleGameDefinition): readonly KeyboardHelpRow[] {
  switch (definition.id) {
    case "pacman":
      return [["移动", "方向键 / WASD"]];
    case "react-tetris":
      return [["移动", "← → ↓"], ["旋转", "↑"], ["硬降", "空格"], ["重开", "R"]];
    case "star-battle":
      return [["操作", "鼠标点击"]];
    case "space-invaders":
      return [["移动", "← →"], ["射击", "空格"]];
    case "snake":
      return [["移动", "方向键 / WASD"]];
    case "super-mario-bros":
      return [["移动", "← →"], ["跳跃", "Z"], ["奔跑", "X"]];
    case "xiangqi-h5":
      return [["落子", "鼠标点击"]];
    default:
      return [["操作", definition.controls]];
  }
}

function GameIcon({ name, size = 24 }: { name: string; size?: number }) {
  const props = { size, strokeWidth: 1.8, "aria-hidden": true as const };
  switch (name) {
    case "pacman": return <Gamepad2 {...props} />;
    case "blocks": return <Blocks {...props} />;
    case "tank": return <Shield {...props} />;
    case "rocket": return <Rocket {...props} />;
    case "star": return <Star {...props} />;
    case "xiangqi": return <span className="article-game-glyph" aria-hidden="true">象</span>;
    case "chess": return <span className="article-game-glyph" aria-hidden="true">♞</span>;
    case "snake": return <span className="article-game-glyph" aria-hidden="true">蛇</span>;
    case "mario": return <span className="article-game-glyph" aria-hidden="true">M</span>;
    case "2048": return <span className="article-game-glyph article-game-glyph-number" aria-hidden="true">2K</span>;
    default: return <Gamepad2 {...props} />;
  }
}

function stopEvent(event: React.SyntheticEvent) {
  event.stopPropagation();
}

export function ArticleGameView({
  definition,
  enabled,
  onClose,
  active = true,
  sessionState = "ready",
  sessionMessage = "当前无法开始这局游戏",
  muted = true,
  onToggleMute = () => undefined,
  onLayoutSettled,
}: ArticleGameViewProps) {
  const [loadState, setLoadState] = useState<GameLoadState>(definition.availability === "offline" ? "starting" : "ready");
  const [src, setSrc] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [windowActive, setWindowActive] = useState(() => document.visibilityState !== "hidden");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const gameActive = active && windowActive;
  const hasSideHelp = definition.id === "battle-city" || definition.id === "2048";

  useEffect(() => {
    const handleFocus = () => setWindowActive(document.visibilityState !== "hidden");
    const handleBlur = () => setWindowActive(false);
    const handleVisibilityChange = () => setWindowActive(document.visibilityState !== "hidden");
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    const prepare = async () => {
      if (!enabled) {
        setSrc(null);
        setLoadState("error");
        setNotice("小游戏模式已关闭");
        return;
      }
      if (definition.availability === "online") {
        setSrc(null);
        setLoadState("ready");
        setNotice("");
        return;
      }
      if (sessionState !== "ready") {
        setSrc(null);
        setLoadState(sessionState === "error" ? "error" : "starting");
        setNotice(sessionState === "error" ? sessionMessage : "正在准备本机游戏");
        return;
      }
      try {
        setLoadState("starting");
        const url = await bridge.getArticleGameUrl(definition.id);
        if (disposed) return;
        setSrc(`${url}?reload=${reloadNonce}`);
        setLoadState("ready");
        setNotice("");
      } catch (error) {
        if (!disposed) {
          setSrc(null);
          setLoadState("error");
          setNotice(error instanceof Error ? error.message : "游戏资源加载失败");
        }
      }
    };

    void prepare();
    return () => {
      disposed = true;
    };
  }, [definition.availability, definition.id, enabled, reloadNonce, sessionMessage, sessionState]);

  useEffect(() => {
    if (!gameActive || definition.availability !== "offline") return;
    const forwardKey = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const keyCode = keyCodeForEvent(event);
      if (!FORWARDED_KEY_CODES.has(keyCode)) return;
      event.preventDefault();
      iframeRef.current?.contentWindow?.postMessage({
        channel: "xiaoman-game-key",
        eventType: event.type,
        key: event.key,
        code: event.code,
        keyCode,
        repeat: event.repeat,
      }, "*");
    };
    window.addEventListener("keydown", forwardKey, true);
    window.addEventListener("keyup", forwardKey, true);
    return () => {
      window.removeEventListener("keydown", forwardKey, true);
      window.removeEventListener("keyup", forwardKey, true);
    };
  }, [definition.availability, gameActive]);

  useEffect(() => {
    if (!gameActive || !enabled || definition.availability !== "offline") return;
    let disposed = false;
    void bridge.fitArticleGameWindow(definition.id)
      .then(() => {
        if (!disposed) onLayoutSettled?.();
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [definition.availability, definition.id, enabled, gameActive, onLayoutSettled]);

  useEffect(() => {
    if (!src || definition.availability !== "offline") return;
    iframeRef.current?.contentWindow?.postMessage({
      channel: "xiaoman-game-visibility",
      active: gameActive,
    }, "*");
  }, [definition.availability, gameActive, src]);

  useEffect(() => {
    if (!src || definition.availability !== "offline") return;
    iframeRef.current?.contentWindow?.postMessage({
      channel: "xiaoman-game-audio",
      muted: muted || !gameActive,
    }, "*");
  }, [definition.availability, gameActive, muted, src]);

  const focusFrame = () => {
    if (!gameActive) return;
    iframeRef.current?.focus({ preventScroll: true });
  };

  const sendGameKey = (key: string, code: string, keyCode: number) => {
    if (!gameActive) return;
    const target = iframeRef.current?.contentWindow;
    if (!target) return;
    for (const eventType of ["keydown", "keyup"] as const) {
      target.postMessage({
        channel: "xiaoman-game-key",
        eventType,
        key,
        code,
        keyCode,
        repeat: false,
      }, "*");
    }
  };

  const reload = () => {
    setSrc(null);
    setLoadState(definition.availability === "offline" ? "starting" : "ready");
    setNotice("");
    setReloadNonce((value) => value + 1);
  };

  const openOnline = async () => {
    if (!definition.onlineUrl) return;
    try {
      const result = await bridge.openArticleGameOnline(definition.id);
      setNotice(result.message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "在线游戏暂时无法打开");
    }
  };

  const layout = articleGameFrameLayout(definition);
  const frameSpec = articleGameFrameSpec(definition);
  const frameStyle = {
    "--article-game-frame-width": frameSpec.width ? `${frameSpec.width}px` : "100%",
    "--article-game-frame-height": frameSpec.height ? `${frameSpec.height}px` : "680px",
    overflow: "hidden",
  } as CSSProperties;
  const keyHelpRows = keyboardHelpRows(definition);
  const sideHelp = hasSideHelp ? (
    <aside className="article-game-side-help" aria-label={`${definition.title}快捷说明`}>
      <details className="article-game-help-disclosure">
        <summary aria-label="按键说明">
          <Keyboard size={16} aria-hidden="true" />
          <span>按键说明</span>
          <ChevronDown className="article-game-help-chevron" size={15} aria-hidden="true" />
        </summary>
        <div className="article-game-side-help-content">
          <p>{definition.id === "battle-city" ? "方向键移动，空格开火，守住基地并清除敌方坦克。" : "合并相同数字，目标是得到 2048。方向键和 WASD 都可以操作。"}</p>
          <dl>
            <div><dt>移动</dt><dd>{definition.id === "battle-city" ? "方向键" : "方向键 / WASD"}</dd></div>
            <div><dt>{definition.id === "battle-city" ? "开火" : "重开"}</dt><dd>{definition.id === "battle-city" ? "空格" : "按钮"}</dd></div>
          </dl>
          {definition.id === "2048" && (
            <div className="article-game-side-keypad" aria-label="2048方向控制">
              <button type="button" aria-label="向上移动" onClick={() => sendGameKey("ArrowUp", "ArrowUp", 38)}>↑</button>
              <div>
                <button type="button" aria-label="向左移动" onClick={() => sendGameKey("ArrowLeft", "ArrowLeft", 37)}>←</button>
                <button type="button" aria-label="向下移动" onClick={() => sendGameKey("ArrowDown", "ArrowDown", 40)}>↓</button>
                <button type="button" aria-label="向右移动" onClick={() => sendGameKey("ArrowRight", "ArrowRight", 39)}>→</button>
              </div>
            </div>
          )}
        </div>
      </details>
    </aside>
  ) : null;

  return (
    <section
      className={`article-game-view ${active ? "is-active" : "is-inactive"}`}
      aria-labelledby={`article-game-title-${definition.id}`}
      aria-hidden={!active}
      onPointerDown={stopEvent}
      onMouseDown={stopEvent}
      onClick={stopEvent}
      onContextMenu={stopEvent}
    >
      <header className="article-game-header">
        <div className="article-game-heading">
          <div className="article-game-icon"><GameIcon name={definition.icon} /></div>
          <div>
            <span className="eyebrow">文章项目 · {definition.license}</span>
            <h2 id={`article-game-title-${definition.id}`}>{definition.title}</h2>
            <p>{definition.description}</p>
          </div>
        </div>
        <div className="article-game-toolbar">
          {definition.availability === "offline" && !hasSideHelp && (
            <details className="article-game-key-help">
              <summary aria-label="按键说明" title="按键说明">
                <Keyboard size={16} aria-hidden="true" />
                <span>按键</span>
                <ChevronDown className="article-game-key-help-chevron" size={14} aria-hidden="true" />
              </summary>
              <div className="article-game-key-help-popover">
                <strong>按键说明</strong>
                <dl>
                  {keyHelpRows.map(([label, keys]) => (
                    <div key={label}><dt>{label}</dt><dd>{keys}</dd></div>
                  ))}
                </dl>
              </div>
            </details>
          )}
          <button
            className="icon-button"
            type="button"
            title={muted ? "取消静音" : "静音"}
            aria-label={muted ? "取消静音" : "静音"}
            onClick={onToggleMute}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          {definition.availability === "offline" && (
            <button className="icon-button" type="button" title="重新加载游戏" aria-label="重新加载游戏" onClick={reload}>
              <RefreshCw size={18} />
            </button>
          )}
          <button className="icon-button" type="button" title="关闭游戏标签" aria-label="关闭游戏标签" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="article-game-meta" aria-label={`${definition.title}信息`}>
        <span>{definition.controls}</span>
        <span>{definition.difficulty}</span>
        <span>{definition.availability === "online" ? "需要网络" : "本机可玩"}</span>
      </div>

      {definition.availability === "online" ? (
        <div className="article-game-online-panel">
          <div className="article-game-online-icon"><ExternalLink size={28} aria-hidden="true" /></div>
          <h3>Lichess 在线国际象棋</h3>
          <p>这个项目提供完整的在线棋盘服务。点击下面的按钮后，会用系统浏览器打开官方棋盘。</p>
          <button className="primary-button" type="button" onClick={() => void openOnline()}>
            <ExternalLink size={16} aria-hidden="true" />
            打开在线棋盘
          </button>
          {notice && <p className="article-game-notice" role="status">{notice}</p>}
        </div>
      ) : (
        <div className={`article-game-stage ${hasSideHelp ? "has-side-help" : ""}`}>
          <div
            className={`article-game-frame-wrap article-game-frame-wrap-${layout}`}
            data-game-id={definition.id}
            style={frameStyle}
          >
            {loadState === "starting" && (
              <div className="article-game-loading" role="status">
                <LoaderCircle className="is-spinning" size={22} aria-hidden="true" />
                <span>{sessionState === "starting" ? "正在准备本机游戏" : "正在加载游戏"}</span>
              </div>
            )}
            {loadState === "error" && (
              <div className="article-game-loading is-error" role="alert">
                <AlertCircle size={22} aria-hidden="true" />
                <span>{notice || "游戏暂时无法加载"}</span>
                <button className="secondary-button" type="button" onClick={reload}>重试</button>
              </div>
            )}
            {src && loadState === "ready" && (
              <iframe
                key={src}
                ref={iframeRef}
                className={`article-game-frame article-game-frame-${layout}`}
                data-game-id={definition.id}
                title={definition.title}
                src={src}
                tabIndex={0}
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-pointer-lock"
                allow="autoplay; fullscreen"
                onLoad={() => {
                  iframeRef.current?.contentWindow?.postMessage({
                    channel: "xiaoman-game-visibility",
                    active: gameActive,
                  }, "*");
                  iframeRef.current?.contentWindow?.postMessage({
                    channel: "xiaoman-game-audio",
                    muted: muted || !gameActive,
                  }, "*");
                  if (gameActive) onLayoutSettled?.();
                }}
                onPointerDown={focusFrame}
                onMouseDown={focusFrame}
                onError={() => {
                  setLoadState("error");
                  setNotice("游戏页面加载失败，请重试");
                }}
              />
            )}
          </div>
          {sideHelp}
        </div>
      )}

      {definition.sourceUrl && (
        <footer className="article-game-footer">
          <span>资源来自开源仓库，运行文件已随应用打包。</span>
          <a href={definition.sourceUrl} target="_blank" rel="noreferrer">查看源项目 <ExternalLink size={13} aria-hidden="true" /></a>
        </footer>
      )}
    </section>
  );
}

export { GameIcon };
