import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const componentSource = readFileSync(resolve(__dirname, "OverlayCodexPanel.tsx"), "utf8");
const stylesSource = readFileSync(resolve(__dirname, "../styles.css"), "utf8");

describe("OverlayCodexPanel layout contract", () => {
  it("keeps task copy readable while reserving a stable status column", () => {
    expect(stylesSource).toMatch(
      /\.overlay-codex-thread\s*\{[\s\S]*grid-template-columns:\s*10px minmax\(0, 1fr\) 52px;/,
    );
    expect(stylesSource).toMatch(
      /\.overlay-codex-thread > span:last-child\s*\{[\s\S]*min-width:\s*0;[\s\S]*overflow:\s*hidden;[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/,
    );
    expect(stylesSource).toMatch(
      /\.overlay-thread-copy strong\s*\{[\s\S]*font-size:\s*13px;[\s\S]*line-height:\s*18px;/,
    );
    expect(stylesSource).toMatch(
      /\.overlay-thread-copy small\s*\{[\s\S]*font-size:\s*11px;[\s\S]*line-height:\s*15px;/,
    );
    expect(stylesSource).toMatch(
      /\.overlay-codex-thread > span:last-child\s*\{[\s\S]*font-size:\s*11px;[\s\S]*line-height:\s*16px;/,
    );
  });

  it("shortens the reply box and increases compose text readability", () => {
    expect(componentSource).toContain('aria-label="回复 Codex 任务"');
    expect(stylesSource).toMatch(
      /\.overlay-codex-selection strong\s*\{[\s\S]*font-size:\s*13px;[\s\S]*line-height:\s*18px;/,
    );
    expect(stylesSource).toMatch(
      /\.overlay-codex-compose textarea\s*\{[\s\S]*height:\s*64px;[\s\S]*font-size:\s*13px;[\s\S]*line-height:\s*18px;/,
    );
    expect(stylesSource).toMatch(
      /\.overlay-codex-footer > span\s*\{[\s\S]*font-size:\s*11px;[\s\S]*line-height:\s*15px;/,
    );
    expect(stylesSource).toMatch(
      /\.overlay-codex-list\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow:\s*auto;/,
    );
  });

  it("gives the right-side overlay actors distinct gutters when the task panel is open", () => {
    expect(stylesSource).toMatch(
      /\.overlay-root\.has-task-panel \.pet-bubble\s*\{[\s\S]*right:\s*52px;[\s\S]*width:\s*210px;[\s\S]*max-height:\s*54px;[\s\S]*overflow:\s*hidden;/,
    );
    expect(stylesSource).toMatch(
      /\.overlay-root\.has-task-panel \.overlay-pet-hitbox\s*\{[\s\S]*right:\s*48px;/,
    );
    expect(stylesSource).toMatch(
      /\.overlay-root\.has-task-panel \.overlay-actions\s*\{[\s\S]*right:\s*6px;/,
    );
  });
});
