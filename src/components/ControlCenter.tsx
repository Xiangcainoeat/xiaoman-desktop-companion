import { useState } from "react";
import {
  AppWindow,
  BellRing,
  Code2,
  Gamepad2,
  Heart,
  Eye,
  LayoutDashboard,
  ListChecks,
  Settings,
  Utensils,
} from "lucide-react";
import { STATE_LABELS } from "../shared/domain";
import { bridge, useCompanion } from "../useCompanion";
import { EventsView } from "./EventsView";
import { CodexTasksView } from "./CodexTasksView";
import { CareView } from "./CareView";
import { FeaturesView } from "./FeaturesView";
import { GamesView } from "./GamesView";
import { OverviewView } from "./OverviewView";
import { RemindersView } from "./RemindersView";
import { SettingsView } from "./SettingsView";

type Tab = "features" | "care" | "games" | "codex" | "overview" | "reminders" | "events" | "settings";

const NAVIGATION: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: "features", label: "桌宠功能", icon: <ListChecks size={18} /> },
  { id: "care", label: "养成照料", icon: <Heart size={18} /> },
  { id: "games", label: "互动游戏", icon: <Gamepad2 size={18} /> },
  { id: "codex", label: "Codex 任务", icon: <Code2 size={18} /> },
  { id: "overview", label: "概览", icon: <LayoutDashboard size={18} /> },
  { id: "reminders", label: "提醒计划", icon: <BellRing size={18} /> },
  { id: "events", label: "应用事件", icon: <AppWindow size={18} /> },
  { id: "settings", label: "偏好设置", icon: <Settings size={18} /> },
];

const TAB_TITLES: Record<Tab, string> = {
  features: "小满的功能",
  care: "照顾小满",
  games: "和小满玩游戏",
  codex: "Codex 当前任务",
  overview: "今天的小满",
  reminders: "提醒计划",
  events: "外部应用事件",
  settings: "偏好设置",
};

export function ControlCenter() {
  const snapshot = useCompanion();
  const [tab, setTab] = useState<Tab>("features");

  if (!snapshot) {
    return (
      <main className="center-loading">
        <div className="loading-pulse" />
        <span>小满</span>
      </main>
    );
  }

  return (
    <main className="center-shell">
      <aside className="sidebar">
        <div className="sidebar-drag-region" />
        <div className="brand-block">
          <div className="brand-avatar"><img src="./pet/avatar.png" alt="" /></div>
          <div><strong>小满</strong><span>桌面伴侣</span></div>
        </div>
        <nav className="sidebar-nav" aria-label="主导航">
          {NAVIGATION.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? "is-active" : ""}
              onClick={() => setTab(item.id)}
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
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-state">
            <span className={`live-dot state-${snapshot.state}`} />
            <div><strong>{STATE_LABELS[snapshot.state]}</strong><small>{snapshot.monitoring.activeApplication ?? "桌面"}</small></div>
          </div>
          <div className="sidebar-totals">
            <span><Utensils size={14} />{snapshot.stats.meals}</span>
            <span><Eye size={14} />{snapshot.stats.interactions}</span>
          </div>
        </div>
      </aside>

      <section className="center-content">
        <header className="topbar">
          <div><span className="eyebrow">小满桌面伴侣</span><h1>{TAB_TITLES[tab]}</h1></div>
          <div className="topbar-actions">
            <span className={`monitor-pill ${snapshot.monitoring.codexBusy ? "is-busy" : ""}`}>
              <span />{snapshot.monitoring.codexBusy ? "Codex 工作中" : "已就绪"}
            </span>
            <button className="secondary-button" type="button" onClick={() => bridge.toggleOverlay()}>
              <Eye size={16} />
              {snapshot.settings.overlayVisible ? "隐藏小满" : "显示小满"}
            </button>
          </div>
        </header>
        <div className="content-scroll">
          {tab === "features" && <FeaturesView snapshot={snapshot} />}
          {tab === "care" && <CareView snapshot={snapshot} />}
          {tab === "games" && <GamesView enabled={snapshot.settings.gameModeEnabled} />}
          {tab === "codex" && (
            <CodexTasksView
              enabled={snapshot.settings.codexSessionControls}
              replyTransport={snapshot.settings.codexReplyTransport}
            />
          )}
          {tab === "overview" && <OverviewView snapshot={snapshot} onOpenCare={() => setTab("care")} />}
          {tab === "reminders" && <RemindersView snapshot={snapshot} />}
          {tab === "events" && <EventsView snapshot={snapshot} />}
          {tab === "settings" && <SettingsView snapshot={snapshot} />}
        </div>
      </section>
    </main>
  );
}
