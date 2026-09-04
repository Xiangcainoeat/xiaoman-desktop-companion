import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./OnlineGameWorkspace.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("联机房间工作区", () => {
  it("使用单列侧栏并把准备操作放在等待遮罩和房间席位中", () => {
    expect(source).not.toContain('type SidebarTab = "mode" | "room"');
    expect(source).not.toContain("online-game-sidebar-tabs");
    expect(source).toContain("online-game-ready-panel");
    expect(source).toContain("online-game-overlay-ready");
    expect(source).toContain('room.status === "waiting" || room.status === "ready"');
    expect(css).toContain(".online-game-sidebar-scroll {\n  display: flex;");
    expect(css).not.toContain("grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 22px;");
  });

  it("删除未实现的棋谱功能并提供统一结束弹窗和再战邀请状态", () => {
    expect(source).not.toContain("导出棋谱");
    expect(source).not.toContain(">回放<");
    expect(source).toContain("online-game-result-dialog");
    expect(source).toContain("邀请再来一局");
    expect(source).toContain("接受并开始");
    expect(source).toContain("等待对方接受");
  });

  it("保留需要对手同意的悔棋和明确的认输操作", () => {
    expect(source).toContain("申请悔棋");
    expect(source).toContain("同意悔棋");
    expect(source).toContain("拒绝悔棋");
    expect(source).toContain("认输并结束本局");
  });
});
