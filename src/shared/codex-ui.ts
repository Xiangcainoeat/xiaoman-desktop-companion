import type { CodexThreadStatus, CodexThreadSummary } from "./types";

export const CODEX_STATUS_LABEL: Record<CodexThreadStatus, string> = {
  active: "执行中",
  waiting: "等待回复",
  idle: "已就绪",
  "not-loaded": "未载入",
  error: "异常",
  unknown: "状态未知",
};

export function mapCodexThreadStatus(
  activity: "running" | "waiting" | "idle" | "error" | "unknown",
  runtimeType: string | null,
): CodexThreadStatus {
  if (activity === "running") return "active";
  if (activity === "waiting") return "waiting";
  if (activity === "idle") return "idle";
  if (activity === "error") return "error";
  return runtimeType === "notLoaded" ? "not-loaded" : "unknown";
}

function statusRank(status: CodexThreadStatus): number {
  if (status === "waiting") return 0;
  if (status === "active") return 1;
  return 2;
}

export function sortCodexThreads(threads: readonly CodexThreadSummary[]): CodexThreadSummary[] {
  return [...threads].sort((left, right) =>
    statusRank(left.status) - statusRank(right.status) || right.updatedAt - left.updatedAt,
  );
}

export function preferredCodexThreadId(
  threads: readonly CodexThreadSummary[],
  currentId: string | null,
): string | null {
  if (currentId && threads.some((thread) => thread.id === currentId)) return currentId;
  return sortCodexThreads(threads)[0]?.id ?? null;
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  if (!timestamp) return "未知时间";
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return new Date(timestamp).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}
