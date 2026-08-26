import {
  BellRing,
  Code2,
  Eye,
  Gauge,
  Monitor,
  MousePointer2,
  Power,
  Sparkles,
  Volume2,
} from "lucide-react";
import type { AppSnapshot, CompanionSettings } from "../shared/types";
import { bridge } from "../useCompanion";
import { Toggle } from "./Controls";

function update(patch: Partial<CompanionSettings>): void {
  void bridge.updateSettings(patch);
}

function SettingsRow({
  icon,
  label,
  value,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-row">
      <span className="settings-icon">{icon}</span>
      <span className="settings-copy"><strong>{label}</strong>{value && <small>{value}</small>}</span>
      <div className="settings-control">{children}</div>
    </div>
  );
}

export function SettingsView({ snapshot }: { snapshot: AppSnapshot }) {
  const settings = snapshot.settings;
  return (
    <div className="view settings-view">
      <div className="settings-columns">
        <section className="settings-section">
          <div className="section-heading">
            <div><span className="eyebrow">悬浮小满</span><h2>显示与注视</h2></div>
          </div>
          <div className="settings-list">
            <SettingsRow icon={<Monitor size={18} />} label="显示悬浮窗">
              <Toggle checked={settings.overlayVisible} label="显示悬浮窗" onChange={(overlayVisible) => update({ overlayVisible })} />
            </SettingsRow>
            <SettingsRow icon={<MousePointer2 size={18} />} label="始终置顶">
              <Toggle checked={settings.alwaysOnTop} label="始终置顶" onChange={(alwaysOnTop) => update({ alwaysOnTop })} />
            </SettingsRow>
            <SettingsRow icon={<Eye size={18} />} label="跟随注视">
              <Toggle checked={settings.gazeEnabled} label="跟随注视" onChange={(gazeEnabled) => update({ gazeEnabled })} />
            </SettingsRow>
            <SettingsRow icon={<Eye size={18} />} label="注视范围" value={settings.gazeRange === "upper-180" ? "不低头" : "包含下方"}>
              <div className="segmented-control gaze-range-control" role="group" aria-label="注视范围">
                <button
                  type="button"
                  className={settings.gazeRange === "upper-180" ? "is-selected" : ""}
                  aria-pressed={settings.gazeRange === "upper-180"}
                  disabled={!settings.gazeEnabled}
                  onClick={() => update({ gazeRange: "upper-180" })}
                >
                  上半区 180°
                </button>
                <button
                  type="button"
                  className={settings.gazeRange === "full-360" ? "is-selected" : ""}
                  aria-pressed={settings.gazeRange === "full-360"}
                  disabled={!settings.gazeEnabled}
                  onClick={() => update({ gazeRange: "full-360" })}
                >
                  全向 360°
                </button>
              </div>
            </SettingsRow>
            <SettingsRow icon={<Gauge size={18} />} label="注视刷新率" value={`${settings.gazeFrameRate} Hz`}>
              <div className="segmented-control" role="group" aria-label="注视刷新率">
                {[30, 60].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    className={settings.gazeFrameRate === rate ? "is-selected" : ""}
                    aria-pressed={settings.gazeFrameRate === rate}
                    disabled={!settings.gazeEnabled}
                    onClick={() => update({ gazeFrameRate: rate as 30 | 60 })}
                  >
                    {rate}
                  </button>
                ))}
              </div>
            </SettingsRow>
            <SettingsRow icon={<Gauge size={18} />} label="动作刷新率" value={`${settings.animationFrameRate} Hz`}>
              <div className="segmented-control" role="group" aria-label="动作刷新率">
                {[30, 60].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    className={settings.animationFrameRate === rate ? "is-selected" : ""}
                    aria-pressed={settings.animationFrameRate === rate}
                    disabled={!settings.overlayVisible}
                    onClick={() => update({ animationFrameRate: rate as 30 | 60 })}
                  >
                    {rate}
                  </button>
                ))}
              </div>
            </SettingsRow>
            <SettingsRow icon={<Gauge size={18} />} label="跟随速度" value={`${settings.gazeSmoothingMs} ms`}>
              <input
                className="range-control"
                type="range"
                min="120"
                max="900"
                step="20"
                value={settings.gazeSmoothingMs}
                aria-label="跟随速度"
                disabled={!settings.gazeEnabled}
                onChange={(event) => update({ gazeSmoothingMs: Number(event.target.value) })}
              />
            </SettingsRow>
            <SettingsRow icon={<MousePointer2 size={18} />} label="中心死区" value={`${settings.gazeDeadzonePx} px`}>
              <input
                className="range-control"
                type="range"
                min="20"
                max="140"
                step="2"
                value={settings.gazeDeadzonePx}
                aria-label="中心死区"
                disabled={!settings.gazeEnabled}
                onChange={(event) => update({ gazeDeadzonePx: Number(event.target.value) })}
              />
            </SettingsRow>
            <SettingsRow icon={<MousePointer2 size={18} />} label="静止后回正" value={`${(settings.gazeIdleResetMs / 1000).toFixed(1)} 秒`}>
              <input
                className="range-control"
                type="range"
                min="500"
                max="5000"
                step="100"
                value={settings.gazeIdleResetMs}
                aria-label="静止后回正时间"
                disabled={!settings.gazeEnabled}
                onChange={(event) => update({ gazeIdleResetMs: Number(event.target.value) })}
              />
            </SettingsRow>
            <SettingsRow icon={<Gauge size={18} />} label="小满体型" value={`${settings.petSize} px`}>
              <input
                className="range-control"
                type="range"
                min="150"
                max="340"
                step="10"
                value={settings.petSize}
                aria-label="小满体型"
                onChange={(event) => update({ petSize: Number(event.target.value) })}
              />
            </SettingsRow>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-heading">
            <div><span className="eyebrow">原生反馈</span><h2>移动动作</h2></div>
          </div>
          <div className="settings-list">
            <SettingsRow icon={<MousePointer2 size={18} />} label="拖动时奔跑">
              <Toggle checked={settings.dragRunEnabled} label="拖动时奔跑" onChange={(dragRunEnabled) => update({ dragRunEnabled })} />
            </SettingsRow>
            <SettingsRow icon={<Sparkles size={18} />} label="悬停时跳跃">
              <Toggle checked={settings.hoverJumpEnabled} label="悬停时跳跃" onChange={(hoverJumpEnabled) => update({ hoverJumpEnabled })} />
            </SettingsRow>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-heading">
            <div><span className="eyebrow">空闲时</span><h2>待机动作</h2></div>
          </div>
          <div className="settings-list">
            <SettingsRow icon={<Sparkles size={18} />} label="启用待机动作">
              <Toggle checked={settings.idleActionsEnabled} label="启用待机动作" onChange={(idleActionsEnabled) => update({ idleActionsEnabled })} />
            </SettingsRow>
            <SettingsRow icon={<Sparkles size={18} />} label="舔嘴">
              <Toggle checked={settings.idleLickEnabled} label="舔嘴" disabled={!settings.idleActionsEnabled} onChange={(idleLickEnabled) => update({ idleLickEnabled })} />
            </SettingsRow>
            <SettingsRow icon={<Eye size={18} />} label="眨眼">
              <Toggle checked={settings.idleBlinkEnabled} label="眨眼" disabled={!settings.idleActionsEnabled} onChange={(idleBlinkEnabled) => update({ idleBlinkEnabled })} />
            </SettingsRow>
            <SettingsRow icon={<MousePointer2 size={18} />} label="挠头">
              <Toggle checked={settings.idleScratchEnabled} label="挠头" disabled={!settings.idleActionsEnabled} onChange={(idleScratchEnabled) => update({ idleScratchEnabled })} />
            </SettingsRow>
            <SettingsRow icon={<Gauge size={18} />} label="动作间隔" value={`约 ${settings.idleActionIntervalSec} 秒`}>
              <input
                className="range-control"
                type="range"
                min="10"
                max="120"
                step="2"
                value={settings.idleActionIntervalSec}
                aria-label="待机动作间隔"
                disabled={!settings.idleActionsEnabled}
                onChange={(event) => update({ idleActionIntervalSec: Number(event.target.value) })}
              />
            </SettingsRow>
            <SettingsRow icon={<Sparkles size={18} />} label="随机说话">
              <Toggle checked={settings.idleSpeechEnabled} label="随机说话" onChange={(idleSpeechEnabled) => update({ idleSpeechEnabled })} />
            </SettingsRow>
            <SettingsRow icon={<Gauge size={18} />} label="说话间隔" value={`约 ${settings.idleSpeechIntervalSec} 秒`}>
              <input
                className="range-control"
                type="range"
                min="15"
                max="180"
                step="5"
                value={settings.idleSpeechIntervalSec}
                aria-label="随机说话间隔"
                disabled={!settings.idleSpeechEnabled}
                onChange={(event) => update({ idleSpeechIntervalSec: Number(event.target.value) })}
              />
            </SettingsRow>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-heading">
            <div><span className="eyebrow">反馈</span><h2>声音与通知</h2></div>
          </div>
          <div className="settings-list">
            <SettingsRow icon={<Volume2 size={18} />} label="互动声音">
              <Toggle checked={settings.soundEnabled} label="互动声音" onChange={(soundEnabled) => update({ soundEnabled })} />
            </SettingsRow>
            <SettingsRow icon={<Volume2 size={18} />} label="音量" value={`${Math.round(settings.volume * 100)}%`}>
              <input
                className="range-control"
                type="range"
                min="0"
                max="1"
                step="0.02"
                value={settings.volume}
                aria-label="音量"
                disabled={!settings.soundEnabled}
                onChange={(event) => update({ volume: Number(event.target.value) })}
              />
            </SettingsRow>
            <SettingsRow icon={<BellRing size={18} />} label="系统通知">
              <Toggle
                checked={settings.systemNotifications}
                label="系统通知"
                onChange={(systemNotifications) => update({ systemNotifications })}
              />
            </SettingsRow>
            <SettingsRow icon={<Sparkles size={18} />} label="主动状态通知">
              <Toggle
                checked={settings.proactiveNotifications}
                label="主动状态通知"
                onChange={(proactiveNotifications) => update({ proactiveNotifications })}
              />
            </SettingsRow>
            <SettingsRow icon={<Code2 size={18} />} label="Codex 完成通知">
              <Toggle
                checked={settings.codexNotifications}
                label="Codex 完成通知"
                onChange={(codexNotifications) => update({ codexNotifications })}
              />
            </SettingsRow>
          </div>
          <button className="secondary-button settings-test-button" type="button" onClick={() => void bridge.testNotification()}>
            <BellRing size={16} />
            测试通知与声音
          </button>
        </section>

        <section className="settings-section">
          <div className="section-heading">
            <div><span className="eyebrow">事件</span><h2>监听来源</h2></div>
          </div>
          <div className="settings-list">
            <SettingsRow icon={<Code2 size={18} />} label="Codex 会话状态" value="只读">
              <Toggle checked={settings.monitorCodex} label="Codex 会话状态" onChange={(monitorCodex) => update({ monitorCodex })} />
            </SettingsRow>
            <SettingsRow icon={<Code2 size={18} />} label="Codex 任务与回复">
              <Toggle
                checked={settings.codexSessionControls}
                label="Codex 任务与回复"
                onChange={(codexSessionControls) => update({ codexSessionControls })}
              />
            </SettingsRow>
            <SettingsRow icon={<Power size={18} />} label="前台应用切换">
              <Toggle checked={settings.monitorApps} label="前台应用切换" onChange={(monitorApps) => update({ monitorApps })} />
            </SettingsRow>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-heading">
            <div><span className="eyebrow">应用</span><h2>启动</h2></div>
          </div>
          <div className="settings-list">
            <SettingsRow icon={<Power size={18} />} label="登录时启动">
              <Toggle checked={settings.startAtLogin} label="登录时启动" onChange={(startAtLogin) => update({ startAtLogin })} />
            </SettingsRow>
            <SettingsRow icon={<Code2 size={18} />} label="Codex 原生宠物包" value="保持独立">
              <span className="fixed-status">未修改</span>
            </SettingsRow>
          </div>
        </section>
      </div>
    </div>
  );
}
