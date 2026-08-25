import type { ReactNode } from "react";

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle-control ${disabled ? "is-disabled" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span />
      </span>
      <span className="sr-only">{label}</span>
    </label>
  );
}

export function StatBar({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: "coral" | "green" | "blue";
}) {
  return (
    <div className="stat-line">
      <span className={`stat-icon tone-${tone}`}>{icon}</span>
      <span className="stat-name">{label}</span>
      <div className="stat-track" aria-label={`${label} ${Math.round(value)}`}>
        <span className={`tone-${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <strong>{Math.round(value)}</strong>
    </div>
  );
}

export function EmptyState({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="empty-state">
      {icon}
      <span>{title}</span>
    </div>
  );
}
