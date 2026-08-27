import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const componentSource = readFileSync(resolve(__dirname, "SettingsView.tsx"), "utf8");
const stylesSource = readFileSync(resolve(__dirname, "../styles.css"), "utf8");

describe("SettingsView layout contract", () => {
  it("renders the required sections in two explicit vertical columns", () => {
    const leftColumnStart = componentSource.indexOf(
      '<div className="settings-column settings-column-left">',
    );
    const rightColumnStart = componentSource.indexOf(
      '<div className="settings-column settings-column-right">',
    );

    expect(leftColumnStart).toBeGreaterThanOrEqual(0);
    expect(rightColumnStart).toBeGreaterThan(leftColumnStart);

    const leftColumn = componentSource.slice(leftColumnStart, rightColumnStart);
    const rightColumn = componentSource.slice(rightColumnStart);

    expect(leftColumn.indexOf("<h2>工作方式</h2>")).toBeLessThan(leftColumn.indexOf("<h2>显示与注视</h2>"));
    expect(leftColumn.indexOf("<h2>显示与注视</h2>")).toBeLessThan(leftColumn.indexOf("<h2>移动动作</h2>"));
    expect(rightColumn.indexOf("<h2>待机动作</h2>")).toBeLessThan(rightColumn.indexOf("<h2>声音与通知</h2>"));
    expect(rightColumn.indexOf("<h2>声音与通知</h2>")).toBeLessThan(rightColumn.indexOf("<h2>监听来源</h2>"));
    expect(rightColumn.indexOf("<h2>监听来源</h2>")).toBeLessThan(rightColumn.indexOf("<h2>启动</h2>"));
  });

  it("keeps both settings columns stacked at the responsive breakpoint", () => {
    expect(stylesSource).toMatch(/\.settings-column\s*\{[\s\S]*flex-direction:\s*column;/);
    expect(stylesSource).toMatch(/@media \(max-width: 980px\)[\s\S]*\.settings-columns\s*\{\s*grid-template-columns:\s*1fr;/);
  });

  it("uses the clear gaze inactivity label while preserving its millisecond control", () => {
    expect(componentSource).toContain('label="鼠标静止多久停止跟随"');
    expect(componentSource).toContain("settings.gazeIdleResetMs");
    expect(componentSource).not.toContain('label="静止后回正"');
    expect(componentSource).toMatch(/min="500"[\s\S]*max="5000"[\s\S]*aria-label="鼠标静止多久停止跟随"/);
  });

  it("exposes the persisted one-to-five hover jump count", () => {
    expect(componentSource).toContain('label="悬停跳跃次数"');
    expect(componentSource).toContain('label="举前爪"');
    expect(componentSource).toContain("settings.hoverJumpCount");
    expect(componentSource).toContain("update({ hoverJumpCount: Number(event.target.value) })");
    expect(componentSource).toMatch(/aria-label="悬停跳跃次数"[\s\S]*min="1"[\s\S]*max="5"/);
  });
});
