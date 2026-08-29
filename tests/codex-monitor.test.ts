import { describe, expect, it } from "vitest";
import { classifyCodexRecord, classifyCodexSessionMetadata } from "../electron/codex-monitor";
import { CodexSessionsService, type CodexLocalSessionRecord } from "../electron/codex-sessions";

const THREAD_ID = "01a03ab3-3112-7cf3-949f-07e0ae5a9404";

function localRecord(activity: CodexLocalSessionRecord["activity"]): CodexLocalSessionRecord {
  return {
    id: THREAD_ID,
    sessionId: THREAD_ID,
    cwd: "/tmp",
    filePath: `/tmp/${THREAD_ID}.jsonl`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    preview: "monitor regression",
    source: "cli",
    threadSource: "user",
    isSubagent: false,
    activity,
    activeTurnId: activity === "idle" || activity === "error" ? null : "turn-1",
    lastOutcome: null,
  };
}

describe("Codex event classification", () => {
  it("keeps user thread identity and excludes exec/subagent metadata", () => {
    expect(classifyCodexSessionMetadata({
      id: THREAD_ID,
      thread_source: "user",
      source: "vscode",
    })).toEqual({ threadId: THREAD_ID, interactive: true });
    expect(classifyCodexSessionMetadata({
      id: "exec-thread",
      thread_source: "user",
      source: "exec",
    }).interactive).toBe(false);
    expect(classifyCodexSessionMetadata({
      id: "subagent-thread",
      thread_source: "subagent",
      source: { subagent: { thread_spawn: {} } },
      agent_role: "worker",
    }).interactive).toBe(false);
  });

  it("maps task lifecycle records without reading message content", () => {
    expect(classifyCodexRecord({
      timestamp: "2026-08-26T10:00:00.000Z",
      type: "event_msg",
      payload: { type: "task_started", turn_id: "turn-1" },
    })).toMatchObject({ kind: "started", turnId: "turn-1" });

    expect(classifyCodexRecord({
      type: "event_msg",
      payload: { type: "task_complete", turn_id: "turn-1", duration_ms: 2500 },
    })).toMatchObject({ kind: "completed", turnId: "turn-1", durationMs: 2500 });
  });

  it("maps failed and waiting records", () => {
    expect(classifyCodexRecord({
      type: "event_msg",
      payload: { type: "task_complete", turn_id: "turn-2", error: { code: "failed" } },
    })).toMatchObject({ kind: "failed", turnId: "turn-2" });

    expect(classifyCodexRecord({
      type: "response_item",
      payload: { type: "custom_tool_call", name: "request_user_input", input: "private-content" },
    })).toMatchObject({ kind: "waiting" });
  });

  it("ignores ordinary messages and tool payloads", () => {
    expect(classifyCodexRecord({
      type: "event_msg",
      payload: { type: "agent_message", message: "private-content" },
    })).toBeNull();
  });

  it("keeps a log-derived active task replyable when runtime metadata is stale", async () => {
    const service = new CodexSessionsService({
      replyTransport: "cli",
      appServerRequest: async () => ({
        data: [{ id: THREAD_ID, status: { type: "notLoaded" }, canAcceptDirectInput: false }],
      }),
      localSessionScanner: async () => [localRecord("running")],
    });

    const session = (await service.listSessions()).sessions[0];
    expect(session.status.activity).toBe("running");
    expect(session.canAcceptDirectInput).toBe(true);
  });
});
