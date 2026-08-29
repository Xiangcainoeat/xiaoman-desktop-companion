import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Code2, RefreshCw, Send, TerminalSquare } from "lucide-react";
import { CODEX_STATUS_LABEL, formatRelativeTime, preferredCodexThreadId, sortCodexThreads } from "../shared/codex-ui";
import type { CodexReplyTransport, CodexThreadListResult } from "../shared/types";
import { bridge } from "../useCompanion";
import { EmptyState } from "./Controls";

export function CodexTasksView({
  enabled,
  replyTransport = "native",
}: {
  enabled: boolean;
  replyTransport?: CodexReplyTransport;
}) {
  const [result, setResult] = useState<CodexThreadListResult>({ threads: [], source: enabled ? "unavailable" : "off", warnings: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const refreshGenerationRef = useRef(0);

  const refresh = async (quiet = false) => {
    const generation = ++refreshGenerationRef.current;
    if (!enabled) {
      setResult({ threads: [], source: "off", warnings: [] });
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const next = await bridge.listCodexThreads(!quiet);
      if (generation !== refreshGenerationRef.current) return;
      setResult(next);
      setSelectedId((current) => preferredCodexThreadId(next.threads, current));
    } catch (error) {
      if (generation !== refreshGenerationRef.current) return;
      setNotice(error instanceof Error ? error.message : "无法读取 Codex 任务");
    } finally {
      if (!quiet && generation === refreshGenerationRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    if (!enabled) return () => { refreshGenerationRef.current += 1; };
    const interval = window.setInterval(() => void refresh(true), 5_000);
    return () => {
      refreshGenerationRef.current += 1;
      window.clearInterval(interval);
    };
  }, [enabled, replyTransport]);

  const threads = useMemo(() => sortCodexThreads(result.threads), [result.threads]);
  const selected = threads.find((thread) => thread.id === selectedId) ?? null;
  const activeCount = threads.filter((thread) => thread.status === "active" || thread.status === "waiting").length;

  const openSelected = async () => {
    if (!selected) return;
    setNotice(null);
    try {
      const response = await bridge.openCodexThread(selected.id);
      setNotice(response.message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法打开 Codex 任务");
    }
  };

  const sendReply = async () => {
    const message = reply.trim();
    if (!selected || !selected.canReply || !message || sending) return;
    setSending(true);
    setNotice(null);
    try {
      const response = await bridge.replyCodexThread(selected.id, message);
      if (!response.ok) {
        setNotice(response.message);
        return;
      }
      setReply("");
      setNotice(response.message);
      await refresh(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "回复没有发送");
    } finally {
      setSending(false);
    }
  };

  if (!enabled) {
    return (
      <div className="view codex-tasks-view disabled-feature-view">
        <EmptyState icon={<Code2 size={20} />} title="Codex 任务与回复已关闭" />
      </div>
    );
  }

  return (
    <div className="view codex-tasks-view">
      <section className="task-list-panel">
        <div className="section-heading task-section-heading">
          <div><span className="eyebrow">{replyTransport === "native" ? "原生窗口回复" : "CLI 兼容回复"}</span><h2>最近任务</h2></div>
          <div className="task-heading-actions">
            <span className={`task-transport transport-${replyTransport}`}>
              {replyTransport === "native" ? "原生" : "兼容"}
            </span>
            <span className={`task-source source-${result.source}`}>{activeCount > 0 ? `${activeCount} 个进行中` : "暂无进行中"}</span>
            <button className="icon-button" type="button" title="刷新任务" aria-label="刷新任务" disabled={loading} onClick={() => void refresh()}>
              <RefreshCw size={16} className={loading ? "is-spinning" : ""} />
            </button>
          </div>
        </div>
        {result.warnings.length > 0 && <div className="task-warning">{result.warnings[0]}</div>}
        {threads.length === 0 ? (
          <EmptyState icon={<TerminalSquare size={20} />} title={loading ? "正在读取任务" : "没有可显示的本机任务"} />
        ) : (
          <div className="codex-thread-list">
            {threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className={`codex-thread-row status-${thread.status} ${selected?.id === thread.id ? "is-selected" : ""}`}
                onClick={() => setSelectedId(thread.id)}
                onDoubleClick={() => void bridge.openCodexThread(thread.id)}
              >
                <span className="thread-status-dot" />
                <span className="thread-copy">
                  <strong>{thread.title}</strong>
                  <small>{thread.projectName} · {formatRelativeTime(thread.updatedAt)}</small>
                </span>
                <span className="thread-status-label">{CODEX_STATUS_LABEL[thread.status]}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="task-reply-panel">
        <div className="section-heading">
          <div><span className="eyebrow">直接继续</span><h2>{selected?.title ?? "选择一项任务"}</h2></div>
          <button className="secondary-button" type="button" disabled={!selected} onClick={() => void openSelected()}>
            <ArrowUpRight size={16} />
            在 Codex 中打开
          </button>
        </div>
        <textarea
          value={reply}
          maxLength={16_000}
          disabled={!selected || !selected.canReply || sending}
          placeholder={selected?.waitReason === "approval" ? "请在 Codex 中处理授权" : "回复这项任务"}
          aria-label="回复 Codex 任务"
          onChange={(event) => setReply(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void sendReply();
          }}
        />
        <div className="task-reply-footer">
          <span className="task-notice" aria-live="polite">
            {notice ?? (selected?.waitReason === "approval" ? "等待 Codex 授权" : selected ? CODEX_STATUS_LABEL[selected.status] : "")}
          </span>
          <span className="reply-length">{reply.length}/16000</span>
          <button className="primary-button" type="button" disabled={!selected || !selected.canReply || !reply.trim() || sending} onClick={() => void sendReply()}>
            <Send size={16} />
            {sending
              ? "发送中"
              : replyTransport === "native"
                ? "发送到原生窗口"
              : selected?.status === "active"
                ? "排队回复"
                : selected?.status === "waiting"
                  ? "回复"
                  : "继续执行"}
          </button>
        </div>
      </section>
    </div>
  );
}
