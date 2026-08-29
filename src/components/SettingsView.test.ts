import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "SettingsView.tsx"), "utf8");

describe("SettingsView ownership contract", () => {
  it("keeps Codex and application preferences in the settings view", () => {
    for (const label of ["偏好设置", "宠物配置", "Codex 回复通道", "任务面板", "会话监听", "声音与通知", "启动与权限"]) {
      expect(source).toContain(label);
    }
  });

  it("does not duplicate pet behavior controls owned by 桌宠功能", () => {
    for (const label of ["眼部跟随", "注视范围", "悬停跳跃次数", "待机动作", "自动睡觉", "互动游戏模式", "待机词条"]) {
      expect(source).not.toContain(label);
    }
  });

  it("preserves native and CLI Codex choices", () => {
    expect(source).toContain('value: "native", label: "原生窗口"');
    expect(source).toContain('value: "cli", label: "CLI 兼容"');
    expect(source).toContain('value: "native", label: "原生 Codex"');
  });

  it("exposes a visible application exit command", () => {
    expect(source).toContain("退出小满");
    expect(source).toContain("bridge.quitApp()");
  });
});
