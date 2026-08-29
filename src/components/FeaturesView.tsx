import {
  Eye,
  Gamepad2,
  Gauge,
  MessageCircle,
  MousePointer2,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { DEFAULT_IDLE_PHRASES } from "../shared/domain";
import type { AppSnapshot, CompanionSettings } from "../shared/types";
import { bridge } from "../useCompanion";
import { ActionPreview } from "./ActionPreview";
import { Toggle } from "./Controls";

function update(patch: Partial<CompanionSettings>): void {
  void bridge.updateSettings(patch);
}

function FeatureSection({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="feature-section section-block">
      <div className="section-heading feature-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
          {description && <p className="section-description">{description}</p>}
        </div>
      </div>
      <div className="feature-list">{children}</div>
    </section>
  );
}

function FeatureToggle({
  icon,
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`feature-row ${disabled ? "is-disabled" : ""}`}>
      <span className="feature-icon">{icon}</span>
      <span className="feature-copy">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <Toggle checked={checked} label={label} disabled={disabled} onChange={onChange} />
    </div>
  );
}

function FeatureRange({
  icon,
  label,
  value,
  min,
  max,
  step,
  display,
  disabled = false,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className={`feature-row feature-range-row ${disabled ? "is-disabled" : ""}`}>
      <span className="feature-icon">{icon}</span>
      <span className="feature-copy"><strong>{label}</strong><small>{display}</small></span>
      <input
        className="range-control"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function FeatureSegmented({
  label,
  options,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className={`feature-row feature-segment-row ${disabled ? "is-disabled" : ""}`}>
      <span className="feature-icon"><Gauge size={18} /></span>
      <span className="feature-copy"><strong>{label}</strong><small>选择小满响应方式</small></span>
      <div className="segmented-control feature-segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={value === option.value ? "is-selected" : ""}
            aria-pressed={value === option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FeaturesView({ snapshot }: { snapshot: AppSnapshot }) {
  const [phrase, setPhrase] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const settings = snapshot.settings;

  const addPhrase = () => {
    const value = phrase.trim().slice(0, 80);
    if (!value || snapshot.idlePhrases.includes(value) || snapshot.idlePhrases.length >= 40) return;
    setPhrase("");
    void bridge.updateIdlePhrases([...snapshot.idlePhrases, value]);
  };

  return (
    <div className="view features-view">
      <div className="view-intro">
        <div>
          <span className="eyebrow">桌宠功能</span>
          <h2>决定小满怎么陪你</h2>
          <p>这里控制注视、动作、休息和游戏；Codex 连接方式请到偏好设置调整。</p>
        </div>
        <span className="feature-summary"><Sparkles size={16} />{settings.petProfile === "native" ? "原生配置" : "增强配置"}</span>
      </div>

      <div className="features-grid">
        <FeatureSection eyebrow="注意力" title="注视跟随" description="小满会根据鼠标最后一次移动的位置调整视线。">
          <FeatureToggle icon={<Eye size={18} />} label="眼部跟随" hint="关闭后保持原本的静态待机视线" checked={settings.gazeEnabled} onChange={(gazeEnabled) => update({ gazeEnabled })} />
          <FeatureSegmented
            label="注视范围"
            value={settings.gazeRange}
            disabled={!settings.gazeEnabled}
            options={[{ value: "upper-180", label: "上半区 180°" }, { value: "full-360", label: "全向 360°" }]}
            onChange={(gazeRange) => update({ gazeRange: gazeRange as CompanionSettings["gazeRange"] })}
          />
          <FeatureSegmented
            label="注视刷新率"
            value={String(settings.gazeFrameRate)}
            disabled={!settings.gazeEnabled}
            options={[{ value: "30", label: "30 Hz" }, { value: "60", label: "60 Hz" }]}
            onChange={(value) => update({ gazeFrameRate: Number(value) as 30 | 60 })}
          />
          <FeatureRange icon={<Gauge size={18} />} label="跟随响应" value={settings.gazeSmoothingMs} min={120} max={900} step={20} display={`${settings.gazeSmoothingMs} ms`} disabled={!settings.gazeEnabled} onChange={(gazeSmoothingMs) => update({ gazeSmoothingMs })} />
          <FeatureRange icon={<MousePointer2 size={18} />} label="中心死区" value={settings.gazeDeadzonePx} min={20} max={140} step={2} display={`${settings.gazeDeadzonePx} px`} disabled={!settings.gazeEnabled} onChange={(gazeDeadzonePx) => update({ gazeDeadzonePx })} />
          <FeatureRange icon={<MousePointer2 size={18} />} label="鼠标静止多久停止跟随" value={settings.gazeIdleResetMs} min={500} max={5000} step={100} display={`${(settings.gazeIdleResetMs / 1000).toFixed(1)} 秒`} disabled={!settings.gazeEnabled} onChange={(gazeIdleResetMs) => update({ gazeIdleResetMs })} />
        </FeatureSection>

        <FeatureSection eyebrow="动作反馈" title="移动与悬停" description="保留原生桌宠的拖动奔跑和悬停跳跃反馈。">
          <FeatureToggle icon={<MousePointer2 size={18} />} label="拖动时奔跑" hint="按住小满移动时播放跑步动作" checked={settings.dragRunEnabled} onChange={(dragRunEnabled) => update({ dragRunEnabled })} />
          <FeatureToggle icon={<Sparkles size={18} />} label="悬停时跳跃" hint="鼠标进入小满范围时跳跃" checked={settings.hoverJumpEnabled} onChange={(hoverJumpEnabled) => update({ hoverJumpEnabled })} />
          <FeatureRange icon={<Gauge size={18} />} label="悬停跳跃次数" value={settings.hoverJumpCount} min={1} max={5} step={1} display={`${settings.hoverJumpCount} 次`} disabled={!settings.hoverJumpEnabled} onChange={(hoverJumpCount) => update({ hoverJumpCount })} />
          <FeatureRange icon={<Gauge size={18} />} label="小满体型" value={settings.petSize} min={150} max={340} step={10} display={`${settings.petSize} px`} onChange={(petSize) => update({ petSize })} />
        </FeatureSection>

        <FeatureSection eyebrow="空闲时" title="待机动作" description="增强配置才会播放额外动作，原生 Codex 配置保持原样。">
          <FeatureToggle icon={<Sparkles size={18} />} label="启用待机动作" checked={settings.idleActionsEnabled} disabled={settings.petProfile !== "enhanced"} onChange={(idleActionsEnabled) => update({ idleActionsEnabled })} />
          <FeatureToggle icon={<Sparkles size={18} />} label="伸舌头舔" checked={settings.idleLickEnabled} disabled={!settings.idleActionsEnabled || settings.petProfile !== "enhanced"} onChange={(idleLickEnabled) => update({ idleLickEnabled })} />
          <FeatureToggle icon={<Eye size={18} />} label="眨眼睛" checked={settings.idleBlinkEnabled} disabled={!settings.idleActionsEnabled || settings.petProfile !== "enhanced"} onChange={(idleBlinkEnabled) => update({ idleBlinkEnabled })} />
          <FeatureToggle icon={<MousePointer2 size={18} />} label="举起前爪" checked={settings.idleScratchEnabled} disabled={!settings.idleActionsEnabled || settings.petProfile !== "enhanced"} onChange={(idleScratchEnabled) => update({ idleScratchEnabled })} />
          <FeatureRange icon={<Gauge size={18} />} label="待机动作间隔" value={settings.idleActionIntervalSec} min={10} max={120} step={2} display={`约 ${settings.idleActionIntervalSec} 秒`} disabled={!settings.idleActionsEnabled || settings.petProfile !== "enhanced"} onChange={(idleActionIntervalSec) => update({ idleActionIntervalSec })} />
          <FeatureToggle icon={<MessageCircle size={18} />} label="随机说话" checked={settings.idleSpeechEnabled} onChange={(idleSpeechEnabled) => update({ idleSpeechEnabled })} />
          <FeatureRange icon={<Gauge size={18} />} label="说话间隔" value={settings.idleSpeechIntervalSec} min={15} max={180} step={5} display={`约 ${settings.idleSpeechIntervalSec} 秒`} disabled={!settings.idleSpeechEnabled} onChange={(idleSpeechIntervalSec) => update({ idleSpeechIntervalSec })} />
        </FeatureSection>

        <FeatureSection eyebrow="休息与玩耍" title="生活节奏" description="让小满在你离开电脑后睡觉，也可以随时开启互动小游戏。">
          <FeatureToggle icon={<Sparkles size={18} />} label="自动睡觉" hint="系统空闲达到阈值后蜷成一团休息" checked={settings.autoSleepEnabled} onChange={(autoSleepEnabled) => update({ autoSleepEnabled })} />
          <FeatureRange icon={<Gauge size={18} />} label="自动睡觉等待" value={settings.autoSleepAfterMin} min={5} max={180} step={5} display={`${settings.autoSleepAfterMin} 分钟无活动`} disabled={!settings.autoSleepEnabled} onChange={(autoSleepAfterMin) => update({ autoSleepAfterMin })} />
          <FeatureToggle icon={<Gamepad2 size={18} />} label="互动游戏模式" hint="开启后可在互动游戏页玩内置小游戏和独立棋盘游戏" checked={settings.gameModeEnabled} onChange={(gameModeEnabled) => update({ gameModeEnabled })} />
        </FeatureSection>
      </div>

      <section className="phrase-section section-block">
        <div className="section-heading">
          <div><span className="eyebrow">小满会说</span><h2>待机词条</h2><p className="section-description">随机说话会从这里抽取内容，最多保存 40 条。</p></div>
          <span className="count-badge">{snapshot.idlePhrases.length}/40</span>
        </div>
        <div className="phrase-editor">
          <input type="text" maxLength={80} value={phrase} placeholder="添加一句话" aria-label="新的待机词条" onChange={(event) => setPhrase(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addPhrase(); }} />
          <button className="primary-button" type="button" onClick={addPhrase} disabled={!phrase.trim() || snapshot.idlePhrases.length >= 40}><Plus size={16} />添加</button>
          <button className="secondary-button" type="button" onClick={() => void bridge.updateIdlePhrases([...DEFAULT_IDLE_PHRASES])}><RotateCcw size={16} />恢复默认</button>
        </div>
        <div className="phrase-list">
          {snapshot.idlePhrases.map((item) => (
            <div className="phrase-row" key={item}>
              <MessageCircle size={15} aria-hidden="true" /><span>{item}</span>
              <button className="icon-button" type="button" title="删除词条" aria-label={`删除词条：${item}`} onClick={() => void bridge.updateIdlePhrases(snapshot.idlePhrases.filter((value) => value !== item))}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      </section>

      <section className="preview-section section-block">
        <div className="section-heading">
          <div><span className="eyebrow">确认动作</span><h2>动作预览</h2><p className="section-description">逐个点选，查看小满实际会播放的动作。</p></div>
          <button className="secondary-button" type="button" onClick={() => setShowPreview((value) => !value)}><Play size={16} />{showPreview ? "收起预览" : "打开预览"}</button>
        </div>
        {showPreview && <ActionPreview settings={settings} onClose={() => setShowPreview(false)} />}
      </section>
    </div>
  );
}
