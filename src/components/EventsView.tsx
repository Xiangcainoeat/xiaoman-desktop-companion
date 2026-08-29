import { useState } from "react";
import { AppWindow, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { STATE_LABELS } from "../shared/domain";
import type { AppRule, AppRuleInput, AppSnapshot, PetState, SoundName } from "../shared/types";
import { bridge } from "../useCompanion";
import { EmptyState, Toggle } from "./Controls";

const RULE_STATES: PetState[] = ["focused", "happy", "playful", "startled", "celebrating", "waiting", "reminder"];
const RULE_SOUNDS: Array<{ value: SoundName; label: string }> = [
  { value: "none", label: "无声音" },
  { value: "pop", label: "轻响" },
  { value: "meow", label: "喵声" },
  { value: "chime", label: "清脆铃声" },
  { value: "alert", label: "提示音" },
];

function blankRule(): AppRuleInput {
  return {
    name: "",
    appPattern: "",
    state: "focused",
    message: "",
    sound: "none",
    notify: false,
    enabled: true,
  };
}

function toInput(rule: AppRule): AppRuleInput {
  return { ...rule };
}

export function EventsView({ snapshot }: { snapshot: AppSnapshot }) {
  const [form, setForm] = useState<AppRuleInput>(blankRule);
  const editing = Boolean(form.id);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.appPattern.trim()) return;
    await bridge.saveRule(form);
    setForm(blankRule());
  };

  return (
    <div className="view split-view events-view">
      <section className="editor-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">外部应用</span>
            <h2>{editing ? "编辑规则" : "新建规则"}</h2>
          </div>
          {editing && (
            <button className="icon-button" type="button" title="取消编辑" onClick={() => setForm(blankRule())}>
              <X size={18} />
            </button>
          )}
        </div>
        <form className="form-stack" onSubmit={save}>
          <label className="field">
            <span>名称</span>
            <input
              value={form.name}
              maxLength={32}
              placeholder="设计软件"
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label className="field">
            <span>应用名关键词</span>
            <input
              value={form.appPattern}
              maxLength={160}
              placeholder="Figma|Sketch"
              onChange={(event) => setForm({ ...form, appPattern: event.target.value })}
            />
          </label>
          <label className="field">
            <span>小满状态</span>
            <select value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value as PetState })}>
              {RULE_STATES.map((state) => <option key={state} value={state}>{STATE_LABELS[state]}</option>)}
            </select>
          </label>
          <label className="field">
            <span>气泡内容</span>
            <input
              value={form.message}
              maxLength={100}
              placeholder="小满陪你专注"
              onChange={(event) => setForm({ ...form, message: event.target.value })}
            />
          </label>
          <label className="field">
            <span>声音</span>
            <select value={form.sound} onChange={(event) => setForm({ ...form, sound: event.target.value as SoundName })}>
              {RULE_SOUNDS.map((sound) => <option key={sound.value} value={sound.value}>{sound.label}</option>)}
            </select>
          </label>
          <div className="form-toggle-row">
            <span>系统通知</span>
            <Toggle checked={form.notify} label="系统通知" onChange={(notify) => setForm({ ...form, notify })} />
          </div>
          <div className="form-toggle-row">
            <span>启用</span>
            <Toggle checked={form.enabled} label="启用规则" onChange={(enabled) => setForm({ ...form, enabled })} />
          </div>
          <button className="primary-button" type="submit" disabled={!form.name.trim() || !form.appPattern.trim()}>
            {editing ? <Check size={17} /> : <Plus size={17} />}
            {editing ? "保存修改" : "添加规则"}
          </button>
        </form>
      </section>

      <section className="list-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">自动响应</span>
            <h2>应用规则</h2>
          </div>
          <span className="count-badge">{snapshot.appRules.length}</span>
        </div>
        {snapshot.appRules.length === 0 ? (
          <EmptyState icon={<AppWindow size={22} />} title="还没有应用规则" />
        ) : (
          <div className="entity-list">
            {snapshot.appRules.map((rule) => (
              <article className={`entity-row app-rule-row ${rule.enabled ? "" : "is-muted"}`} key={rule.id}>
                <span className={`rule-state-dot state-${rule.state}`} />
                <div className="entity-main">
                  <strong>{rule.name}</strong>
                  <small>{rule.message || STATE_LABELS[rule.state]}</small>
                  <span>{rule.appPattern} · {STATE_LABELS[rule.state]}</span>
                </div>
                <Toggle checked={rule.enabled} label={`切换${rule.name}`} onChange={() => void bridge.toggleRule(rule.id)} />
                <button className="icon-button" type="button" title="编辑" onClick={() => setForm(toInput(rule))}>
                  <Pencil size={16} />
                </button>
                <button className="icon-button danger" type="button" title="删除" onClick={() => void bridge.removeRule(rule.id)}>
                  <Trash2 size={16} />
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
