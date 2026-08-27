import {
  BellRing,
  Bone,
  CheckCircle2,
  CircleOff,
  Code2,
  Eye,
  Fish,
  Gamepad2,
  Heart,
  Moon,
  PartyPopper,
  Sparkles,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { STATE_LABELS } from "../shared/domain";
import type { AppSnapshot, InteractionAction } from "../shared/types";
import { bridge } from "../useCompanion";
import { EmptyState, StatBar } from "./Controls";
import { PetSprite } from "./PetSprite";
import { ActionPreview } from "./ActionPreview";

function statusText(status: string): string {
  if (status === "watching" || status === "available") return "已连接";
  if (status === "off") return "已关闭";
  return "不可用";
}

function formatActivityTime(at: number): string {
  const date = new Date(at);
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function OverviewView({ snapshot }: { snapshot: AppSnapshot }) {
  const [showActionPreview, setShowActionPreview] = useState(false);
  const actions: Array<{
    action: InteractionAction;
    label: string;
    icon: React.ReactNode;
    className: string;
  }> = [
    { action: "feed", label: "喂鱼干", icon: <Fish size={19} />, className: "quick-feed" },
    { action: "pet", label: "摸摸", icon: <Heart size={19} />, className: "quick-pet" },
    { action: "play", label: "一起玩", icon: <Gamepad2 size={19} />, className: "quick-play" },
    {
      action: snapshot.sleeping ? "wake" : "sleep",
      label: snapshot.sleeping ? "叫醒" : "睡觉",
      icon: snapshot.sleeping ? <Sparkles size={19} /> : <Moon size={19} />,
      className: "quick-sleep",
    },
    { action: "celebrate", label: "庆祝", icon: <PartyPopper size={19} />, className: "quick-celebrate" },
  ];

  return (
    <div className="view overview-view">
      <section className="overview-hero">
        <div className="overview-pet-stage">
          <PetSprite state={snapshot.state} settings={snapshot.settings} size={164} />
        </div>
        <div className="overview-status">
          <div className="eyebrow">当前状态</div>
          <h2>{STATE_LABELS[snapshot.state]}</h2>
          <p>{snapshot.stateMessage}</p>
          <span className={`state-source source-${snapshot.stateSource}`}>{snapshot.stateSource}</span>
        </div>
        <div className="stats-panel">
          <StatBar icon={<Bone size={16} />} label="饱食度" value={snapshot.stats.fullness} tone="coral" />
          <StatBar icon={<Heart size={16} />} label="好感度" value={snapshot.stats.affection} tone="green" />
          <StatBar icon={<Zap size={16} />} label="精力" value={snapshot.stats.energy} tone="blue" />
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="eyebrow">互动</span>
            <h3>和小满相处</h3>
          </div>
        </div>
        <div className="quick-actions">
          {actions.map((item) => (
            <button
              key={item.action}
              type="button"
              className={`quick-action ${item.className}`}
              onClick={() => void bridge.interact(item.action)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <button className="preview-trigger" type="button" onClick={() => setShowActionPreview(true)}>
          <Eye size={17} />
          <span>动作预览</span>
        </button>
        {showActionPreview && (
          <ActionPreview settings={snapshot.settings} onClose={() => setShowActionPreview(false)} />
        )}
      </section>

      <div className="overview-columns">
        <section className="section-block integration-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">连接</span>
              <h3>事件来源</h3>
            </div>
          </div>
          <div className="status-list">
            <div className="status-row">
              <span className="status-icon"><Code2 size={17} /></span>
              <span><strong>Codex</strong><small>会话状态 · 只读</small></span>
              <em className={`status-value is-${snapshot.monitoring.codex}`}>{statusText(snapshot.monitoring.codex)}</em>
            </div>
            <div className="status-row">
              <span className="status-icon"><CheckCircle2 size={17} /></span>
              <span><strong>前台应用</strong><small>{snapshot.monitoring.activeApplication ?? "无活动应用"}</small></span>
              <em className={`status-value is-${snapshot.monitoring.applications}`}>{statusText(snapshot.monitoring.applications)}</em>
            </div>
            <div className="status-row">
              <span className="status-icon"><BellRing size={17} /></span>
              <span><strong>系统通知</strong><small>提醒与主动状态</small></span>
              <em className={`status-value is-${snapshot.monitoring.notifications}`}>{statusText(snapshot.monitoring.notifications)}</em>
            </div>
          </div>
        </section>

        <section className="section-block activity-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">最近</span>
              <h3>小满动态</h3>
            </div>
            {snapshot.activity.length > 0 && (
              <button className="text-button" type="button" onClick={() => void bridge.clearActivity()}>
                清空
              </button>
            )}
          </div>
          {snapshot.activity.length === 0 ? (
            <EmptyState icon={<CircleOff size={20} />} title="暂无动态" />
          ) : (
            <div className="activity-list">
              {snapshot.activity.slice(0, 6).map((item) => (
                <div className="activity-row" key={item.id}>
                  <span className={`activity-dot source-${item.source}`} />
                  <span className="activity-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>
                  <time>{formatActivityTime(item.at)}</time>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
