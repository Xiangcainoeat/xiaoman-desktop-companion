import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./OnlineGameWorkspace.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

type CssRule = { selectors: string[]; declarations: string };

function openingTagContaining(markup: string, className: string): string {
  const classIndex = markup.indexOf(className);
  expect(classIndex).toBeGreaterThanOrEqual(0);
  const start = markup.lastIndexOf("<", classIndex);
  const end = markup.indexOf(">", classIndex);
  return markup.slice(start, end + 1);
}

function extractAtRuleBlocks(styles: string, atRule: string): Array<{ header: string; body: string }> {
  const blocks: Array<{ header: string; body: string }> = [];
  let cursor = 0;

  while (cursor < styles.length) {
    const start = styles.indexOf(atRule, cursor);
    if (start < 0) break;
    const openingBrace = styles.indexOf("{", start);
    if (openingBrace < 0) break;

    let depth = 1;
    let end = openingBrace + 1;
    while (end < styles.length && depth > 0) {
      if (styles[end] === "{") depth += 1;
      if (styles[end] === "}") depth -= 1;
      end += 1;
    }

    blocks.push({
      header: styles.slice(start, openingBrace),
      body: styles.slice(openingBrace + 1, end - 1),
    });
    cursor = end;
  }

  return blocks;
}

function withoutAtRuleBlocks(styles: string, atRule: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < styles.length) {
    const start = styles.indexOf(atRule, cursor);
    if (start < 0) return result + styles.slice(cursor);
    result += styles.slice(cursor, start);

    const openingBrace = styles.indexOf("{", start);
    if (openingBrace < 0) return result;
    let depth = 1;
    let end = openingBrace + 1;
    while (end < styles.length && depth > 0) {
      if (styles[end] === "{") depth += 1;
      if (styles[end] === "}") depth -= 1;
      end += 1;
    }
    cursor = end;
  }

  return result;
}

function flatCssRules(styles: string): CssRule[] {
  const rules: CssRule[] = [];
  const matcher = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(styles))) {
    const selectorText = match[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!selectorText || selectorText.startsWith("@")) continue;
    rules.push({
      selectors: selectorText.split(",").map((selector) => selector.trim()),
      declarations: match[2],
    });
  }

  return rules;
}

function isPlayingSelector(selector: string): boolean {
  return /\.online-game-workspace(?=[^,{]*(?:\.is-(?:room-)?playing|data-(?:room-)?status\s*=\s*["']playing["']|data-focus-mode\s*=\s*["']game["']))/.test(selector);
}

function targetsClass(selector: string, className: string): boolean {
  return new RegExp(`\\.${className}(?![\\w-])`).test(selector);
}

function targetsClassAsSubject(selector: string, className: string): boolean {
  const withoutPseudoElement = selector.replace(/::[\w-]+(?:\([^)]*\))?\s*$/, "").trim();
  return new RegExp(`\\.${className}(?![\\w-])(?:\\[[^\\]]+\\]|\\.[\\w-]+)*\\s*$`).test(withoutPseudoElement);
}

function viewportAwareBoardValue(styles: string): string | undefined {
  const declarations = flatCssRules(styles)
    .filter(({ selectors, declarations: value }) => (
      selectors.some((selector) => /online-game-board|reference-board/.test(selector))
      || /--[\w-]*board[\w-]*\s*:/.test(value)
    ))
    .map(({ declarations: value }) => value)
    .join("\n");
  const candidates = [...declarations.matchAll(/(?:--[\w-]*board[\w-]*|(?:max-)?(?:inline-size|width|height))\s*:\s*([^;]+)/g)]
    .map((match) => match[1]);
  return candidates.find((value) => /(?:d?v[wh]|sv[wh]|cq[wh])/.test(value) && /(?:min|clamp|calc)\(/.test(value));
}

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

  it("在工作区根节点暴露房间状态供响应式样式选择", () => {
    const workspaceTag = openingTagContaining(source, "online-game-workspace");
    const exposesDataStatus = /\bdata-(?:room-)?status\s*=\s*\{\s*room\.status\s*\}/.test(workspaceTag);
    const exposesStatusClass = /\bclassName\s*=\s*\{[\s\S]*room\.status[\s\S]*(?:is-playing|is-\$\{room\.status\})/.test(workspaceTag);

    expect(exposesDataStatus || exposesStatusClass).toBe(true);
  });

  it("对局中的移动端进入专注布局且只收起次要信息", () => {
    const workspaceTag = openingTagContaining(source, "online-game-workspace");
    const mobileCss = extractAtRuleBlocks(css, "@media")
      .filter(({ header }) => {
        const maxWidth = header.match(/max-width\s*:\s*(\d+)px/)?.[1];
        return maxWidth != null && Number(maxWidth) <= 760;
      })
      .map(({ body }) => body)
      .join("\n");
    const mobileRules = flatCssRules(mobileCss);
    const hiddenWhilePlaying = mobileRules.flatMap(({ selectors, declarations }) => (
      /display\s*:\s*none(?:\s*!important)?\s*;?/.test(declarations)
        ? selectors.filter(isPlayingSelector)
        : []
    ));
    const focusFollowsPlayingStatus = /data-focus-mode\s*=\s*\{\s*room\.status\s*===\s*["']playing["']/.test(workspaceTag)
      || mobileRules.some(({ selectors }) => selectors.some((selector) => (
        /data-(?:room-)?status\s*=\s*["']playing["']|\.is-(?:room-)?playing/.test(selector)
      )));

    expect(focusFollowsPlayingStatus).toBe(true);
    expect(mobileRules.some(({ selectors }) => selectors.some(isPlayingSelector))).toBe(true);
    expect(hiddenWhilePlaying.some((selector) => targetsClassAsSubject(selector, "online-game-room-summary"))).toBe(true);
    expect(hiddenWhilePlaying.some((selector) => targetsClassAsSubject(selector, "online-game-rules-section"))).toBe(true);

    const essentialHooks = [
      "online-game-matchup",
      "online-game-audio-section",
      "online-game-match-actions",
      "online-game-room-actions-section",
    ];
    for (const hook of essentialHooks) {
      expect(source).toContain(hook);
      expect(hiddenWhilePlaying.some((selector) => targetsClassAsSubject(selector, hook))).toBe(false);
    }
    expect(source).toMatch(/aria-label=["']返回游戏大厅["']/);
    expect(source).toContain("申请悔棋");
    expect(source).toContain("认输并结束本局");
    expect(source).toContain("离开房间");
  });

  it("桌面与移动端都按可用视口放大棋盘并限制溢出", () => {
    const onlineSectionStart = css.indexOf(".online-game-workspace");
    expect(onlineSectionStart).toBeGreaterThanOrEqual(0);
    const onlineSection = css.slice(onlineSectionStart);
    const desktopCss = withoutAtRuleBlocks(onlineSection, "@media");
    const mobileCss = extractAtRuleBlocks(onlineSection, "@media")
      .filter(({ header }) => /max-width\s*:\s*(?:640|760)px/.test(header))
      .map(({ body }) => body)
      .join("\n");

    expect(viewportAwareBoardValue(desktopCss)).toBeDefined();
    expect(viewportAwareBoardValue(mobileCss)).toBeDefined();
    expect(desktopCss).toMatch(/\.online-game-workspace\[data-focus-mode=["']game["']\]\s+\.online-gomoku-surface\s*\{[^}]*padding\s*:\s*0/);
    expect(mobileCss).toMatch(/\.center-shell\.is-web:has\(\.online-game-workspace\[data-focus-mode=["']game["']\]\)\s+\.topbar\s*\{[^}]*display\s*:\s*none/);

    const stageDeclarations = flatCssRules(css)
      .filter(({ selectors }) => selectors.includes(".online-game-board-stage"))
      .map(({ declarations }) => declarations)
      .join("\n");
    const boardDeclarations = flatCssRules(css)
      .filter(({ selectors }) => selectors.some((selector) => selector === ".reference-board" || targetsClass(selector, "online-game-board-host")))
      .map(({ declarations }) => declarations)
      .join("\n");

    expect(stageDeclarations).toMatch(/overflow\s*:\s*hidden/);
    expect(boardDeclarations).toMatch(/max-(?:width|height|inline-size)\s*:/);
  });
});
