import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Code2, RefreshCw, Send, X } from "lucide-react";
import { CODEX_STATUS_LABEL, formatRelativeTime, preferredCodexThreadId, sortCodexThreads } from "../shared/codex-ui";
import type { CodexThreadListResult } from "../shared/types";
import { bridge } from "../useCompanion";

interface OverlayCodexPanelProps {
  onClose: () => void;
}

export function OverlayCodexPanel({ onClose }: OverlayCodexPanelProps) {
  const [result, setResult] = useState<CodexThreadListResult>({ threads: [], source: "unavailable", warnings: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const refreshGenerationRef = useRef(0);

  const refresh = useCallback(async (force = false) => {
    const generation = ++refreshGenerationRef.current;
    if (force) setLoading(true);
    try {
      const next = await bridge.listCodexThreads(force);
      if (generation !== refreshGenerationRef.current) return;
      setResult(next);
      setSelectedId((current) => preferredCodexThreadId(next.threads, current));
    } catch (error) {
      if (generation !== refreshGenerationRef.current) return;
      setNotice(error instanceof Error ? error.message : "无法读取 Codex 任务");
    } finally {
      if (generation === refreshGenerationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    const interval = window.setInterval(() => void refresh(false), 10_000);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      refreshGenerationRef.current += 1;
      window.clearInterval(interval);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, refresh]);

  const threads = useMemo(() => sortCodexThreads(result.threads), [result.threads]);
  const selected = threads.find((thread) => thread.id === selectedId) ?? null;
  const activeCount = threads.filter((thread) => thread.status === "active" || thread.status === "waiting").length;

  useEffect(() => {
    if (selected) inputRef.current?.focus();
  }, [selected?.id]);

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

  const openSelected = async () => {
    if (!selected) return;
    try {
      const response = await bridge.openCodexThread(selected.id);
      setNotice(response.message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "无法打开 Codex 任务");
    }
  };

  return (
    <section className="overlay-codex-panel" aria-label="Codex 任务快捷回复" onContextMenu={(event) => event.stopPropagation()}>
      <header className="overlay-codex-header">
        <span className="overlay-codex-title"><Code2 size={16} />Codex 任务</span>
        <span className="overlay-codex-count">{activeCount > 0 ? `${activeCount} 进行中` : `${threads.length} 项`}</span>
        <button className="icon-button compact" type="button" title="刷新任务" aria-label="刷新任务" onClick={() => void refresh(true)}>
          <RefreshCw size={14} className={loading ? "is-spinning" : ""} />
        </button>
        <button className="icon-button compact" type="button" title="关闭任务面板" aria-label="关闭任务面板" onClick={onClose}>
          <X size={15} />
        </button>
      </header>

      {result.warnings.length > 0 && <p className="overlay-codex-warning">{result.warnings[0]}</p>}

      <div className="overlay-codex-list" aria-label="最近任务">
        {threads.length === 0 ? (
          <div className="overlay-codex-empty">{loading ? "正在读取任务" : "没有可显示的任务"}</div>
        ) : threads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            className={`overlay-codex-thread status-${thread.status} ${selected?.id === thread.id ? "is-selected" : ""}`}
            title={thread.title}
            onClick={() => setSelectedId(thread.id)}
          >
            <span className="thread-status-dot" />
            <span className="overlay-thread-copy">
              <strong>{thread.title}</strong>
              <small>{thread.projectName} · {formatRelativeTime(thread.updatedAt)}</small>
            </span>
            <span>{CODEX_STATUS_LABEL[thread.status]}</span>
          </button>
        ))}
      </div>

      <div className="overlay-codex-compose">
        <div className="overlay-codex-selection">
          <strong>{selected?.title ?? "选择一项任务"}</strong>
          <button className="icon-button compact" type="button" disabled={!selected} title="在 Codex 中打开" aria-label="在 Codex 中打开" onClick={() => void openSelected()}>
            <ArrowUpRight size={14} />
          </button>
        </div>
        <textarea
          ref={inputRef}
          value={reply}
          maxLength={16_000}
          disabled={!selected || !selected.canReply || sending}
          placeholder={selected?.waitReason === "approval" ? "请在 Codex 中处理授权" : "直接回复这项任务"}
          aria-label="回复 Codex 任务"
          onChange={(event) => setReply(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void sendReply();
          }}
        />
        <div className="overlay-codex-footer">
          <span aria-live="polite">
            {notice ?? (selected?.waitReason === "approval" ? "等待 Codex 授权" : selected ? CODEX_STATUS_LABEL[selected.status] : "")}
          </span>
          <button
            className="icon-button overlay-send"
            type="button"
            disabled={!selected || !selected.canReply || !reply.trim() || sending}
            title={selected?.status === "active" ? "排队回复" : "发送回复"}
            aria-label={selected?.status === "active" ? "排队回复" : "发送回复"}
            onClick={() => void sendReply()}
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}
