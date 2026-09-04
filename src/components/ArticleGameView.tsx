import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Blocks,
  ChevronsDown,
  CircleDot,
  ChevronDown,
  Crosshair,
  ExternalLink,
  Gamepad2,
  Keyboard,
  Laptop,
  LoaderCircle,
  Pause,
  Play,
  Puzzle,
  RefreshCw,
  RotateCw,
  Rocket,
  Shield,
  Smartphone,
  Star,
  WandSparkles,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { ArticleGameDefinition } from "../article-games/registry";
import { articleGameFrameLayout, articleGameFrameSpec } from "../article-games/layout";
import {
  GAME_INPUT_MODE_STORAGE_KEY,
  mobileControlProfile,
  resolveGameInputMode,
  type GameInputMode,
  type MobileControlAction,
  type MobileControlIcon,
  type MobileControlProfile,
} from "../article-games/mobile-controls";
import { isDesktopRuntime } from "../bridge";
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
  paused?: boolean;
  onTogglePause?: () => void;
  onLayoutSettled?: () => void;
}

type GameLoadState = "starting" | "ready" | "error";
export type ArticleGameSessionState = "idle" | "starting" | "ready" | "error";

const FORWARDED_KEY_CODES = new Set([13, 27, 32, 37, 38, 39, 40, 65, 68, 74, 77, 80, 82, 83, 87, 88, 90, 191]);
const HOST_PAUSE_KEY_CODES = new Set([27, 80]);

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
    j: 74,
    J: 74,
    m: 77,
    M: 77,
    p: 80,
    P: 80,
    r: 82,
    R: 82,
    "/": 191,
    "?": 191,
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
      return [["移动", "方向键 / WASD"], ["暂停", "P / Esc"]];
    case "react-tetris":
      return [["移动", "← → ↓"], ["旋转", "↑"], ["硬降", "空格"], ["暂停", "P / Esc"], ["重开", "R"]];
    case "battle-city":
      return [["单人", "WASD 移动 · J 开火"], ["双人", "玩家一 WASD + J；玩家二方向键 + /"], ["暂停", "P / Esc"]];
    case "star-battle":
      return [["操作", "鼠标点击"], ["暂停", "P / Esc"]];
    case "space-invaders":
      return [["移动", "← →"], ["射击", "空格"], ["暂停", "P / Esc"]];
    case "snake":
      return [["移动", "方向键 / WASD"], ["暂停", "P / Esc"]];
    case "super-mario-bros":
      return [["移动", "← →"], ["跳跃", "Z"], ["奔跑", "X"], ["暂停", "P / Esc"]];
    case "sliding-puzzle":
      return [["移动", "鼠标点击"], ["暂停", "P / Esc"]];
    case "xiangqi-h5":
      return [["落子", "鼠标点击"], ["暂停", "P / Esc"]];
    default:
      return [["操作", definition.controls], ["暂停", "P / Esc"]];
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
    case "puzzle": return <Puzzle {...props} />;
    case "gomoku": return <CircleDot {...props} />;
    case "xiangqi": return <span className="article-game-glyph" aria-hidden="true">象</span>;
    case "chess": return <span className="article-game-glyph" aria-hidden="true">♞</span>;
    case "snake": return <span className="article-game-glyph" aria-hidden="true">蛇</span>;
    case "mario": return <span className="article-game-glyph" aria-hidden="true">M</span>;
    case "2048": return <span className="article-game-glyph article-game-glyph-number" aria-hidden="true">2K</span>;
    default: return <Gamepad2 {...props} />;
  }
}

/**
 * A small, local game mark for catalog cards. The reference directory uses
 * artwork thumbnails, but those site assets are not licensed for bundling;
 * this keeps the same visual role with the existing icon system and CSS.
 */
export function GameArtMark({ name, size = 46 }: { name: string; size?: number }) {
  const style = { "--game-art-size": `${size}px` } as CSSProperties;
  return (
    <span className={`game-art-mark game-art-mark-${name}`} style={style} aria-hidden="true">
      <span className="game-art-mark-decoration" />
      <span className="game-art-mark-icon"><GameIcon name={name} size={Math.max(18, Math.round(size * 0.48))} /></span>
    </span>
  );
}

function stopEvent(event: React.SyntheticEvent) {
  event.stopPropagation();
}

function initialInputMode(): GameInputMode {
  try {
    const value = localStorage.getItem(GAME_INPUT_MODE_STORAGE_KEY);
    if (value === "auto" || value === "desktop" || value === "mobile") return value;
  } catch {
    // Storage is optional in hardened webviews.
  }
  return "auto";
}

function controlIcon(icon: MobileControlIcon) {
  const props = { size: 21, strokeWidth: 2, "aria-hidden": true as const };
  switch (icon) {
    case "left": return <ArrowLeft {...props} />;
    case "right": return <ArrowRight {...props} />;
    case "up": return <ArrowUp {...props} />;
    case "down": return <ArrowDown {...props} />;
    case "rotate": return <RotateCw {...props} />;
    case "drop": return <ChevronsDown {...props} />;
    case "fire": return <Crosshair {...props} />;
    case "jump": return <ArrowUp {...props} />;
    case "run": return <ChevronsDown {...props} />;
  }
}

function MobileGameControls({
  profile,
  disabled,
  onPress,
  onRelease,
}: {
  profile: MobileControlProfile;
  disabled: boolean;
  onPress: (action: MobileControlAction) => void;
  onRelease: (action: MobileControlAction) => void;
}) {
  if (profile.kind === "external") return null;
  if (profile.kind === "direct") return null;

  const controlButton = (action: MobileControlAction) => {
    const press = (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      onPress(action);
    };
    const release = (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onRelease(action);
    };
    return (
      <button
        className={`mobile-game-control-button is-${action.icon}`}
        data-position={action.position}
        type="button"
        key={action.id}
        disabled={disabled}
        aria-label={action.label}
        title={action.label}
        onPointerDown={press}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onClick={(event) => {
          if (event.detail !== 0) return;
          onPress(action);
          onRelease(action);
        }}
      >
        {controlIcon(action.icon)}
        <span>{action.label}</span>
      </button>
    );
  };

  return (
    <div className="mobile-game-controls" aria-label="手机游戏控制">
      <div className="mobile-game-control-copy"><Smartphone size={17} aria-hidden="true" /><span>{profile.hint}</span></div>
      <div className="mobile-game-control-groups">
        {(profile.directions?.length ?? 0) > 0 && (
          <div className="mobile-game-direction-pad" aria-label="方向控制">
            {profile.directions?.map(controlButton)}
          </div>
        )}
        {(profile.actions?.length ?? 0) > 0 && (
          <div className="mobile-game-action-pad" aria-label="动作控制">
            {profile.actions?.map(controlButton)}
          </div>
        )}
      </div>
    </div>
  );
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
  paused = false,
  onTogglePause = () => undefined,
  onLayoutSettled,
}: ArticleGameViewProps) {
  const frameSpec = articleGameFrameSpec(definition);
  const [loadState, setLoadState] = useState<GameLoadState>(definition.availability === "offline" ? "starting" : "ready");
  const [src, setSrc] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [windowActive, setWindowActive] = useState(() => document.visibilityState !== "hidden");
  const [tetrisDifficulty, setTetrisDifficulty] = useState(1);
  const [marioDifficulty, setMarioDifficulty] = useState<"easy" | "hard">("easy");
  const [marioLevel, setMarioLevel] = useState("1-1");
  const [inputMode, setInputMode] = useState<GameInputMode>(initialInputMode);
  const [viewportWidth, setViewportWidth] = useState(() => typeof window === "undefined" ? 1280 : window.innerWidth);
  const [coarsePointer, setCoarsePointer] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pressedControlsRef = useRef(new Map<string, MobileControlAction>());
  const [frameScale, setFrameScale] = useState(1);
  const gameActive = active && windowActive;
  const hasSideHelp = definition.id === "battle-city" || definition.id === "2048";
  const resolvedInputMode = resolveGameInputMode(inputMode, viewportWidth, coarsePointer);
  const mobileProfile = mobileControlProfile(definition.id);

  useEffect(() => {
    const pointerQuery = window.matchMedia?.("(pointer: coarse)");
    const updateDevice = () => {
      setViewportWidth(window.innerWidth);
      setCoarsePointer(pointerQuery?.matches === true);
    };
    updateDevice();
    window.addEventListener("resize", updateDevice);
    pointerQuery?.addEventListener?.("change", updateDevice);
    return () => {
      window.removeEventListener("resize", updateDevice);
      pointerQuery?.removeEventListener?.("change", updateDevice);
    };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(GAME_INPUT_MODE_STORAGE_KEY, inputMode); } catch { /* storage is optional */ }
  }, [inputMode]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const intrinsicWidth = frameSpec.width;
    if (!stage || definition.availability !== "offline" || !intrinsicWidth) {
      setFrameScale(1);
      return;
    }

    const updateScale = () => {
      if (isDesktopRuntime() && resolvedInputMode === "desktop") {
        setFrameScale(1);
        return;
      }
      const availableWidth = stage.clientWidth;
      const nextScale = availableWidth > 0
        ? Math.min(1, availableWidth / intrinsicWidth)
        : 1;
      const normalized = Math.max(0.1, Number(nextScale.toFixed(4)));
      setFrameScale((current) => Math.abs(current - normalized) < 0.0001 ? current : normalized);
    };

    updateScale();
    const frame = window.requestAnimationFrame(updateScale);
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateScale);
    resizeObserver?.observe(stage);
    window.addEventListener("resize", updateScale);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [definition.availability, definition.id, frameSpec.width, resolvedInputMode]);

  useEffect(() => {
    const syncWindowActivity = () => setWindowActive(document.visibilityState !== "hidden");
    const handleFocus = () => syncWindowActivity();
    // Chromium can emit window.blur when focus moves into an iframe. That is
    // not the same as leaving the app and must not disable the selected game.
    const handleBlur = () => {
      if (document.visibilityState === "hidden") setWindowActive(false);
    };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", syncWindowActivity);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", syncWindowActivity);
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
        setNotice(sessionState === "error" ? sessionMessage : "正在连接游戏服务");
        return;
      }
      try {
        setLoadState("starting");
        const url = await bridge.getArticleGameUrl(definition.id);
        if (disposed) return;
        setSrc(`${url}${url.includes("?") ? "&" : "?"}reload=${reloadNonce}`);
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
      if (HOST_PAUSE_KEY_CODES.has(keyCode)) {
        event.preventDefault();
        if (event.type === "keydown" && !event.repeat) onTogglePause();
        return;
      }
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
  }, [definition.availability, gameActive, onTogglePause]);

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

  const postToGame = (message: Record<string, unknown>) => {
    if (!src || definition.availability !== "offline") return;
    iframeRef.current?.contentWindow?.postMessage(message, "*");
  };

  const sendControlKey = (action: MobileControlAction, eventType: "keydown" | "keyup") => {
    postToGame({
      channel: "xiaoman-game-key",
      eventType,
      key: action.key,
      code: action.code,
      keyCode: action.keyCode,
      repeat: false,
    });
  };

  const pressMobileControl = (action: MobileControlAction) => {
    if (!gameActive || paused || pressedControlsRef.current.has(action.id)) return;
    pressedControlsRef.current.set(action.id, action);
    sendControlKey(action, "keydown");
  };

  const releaseMobileControl = (action: MobileControlAction) => {
    if (!pressedControlsRef.current.delete(action.id)) return;
    sendControlKey(action, "keyup");
  };

  useEffect(() => {
    if (gameActive && !paused && resolvedInputMode === "mobile") return;
    for (const action of pressedControlsRef.current.values()) sendControlKey(action, "keyup");
    pressedControlsRef.current.clear();
  }, [gameActive, paused, resolvedInputMode, src]);

  useEffect(() => () => {
    for (const action of pressedControlsRef.current.values()) sendControlKey(action, "keyup");
    pressedControlsRef.current.clear();
  }, [src]);

  const postGameConfig = () => {
    if (definition.id === "react-tetris") {
      postToGame({ channel: "xiaoman-game-config", kind: "tetris-difficulty", value: tetrisDifficulty });
    }
    if (definition.id === "super-mario-bros") {
      postToGame({ channel: "xiaoman-game-config", kind: "mario-difficulty", value: marioDifficulty });
      postToGame({ channel: "xiaoman-game-config", kind: "mario-level", value: marioLevel });
    }
  };

  useEffect(() => {
    if (!src || definition.availability !== "offline") return;
    postToGame({ channel: "xiaoman-game-visibility", active: gameActive });
  }, [definition.availability, gameActive, src]);

  useEffect(() => {
    if (!src || definition.availability !== "offline") return;
    postToGame({ channel: "xiaoman-game-pause", paused });
  }, [definition.availability, paused, src]);

  useEffect(() => {
    if (!src || definition.availability !== "offline") return;
    postToGame({ channel: "xiaoman-game-audio", muted });
  }, [definition.availability, muted, src]);

  useEffect(() => {
    if (!src || definition.availability !== "offline") return;
    postGameConfig();
  }, [definition.availability, definition.id, marioDifficulty, marioLevel, src, tetrisDifficulty]);

  const focusFrame = () => {
    if (!active) return;
    // The first pointer event is also the recovery path after an iframe caused
    // a transient window blur. Reactivate before the next visibility message.
    setWindowActive(true);
    iframeRef.current?.focus({ preventScroll: true });
    if (resolvedInputMode === "mobile") return;
    // Some Electron/WebKit builds still scroll an iframe ancestor after focus.
    // Keyboard events are forwarded by the host, so restore only that outer row.
    window.requestAnimationFrame(() => {
      const gamesView = iframeRef.current?.closest<HTMLElement>(".games-view");
      if (gamesView) gamesView.scrollTop = 0;
    });
  };

  const reload = () => {
    setSrc(null);
    setLoadState(definition.availability === "offline" ? "starting" : "ready");
    setNotice("");
    setReloadNonce((value) => value + 1);
  };

  const changeTetrisDifficulty = (level: number) => {
    if (level === tetrisDifficulty) return;
    setTetrisDifficulty(level);
    setSrc(null);
    setLoadState("starting");
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
  const frameStyle = {
    "--article-game-frame-width": frameSpec.width ? `${frameSpec.width}px` : "100%",
    "--article-game-frame-height": frameSpec.height ? `${frameSpec.height}px` : "680px",
    "--article-game-render-width": frameSpec.width ? `${frameSpec.width * frameScale}px` : "100%",
    "--article-game-render-height": frameSpec.height ? `${frameSpec.height * frameScale}px` : "680px",
    "--article-game-frame-scale": String(frameScale),
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
          <p>{definition.id === "battle-city" ? "单人和双人都支持。选择模式后，按对应玩家的键盘控制坦克。" : "合并相同数字，目标是得到 2048。仅支持键盘操作。"}</p>
          <dl>
            {definition.id === "battle-city" ? (
              <>
                <div><dt>单人</dt><dd>WASD 移动 · J 开火</dd></div>
                <div><dt>双人</dt><dd>P1：WASD + J<br />P2：方向键 + /</dd></div>
                <div><dt>暂停</dt><dd>P / Esc</dd></div>
              </>
            ) : (
              <div><dt>操作</dt><dd>方向键 / WASD</dd></div>
            )}
          </dl>
        </div>
      </details>
    </aside>
  ) : null;

  return (
    <section
      className={`article-game-view ${active ? "is-active" : "is-inactive"}`}
      data-input-mode={resolvedInputMode}
      data-mobile-control-kind={mobileProfile.kind}
      aria-labelledby={`article-game-title-${definition.id}`}
      aria-hidden={!active}
      onPointerDown={stopEvent}
      onMouseDown={stopEvent}
      onClick={stopEvent}
      onContextMenu={stopEvent}
    >
      <header className="article-game-header">
        <div className="article-game-heading">
          <GameArtMark name={definition.icon} size={46} />
          <div>
            <span className="eyebrow">文章项目 · {definition.license}</span>
            <h2 id={`article-game-title-${definition.id}`}>{definition.title}</h2>
            <p>{definition.description}</p>
          </div>
        </div>
        <div className="article-game-toolbar">
          {definition.availability === "offline" && (
            <div className="article-game-input-switch" role="group" aria-label="游戏操作方式">
              {(["auto", "desktop", "mobile"] as const).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={inputMode === mode ? "is-active" : ""}
                  aria-pressed={inputMode === mode}
                  title={mode === "auto" ? "自动选择操作方式" : mode === "desktop" ? "桌面键鼠操作" : "手机触控操作"}
                  onClick={() => setInputMode(mode)}
                >
                  {mode === "auto" ? <WandSparkles size={15} /> : mode === "desktop" ? <Laptop size={15} /> : <Smartphone size={15} />}
                  <span>{mode === "auto" ? "自动" : mode === "desktop" ? "桌面" : "手机"}</span>
                </button>
              ))}
            </div>
          )}
          {definition.availability === "offline" && (
            <button
              className="icon-button"
              type="button"
              title={paused ? "继续游戏" : "暂停游戏"}
              aria-label={paused ? "继续游戏" : "暂停游戏"}
              onClick={onTogglePause}
            >
              {paused ? <Play size={18} /> : <Pause size={18} />}
            </button>
          )}
          {definition.id === "react-tetris" && (
            <label className="article-game-option" title="选择起始速度级别">
              <span>级别</span>
              <select
                aria-label="俄罗斯方块难度级别"
                value={tetrisDifficulty}
                onChange={(event) => changeTetrisDifficulty(Number(event.target.value))}
              >
                {[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>{level}</option>)}
              </select>
            </label>
          )}
          {definition.id === "super-mario-bros" && (
            <>
              <label className="article-game-option" title="选择马里奥难度">
                <span>难度</span>
                <select
                  aria-label="超级马里奥难度"
                  value={marioDifficulty}
                  onChange={(event) => setMarioDifficulty(event.target.value as "easy" | "hard")}
                >
                  <option value="easy">简单 · 3次复活</option>
                  <option value="hard">困难 · 无复活</option>
                </select>
              </label>
              <label className="article-game-option" title="选择已解锁关卡">
                <span>关卡</span>
                <select aria-label="超级马里奥关卡" value={marioLevel} onChange={(event) => setMarioLevel(event.target.value)}>
                  <option value="1-1">1-1</option>
                </select>
              </label>
            </>
          )}
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
        <span>{definition.availability === "online" ? "需要网络" : "服务器托管"}</span>
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
        <>
        <div ref={stageRef} className={`article-game-stage ${hasSideHelp ? "has-side-help" : ""} ${resolvedInputMode === "mobile" ? "is-mobile" : ""}`}>
          <div
            className={`article-game-frame-wrap article-game-frame-wrap-${layout}`}
            data-game-id={definition.id}
            style={frameStyle}
          >
            {loadState === "starting" && (
              <div className="article-game-loading" role="status">
                <LoaderCircle className="is-spinning" size={22} aria-hidden="true" />
                <span>{sessionState === "starting" ? "正在连接游戏服务" : "正在加载游戏"}</span>
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
                  postToGame({ channel: "xiaoman-game-visibility", active: gameActive });
                  postToGame({ channel: "xiaoman-game-pause", paused });
                  postToGame({ channel: "xiaoman-game-audio", muted });
                  postGameConfig();
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
        {resolvedInputMode === "mobile" && (
          <MobileGameControls
            profile={mobileProfile}
            disabled={!gameActive || paused || loadState !== "ready"}
            onPress={pressMobileControl}
            onRelease={releaseMobileControl}
          />
        )}
        </>
      )}

      {definition.sourceUrl && (
        <footer className="article-game-footer">
          <span>资源来自开源仓库，运行文件由联机服务器统一托管。</span>
          <a href={definition.sourceUrl} target="_blank" rel="noreferrer">查看源项目 <ExternalLink size={13} aria-hidden="true" /></a>
        </footer>
      )}
    </section>
  );
}

export { GameIcon };
