import type { ArticleGameId } from "./registry";

export type ArticleGameWorkspaceTab = "home" | ArticleGameId;

export function openArticleGameTab(
  openTabs: readonly ArticleGameId[],
  id: ArticleGameId,
): ArticleGameId[] {
  return openTabs.includes(id) ? [...openTabs] : [...openTabs, id];
}

export function closeArticleGameTab(
  openTabs: readonly ArticleGameId[],
  id: ArticleGameId,
): ArticleGameId[] {
  return openTabs.filter((tabId) => tabId !== id);
}

export function activeTabAfterClose(
  activeTab: ArticleGameWorkspaceTab,
  openTabs: readonly ArticleGameId[],
  closedTab: ArticleGameId,
): ArticleGameWorkspaceTab {
  if (activeTab !== closedTab) return activeTab;
  const index = openTabs.indexOf(closedTab);
  return openTabs[index - 1] ?? openTabs[index + 1] ?? "home";
}

export function normalizeArticleGameTab(
  activeTab: ArticleGameWorkspaceTab,
  openTabs: readonly ArticleGameId[],
): ArticleGameWorkspaceTab {
  return activeTab === "home" || openTabs.includes(activeTab) ? activeTab : "home";
}
