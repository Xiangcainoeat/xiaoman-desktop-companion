import { useState } from "react";
import {
  BellRing,
  Code2,
  Eye,
  MessageCircle,
  Monitor,
  MousePointer2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Volume2,
} from "lucide-react";
import { DEFAULT_IDLE_PHRASES } from "../shared/domain";
import type { AppSnapshot, CompanionSettings } from "../shared/types";
import { bridge } from "../useCompanion";
import { Toggle } from "./Controls";

function update(patch: Partial<CompanionSettings>): void {
  void bridge.updateSettings(patch);
}

function FeatureToggle({
  icon,
  label,
  checked,
  onChange,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`feature-row ${disabled ? "is-disabled" : ""}`}>
      <span className="feature-icon">{icon}</span>
      <strong>{label}</strong>
      <Toggle checked={checked} label={label} disabled={disabled} onChange={onChange} />
    </div>
  );
}

export function FeaturesView({ snapshot }: { snapshot: AppSnapshot }) {
  const [phrase, setPhrase] = useState("");
  const settings = snapshot.settings;

  const addPhrase = () => {
    const value = phrase.trim().slice(0, 80);
    if (!value || snapshot.idlePhrases.includes(value) || snapshot.idlePhrases.length >= 40) return;
    setPhrase("");
    void bridge.updateIdlePhrases([...snapshot.idlePhrases, value]);
  };

  return (
    <div className="view features-view">
      <div className="features-grid">
        <section className="feature-section">
          <div className="section-heading">
            <div><span className="eyebrow">桌面</span><h2>显示与移动</h2></div>
          </div>
          <div className="feature-list">
            <FeatureToggle icon={<Monitor size={18} />} label="悬浮小满" checked={settings.overlayVisible} onChange={(overlayVisible) => update({ overlayVisible })} />
            <FeatureToggle icon={<Monitor size={18} />} label="始终置顶" checked={settings.alwaysOnTop} onChange={(alwaysOnTop) => update({ alwaysOnTop })} />
            <FeatureToggle icon={<Eye size={18} />} label="眼部跟随" checked={settings.gazeEnabled} onChange={(gazeEnabled) => update({ gazeEnabled })} />
            <FeatureToggle icon={<MousePointer2 size={18} />} label="拖动奔跑" checked={settings.dragRunEnabled} onChange={(dragRunEnabled) => update({ dragRunEnabled })} />
            <FeatureToggle icon={<Sparkles size={18} />} label="悬停跳跃" checked={settings.hoverJumpEnabled} onChange={(hoverJumpEnabled) => update({ hoverJumpEnabled })} />
          </div>
        </section>

        <section className="feature-section">
          <div className="section-heading">
            <div><span className="eyebrow">空闲时</span><h2>待机动作</h2></div>
          </div>
          <div className="feature-list">
            <FeatureToggle icon={<Sparkles size={18} />} label="待机动作" checked={settings.idleActionsEnabled} onChange={(idleActionsEnabled) => update({ idleActionsEnabled })} />
            <FeatureToggle icon={<Sparkles size={18} />} label="舔嘴" checked={settings.idleLickEnabled} disabled={!settings.idleActionsEnabled} onChange={(idleLickEnabled) => update({ idleLickEnabled })} />
            <FeatureToggle icon={<Eye size={18} />} label="眨眼" checked={settings.idleBlinkEnabled} disabled={!settings.idleActionsEnabled} onChange={(idleBlinkEnabled) => update({ idleBlinkEnabled })} />
            <FeatureToggle icon={<MousePointer2 size={18} />} label="挠头" checked={settings.idleScratchEnabled} disabled={!settings.idleActionsEnabled} onChange={(idleScratchEnabled) => update({ idleScratchEnabled })} />
            <FeatureToggle icon={<MessageCircle size={18} />} label="随机说话" checked={settings.idleSpeechEnabled} onChange={(idleSpeechEnabled) => update({ idleSpeechEnabled })} />
          </div>
        </section>

        <section className="feature-section">
          <div className="section-heading">
            <div><span className="eyebrow">提醒</span><h2>声音与通知</h2></div>
          </div>
          <div className="feature-list">
            <FeatureToggle icon={<Volume2 size={18} />} label="互动声音" checked={settings.soundEnabled} onChange={(soundEnabled) => update({ soundEnabled })} />
            <FeatureToggle icon={<BellRing size={18} />} label="提醒计划" checked={settings.remindersEnabled} onChange={(remindersEnabled) => update({ remindersEnabled })} />
            <FeatureToggle icon={<BellRing size={18} />} label="系统通知" checked={settings.systemNotifications} onChange={(systemNotifications) => update({ systemNotifications })} />
            <FeatureToggle icon={<Sparkles size={18} />} label="主动状态通知" checked={settings.proactiveNotifications} onChange={(proactiveNotifications) => update({ proactiveNotifications })} />
            <FeatureToggle icon={<Code2 size={18} />} label="Codex 完成通知" checked={settings.codexNotifications} onChange={(codexNotifications) => update({ codexNotifications })} />
          </div>
        </section>

        <section className="feature-section">
          <div className="section-heading">
            <div><span className="eyebrow">连接</span><h2>外部事件</h2></div>
          </div>
          <div className="feature-list">
            <FeatureToggle icon={<Code2 size={18} />} label="Codex 状态" checked={settings.monitorCodex} onChange={(monitorCodex) => update({ monitorCodex })} />
            <FeatureToggle icon={<Code2 size={18} />} label="Codex 任务与回复" checked={settings.codexSessionControls} onChange={(codexSessionControls) => update({ codexSessionControls })} />
            <FeatureToggle icon={<Monitor size={18} />} label="前台应用事件" checked={settings.monitorApps} onChange={(monitorApps) => update({ monitorApps })} />
          </div>
        </section>
      </div>

      <section className="phrase-section">
        <div className="section-heading">
          <div><span className="eyebrow">小满会说</span><h2>待机词条</h2></div>
          <span className="count-badge">{snapshot.idlePhrases.length}/40</span>
        </div>
        <div className="phrase-editor">
          <input
            type="text"
            maxLength={80}
            value={phrase}
            placeholder="添加一句话"
            aria-label="新的待机词条"
            onChange={(event) => setPhrase(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addPhrase();
            }}
          />
          <button className="primary-button" type="button" onClick={addPhrase} disabled={!phrase.trim() || snapshot.idlePhrases.length >= 40}>
            <Plus size={16} />
            添加
          </button>
          <button className="secondary-button" type="button" onClick={() => void bridge.updateIdlePhrases([...DEFAULT_IDLE_PHRASES])}>
            <RotateCcw size={16} />
            恢复默认
          </button>
        </div>
        <div className="phrase-list">
          {snapshot.idlePhrases.map((item) => (
            <div className="phrase-row" key={item}>
              <MessageCircle size={15} aria-hidden="true" />
              <span>{item}</span>
              <button
                className="icon-button"
                type="button"
                title="删除词条"
                aria-label={`删除词条：${item}`}
                onClick={() => void bridge.updateIdlePhrases(snapshot.idlePhrases.filter((value) => value !== item))}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
