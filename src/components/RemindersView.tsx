import { useState } from "react";
import { Bell, CalendarClock, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import type { AppSnapshot, Reminder, ReminderInput, ReminderRepeat, SoundName } from "../shared/types";
import { bridge } from "../useCompanion";
import { EmptyState, Toggle } from "./Controls";

const DAYS = ["日", "一", "二", "三", "四", "五", "六"];
const REPEAT_LABELS: Record<ReminderRepeat, string> = {
  once: "仅一次",
  daily: "每天",
  weekdays: "工作日",
  weekly: "每周",
};
const SOUND_LABELS: Record<SoundName, string> = {
  none: "无声音",
  meow: "喵声",
  purr: "呼噜",
  chime: "清脆铃声",
  crunch: "咔嚓",
  pop: "轻响",
  alert: "提示音",
};

function localDateValue(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function blankReminder(): ReminderInput {
  return {
    title: "",
    message: "",
    time: "09:00",
    repeat: "daily",
    date: localDateValue(),
    days: [1, 2, 3, 4, 5],
    enabled: true,
    sound: "chime",
  };
}

function toInput(reminder: Reminder): ReminderInput {
  return {
    id: reminder.id,
    title: reminder.title,
    message: reminder.message,
    time: reminder.time,
    repeat: reminder.repeat,
    date: reminder.date,
    days: reminder.days,
    enabled: reminder.enabled,
    sound: reminder.sound,
  };
}

function repeatSummary(reminder: Reminder): string {
  if (reminder.repeat !== "weekly") return REPEAT_LABELS[reminder.repeat];
  const labels = reminder.days.slice().sort().map((day) => `周${DAYS[day]}`).join("、");
  return labels || "每周";
}

export function RemindersView({ snapshot }: { snapshot: AppSnapshot }) {
  const [form, setForm] = useState<ReminderInput>(blankReminder);
  const editing = Boolean(form.id);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) return;
    await bridge.saveReminder(form);
    setForm(blankReminder());
  };

  const toggleDay = (day: number) => {
    setForm((value) => ({
      ...value,
      days: value.days.includes(day) ? value.days.filter((item) => item !== day) : [...value.days, day],
    }));
  };

  return (
    <div className="view split-view reminders-view">
      <section className="editor-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">计划</span>
            <h2>{editing ? "编辑提醒" : "新建提醒"}</h2>
          </div>
          {editing && (
            <button className="icon-button" type="button" title="取消编辑" onClick={() => setForm(blankReminder())}>
              <X size={18} />
            </button>
          )}
        </div>
        <form className="form-stack" onSubmit={save}>
          <label className="field">
            <span>名称</span>
            <input
              value={form.title}
              maxLength={40}
              placeholder="喝水"
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </label>
          <label className="field">
            <span>内容</span>
            <textarea
              value={form.message}
              maxLength={120}
              rows={3}
              placeholder="起来活动一下"
              onChange={(event) => setForm({ ...form, message: event.target.value })}
            />
          </label>
          <div className="field-grid two-columns">
            <label className="field">
              <span>时间</span>
              <input type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} />
            </label>
            <label className="field">
              <span>重复</span>
              <select
                value={form.repeat}
                onChange={(event) => setForm({ ...form, repeat: event.target.value as ReminderRepeat })}
              >
                {Object.entries(REPEAT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          {form.repeat === "once" && (
            <label className="field">
              <span>日期</span>
              <input
                type="date"
                value={form.date ?? localDateValue()}
                onChange={(event) => setForm({ ...form, date: event.target.value })}
              />
            </label>
          )}
          {form.repeat === "weekly" && (
            <div className="field">
              <span>星期</span>
              <div className="day-selector" role="group" aria-label="选择星期">
                {DAYS.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    className={form.days.includes(day) ? "is-selected" : ""}
                    aria-pressed={form.days.includes(day)}
                    onClick={() => toggleDay(day)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="field">
            <span>声音</span>
            <select value={form.sound} onChange={(event) => setForm({ ...form, sound: event.target.value as SoundName })}>
              {Object.entries(SOUND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <div className="form-toggle-row">
            <span>启用</span>
            <Toggle checked={form.enabled} label="启用提醒" onChange={(enabled) => setForm({ ...form, enabled })} />
          </div>
          <button className="primary-button" type="submit" disabled={!form.title.trim()}>
            {editing ? <Check size={17} /> : <Plus size={17} />}
            {editing ? "保存修改" : "添加提醒"}
          </button>
        </form>
      </section>

      <section className="list-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">提醒</span>
            <h2>计划列表</h2>
          </div>
          <span className="count-badge">{snapshot.reminders.length}</span>
        </div>
        {snapshot.reminders.length === 0 ? (
          <EmptyState icon={<CalendarClock size={22} />} title="还没有提醒" />
        ) : (
          <div className="entity-list">
            {snapshot.reminders.map((reminder) => (
              <article className={`entity-row ${reminder.enabled ? "" : "is-muted"}`} key={reminder.id}>
                <div className="entity-time">{reminder.time}</div>
                <div className="entity-main">
                  <strong>{reminder.title}</strong>
                  <small>{reminder.message || "小满提醒你时间到了"}</small>
                  <span><Bell size={13} />{repeatSummary(reminder)} · {SOUND_LABELS[reminder.sound]}</span>
                </div>
                <Toggle
                  checked={reminder.enabled}
                  label={`切换${reminder.title}`}
                  onChange={() => void bridge.toggleReminder(reminder.id)}
                />
                <button className="icon-button" type="button" title="编辑" onClick={() => setForm(toInput(reminder))}>
                  <Pencil size={16} />
                </button>
                <button className="icon-button danger" type="button" title="删除" onClick={() => void bridge.removeReminder(reminder.id)}>
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
