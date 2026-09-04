import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AppWindow,
  BellRing,
  Code2,
  Gamepad2,
  Heart,
  Eye,
  LayoutDashboard,
  ListChecks,
  Power,
  Settings,
  Utensils,
} from "lucide-react";
import { STATE_LABELS } from "../shared/domain";
import { isDesktopRuntime } from "../bridge";
import { bridge, useCompanion } from "../useCompanion";
import { EventsView } from "./EventsView";
import { CodexTasksView } from "./CodexTasksView";
import { CareView } from "./CareView";
import { FeaturesView } from "./FeaturesView";
import { GamesView } from "./GamesView";
import { OverviewView } from "./OverviewView";
import { RemindersView } from "./RemindersView";
import { SettingsView } from "./SettingsView";
import { FriendsView, type FriendsViewSection } from "./FriendsView";
import type { CenterTab } from "../shared/types";
import {
  canUseCenterTab,
  defaultCenterTabForSurface,
  runtimeSurface,
} from "../shared/runtime";

type Tab = CenterTab;

type NavigationItem = {
  id: Tab;
  label: string;
  icon: React.ReactNode;
};

const NAVIGATION_GROUPS: Array<{
  id: string;
  label: string;
  items: NavigationItem[];
}> = [
  {
    id: "companion",
    label: "桌宠",
    items: [
      { id: "features", label: "桌宠功能", icon: <ListChecks size={18} /> },
      { id: "care", label: "养成照料", icon: <Heart size={18} /> },
    ],
  },
  {
    id: "games",
    label: "游戏",
    items: [
      { id: "games", label: "单机游戏", icon: <Gamepad2 size={18} /> },
      { id: "online", label: "联机房间", icon: <Gamepad2 size={18} /> },
    ],
  },
  {
    id: "work",
    label: "工作",
    items: [
      { id: "codex", label: "Codex 任务", icon: <Code2 size={18} /> },
      { id: "overview", label: "概览", icon: <LayoutDashboard size={18} /> },
      { id: "reminders", label: "提醒计划", icon: <BellRing size={18} /> },
      { id: "events", label: "应用事件", icon: <AppWindow size={18} /> },
    ],
  },
  {
    id: "system",
    label: "系统",
    items: [
      { id: "settings", label: "偏好设置", icon: <Settings size={18} /> },
    ],
  },
];

const TAB_TITLES: Record<Tab, string> = {
  features: "小满的功能",
  care: "照顾小满",
  games: "和小满玩游戏",
  online: "联机房间",
  // Kept for older bridge messages; the rendered workspace is the same.
  social: "联机房间",
  codex: "Codex 当前任务",
  overview: "今天的小满",
  reminders: "提醒计划",
  events: "外部应用事件",
  settings: "偏好设置",
};

export function ControlCenter() {
  const surface = runtimeSurface(isDesktopRuntime());
  const desktopRuntime = surface === "desktop";
  const snapshot = useCompanion();
  const [tab, setTab] = useState<Tab>(() => {
    if (!desktopRuntime && typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("room") || params.get("tab") === "online" || params.get("tab") === "mine") return "online";
    }
    return defaultCenterTabForSurface(surface);
  });
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const gamesPageRef = useRef<HTMLDivElement>(null);
  const resetContentScroll = useCallback(() => {
    contentScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    gamesPageRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  const selectTab = useCallback((nextTab: Tab) => {
    const canonicalTab = nextTab === "social" ? "online" : nextTab;
    if (canUseCenterTab(canonicalTab, surface)) setTab(canonicalTab);
  }, [surface]);

  const selectNavigationItem = useCallback((item: NavigationItem) => {
    selectTab(item.id);
  }, [selectTab]);

  const selectSocialSection = useCallback((section: FriendsViewSection) => {
    selectTab(section === "online-games" ? "online" : "social");
  }, [selectTab]);

  useEffect(() => bridge.onCenterTab(selectTab), [selectTab]);
  useEffect(() => {
    if (!canUseCenterTab(tab, surface)) setTab(defaultCenterTabForSurface(surface));
  }, [surface, tab]);
  useLayoutEffect(() => {
    resetContentScroll();
  }, [resetContentScroll, tab]);

  if (!snapshot) {
    return (
      <main className="center-loading">
        <div className="loading-pulse" />
        <span>小满</span>
      </main>
    );
  }

  return (
    <main className={`center-shell ${desktopRuntime ? "is-desktop" : "is-web"}`}>
      <aside className="sidebar">
        <div className="sidebar-drag-region" />
        <div className="brand-block">
          <div className="brand-avatar"><img src="./pet/avatar.png" alt="" /></div>
          <div><strong>小满</strong><span>桌面伴侣</span></div>
        </div>
        <nav className="sidebar-nav" aria-label="主导航">
          {NAVIGATION_GROUPS
            .map((group) => ({ ...group, items: group.items.filter((item) => canUseCenterTab(item.id, surface)) }))
            .filter((group) => group.items.length > 0)
            .map((group) => (
            <div className="sidebar-nav-group" key={group.id}>
              <span className="sidebar-nav-label">{group.label}</span>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={tab === item.id ? "is-active" : ""}
                  onClick={() => selectNavigationItem(item)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.id === "reminders" && snapshot.reminders.filter((reminder) => reminder.enabled).length > 0 && (
                    <em>{snapshot.reminders.filter((reminder) => reminder.enabled).length}</em>
                  )}
                  {item.id === "codex" && snapshot.monitoring.codexBusy && <em>运行中</em>}
                  {item.id === "care" && snapshot.inventory.food["fish-snack"] > 0 && <em>{snapshot.inventory.food["fish-snack"]}</em>}
                </button>
              ))}
            </div>
            ))}
        </nav>
        {desktopRuntime ? <div className="sidebar-footer">
          <div className="sidebar-state">
            <span className={`live-dot state-${snapshot.state}`} />
            <div><strong>{STATE_LABELS[snapshot.state]}</strong><small>{snapshot.monitoring.activeApplication ?? "桌面"}</small></div>
          </div>
          <div className="sidebar-totals">
            <span><Utensils size={14} />{snapshot.stats.meals}</span>
            <span><Eye size={14} />{snapshot.stats.interactions}</span>
          </div>
        </div> : <div className="sidebar-footer sidebar-web-footer">
          <div className="sidebar-state">
            <span className="live-dot state-ready" />
            <div><strong>在线空间</strong><small>互动游戏与联机房间</small></div>
          </div>
        </div>}
      </aside>

      <section className="center-content">
        <header className="topbar">
          <div className={`topbar-heading ${desktopRuntime ? "is-desktop" : "is-web"}`}>
            {desktopRuntime ? <><span className="eyebrow">小满桌面伴侣</span><h1>{TAB_TITLES[tab]}</h1></> : <>
              <div className="web-brand-mark"><img src="./pet/avatar.png" alt="" /></div>
              <div className="web-brand-copy"><strong>小满</strong><span>桌面伴侣</span></div>
              <h1 className="sr-only">{TAB_TITLES[tab]}</h1>
            </>}
          </div>
          {!desktopRuntime && <nav className="web-primary-nav" aria-label="网页主导航" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "games"} className={tab === "games" ? "is-active" : ""} onClick={() => selectTab("games")}>单机游戏</button>
            <button type="button" role="tab" aria-selected={tab === "online"} className={tab === "online" ? "is-active" : ""} onClick={() => selectTab("online")}>联机房间</button>
          </nav>}
          <div className="topbar-actions">
            {desktopRuntime ? <>
              <span className={`monitor-pill ${snapshot.monitoring.codexBusy ? "is-busy" : ""}`}>
                <span />{snapshot.monitoring.codexBusy ? "Codex 工作中" : "已就绪"}
              </span>
              <button className="secondary-button" type="button" onClick={() => bridge.toggleOverlay()}>
                <Eye size={16} />
                {snapshot.settings.overlayVisible ? "隐藏小满" : "显示小满"}
              </button>
              <button
                className="secondary-button app-quit-button"
                type="button"
                title="退出小满桌面伴侣"
                aria-label="退出小满桌面伴侣"
                onClick={() => bridge.quitApp()}
              >
                <Power size={16} aria-hidden="true" />
                <span>退出小满</span>
              </button>
            </> : <span className="monitor-pill web-surface-pill"><span />在线模式</span>}
          </div>
        </header>
        <div className={`content-scroll ${tab === "games" ? "is-games" : ""}`} ref={contentScrollRef}>
          <div
            className={`center-page center-page-games ${tab === "games" ? "is-active" : "is-inactive"}`}
            aria-hidden={tab !== "games"}
            ref={gamesPageRef}
          >
            <GamesView
              enabled={desktopRuntime ? snapshot.settings.gameModeEnabled : true}
              desktopInteractionActive={desktopRuntime ? snapshot.desktopInteraction.active : false}
              visible={tab === "games"}
              onWorkspaceChange={resetContentScroll}
            />
          </div>
          <div
            className={`center-page center-page-other ${tab === "games" ? "is-inactive" : "is-active"}`}
            aria-hidden={tab === "games"}
          >
            {tab === "features" && <FeaturesView snapshot={snapshot} />}
            {tab === "care" && <CareView snapshot={snapshot} />}
            {tab === "codex" && (
              <CodexTasksView
                enabled={snapshot.settings.codexSessionControls}
                replyTransport={snapshot.settings.codexReplyTransport}
              />
            )}
            {tab === "overview" && <OverviewView snapshot={snapshot} onOpenCare={() => selectTab("care")} />}
            {tab === "reminders" && <RemindersView snapshot={snapshot} />}
            {tab === "events" && <EventsView snapshot={snapshot} />}
            {tab === "settings" && <SettingsView snapshot={snapshot} />}
            {(tab === "online" || tab === "social") && (
              <FriendsView
                initialSection="online-games"
                onSectionChange={selectSocialSection}
                onOpenSingleGames={() => selectTab("games")}
              />
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
