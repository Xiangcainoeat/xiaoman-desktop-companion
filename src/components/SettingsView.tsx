import {
  BellRing,
  Code2,
  Eye,
  Monitor,
  Power,
  ShieldCheck,
  Sparkles,
  Volume2,
} from "lucide-react";
import type { ReactNode } from "react";
import type { AppSnapshot, CompanionSettings } from "../shared/types";
import { bridge } from "../useCompanion";
import { Toggle } from "./Controls";
import { PetPackView } from "./PetPackView";
import { PetStudioLauncher } from "./PetStudioLauncher";

function update(patch: Partial<CompanionSettings>): void {
  void bridge.updateSettings(patch);
}

function SettingsRow({
  icon,
  label,
  value,
  children,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <span className="settings-icon">{icon}</span>
      <span className="settings-copy"><strong>{label}</strong>{value && <small>{value}</small>}</span>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function SettingsSection({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section section-block">
      <div className="section-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div></div>
      <div className="settings-list">{children}</div>
    </section>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented-control settings-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" className={value === option.value ? "is-selected" : ""} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}
    </div>
  );
}

export function SettingsView({ snapshot }: { snapshot: AppSnapshot }) {
  const settings = snapshot.settings;
  return (
    <div className="view settings-view">
      <div className="view-intro">
        <div>
          <span className="eyebrow">偏好设置</span>
          <h2>连接和应用方式</h2>
          <p>这里管理 Codex 通道、窗口、声音和系统监听；桌宠本身的行为请到桌宠功能调整。</p>
        </div>
        <span className="feature-summary"><ShieldCheck size={16} />配置会自动保存</span>
      </div>

      <div className="settings-columns">
          <SettingsSection eyebrow="配置档案" title="工作方式">
            <SettingsRow icon={<Code2 size={18} />} label="Codex 回复通道" value={settings.codexReplyTransport === "native" ? "回到原生窗口" : "CLI 兼容回退"}>
              <Segmented
                label="Codex 回复通道"
                value={settings.codexReplyTransport}
                options={[{ value: "native", label: "原生窗口" }, { value: "cli", label: "CLI 兼容" }]}
                onChange={(codexReplyTransport) => update({ codexReplyTransport: codexReplyTransport as CompanionSettings["codexReplyTransport"] })}
              />
            </SettingsRow>
            <SettingsRow icon={<Code2 size={18} />} label="任务面板" value="显示正在执行的 Codex 会话">
              <Toggle checked={settings.codexSessionControls} label="任务面板" onChange={(codexSessionControls) => update({ codexSessionControls })} />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection eyebrow="窗口" title="显示方式">
            <SettingsRow icon={<Eye size={18} />} label="显示小满悬浮窗">
              <Toggle checked={settings.overlayVisible} label="显示小满悬浮窗" onChange={(overlayVisible) => update({ overlayVisible })} />
            </SettingsRow>
            <SettingsRow icon={<Monitor size={18} />} label="始终置顶" value="让小满保持在其他窗口上方">
              <Toggle checked={settings.alwaysOnTop} label="始终置顶" onChange={(alwaysOnTop) => update({ alwaysOnTop })} />
            </SettingsRow>
            <SettingsRow icon={<Code2 size={18} />} label="原生 Codex 宠物包" value="独立保留，不会被增强配置覆盖">
              <span className="fixed-status">未修改</span>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection eyebrow="Codex" title="会话监听">
            <SettingsRow icon={<Code2 size={18} />} label="Codex 会话状态" value="只读监听任务状态">
              <Toggle checked={settings.monitorCodex} label="Codex 会话状态" onChange={(monitorCodex) => update({ monitorCodex })} />
            </SettingsRow>
            <SettingsRow icon={<BellRing size={18} />} label="Codex 完成通知">
              <Toggle checked={settings.codexNotifications} label="Codex 完成通知" onChange={(codexNotifications) => update({ codexNotifications })} />
            </SettingsRow>
            <SettingsRow icon={<Power size={18} />} label="前台应用事件" value="根据应用切换小满状态">
              <Toggle checked={settings.monitorApps} label="前台应用事件" onChange={(monitorApps) => update({ monitorApps })} />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection eyebrow="反馈" title="声音与通知">
            <SettingsRow icon={<Volume2 size={18} />} label="互动声音">
              <Toggle checked={settings.soundEnabled} label="互动声音" onChange={(soundEnabled) => update({ soundEnabled })} />
            </SettingsRow>
            <SettingsRow icon={<Volume2 size={18} />} label="音量" value={`${Math.round(settings.volume * 100)}%`}>
              <input className="range-control" type="range" min="0" max="1" step="0.02" value={settings.volume} aria-label="音量" disabled={!settings.soundEnabled} onChange={(event) => update({ volume: Number(event.target.value) })} />
            </SettingsRow>
            <SettingsRow icon={<BellRing size={18} />} label="系统通知">
              <Toggle checked={settings.systemNotifications} label="系统通知" onChange={(systemNotifications) => update({ systemNotifications })} />
            </SettingsRow>
            <SettingsRow icon={<Sparkles size={18} />} label="主动状态通知" value="饥饿、疲劳和长任务提醒">
              <Toggle checked={settings.proactiveNotifications} label="主动状态通知" onChange={(proactiveNotifications) => update({ proactiveNotifications })} />
            </SettingsRow>
            <button className="secondary-button settings-test-button" type="button" onClick={() => void bridge.testNotification()}><BellRing size={16} />测试通知与声音</button>
          </SettingsSection>

          <SettingsSection eyebrow="系统" title="启动与权限">
            <SettingsRow icon={<Power size={18} />} label="登录时启动" value="登录 macOS 后自动运行">
              <Toggle checked={settings.startAtLogin} label="登录时启动" onChange={(startAtLogin) => update({ startAtLogin })} />
            </SettingsRow>
            <SettingsRow icon={<ShieldCheck size={18} />} label="本机数据" value="配置和养成数据保存在本机">
              <span className="fixed-status">本机保存</span>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection eyebrow="应用" title="应用控制">
            <SettingsRow icon={<Power size={18} />} label="退出小满" value="关闭桌面伴侣和所有窗口">
              <button
                className="secondary-button settings-quit-button"
                type="button"
                title="退出小满桌面伴侣"
                aria-label="退出小满桌面伴侣"
                onClick={() => bridge.quitApp()}
              >
                <Power size={16} aria-hidden="true" />
                <span>退出小满</span>
              </button>
            </SettingsRow>
          </SettingsSection>
      </div>
      <PetPackView snapshot={snapshot} />
      <PetStudioLauncher />
    </div>
  );
}
