import { describe, expect, it } from "vitest";
import {
  canReplyToCodexSession,
  CodexSessionsService,
  summarizeCodexProcessResult,
} from "../electron/codex-sessions";
import { mapCodexThreadStatus, preferredCodexThreadId, sortCodexThreads } from "../src/shared/codex-ui";
import type { CodexThreadSummary, CodexThreadStatus } from "../src/shared/types";

function thread(id: string, status: CodexThreadStatus, updatedAt: number): CodexThreadSummary {
  return {
    id,
    title: id,
    projectName: "test",
    status,
    updatedAt,
    activeTurnId: null,
    sourceKind: null,
    canReply: true,
    waitReason: null,
  };
}

describe("Codex task presentation", () => {
  const threads = [
    thread("idle-new", "idle", 40),
    thread("active-old", "active", 10),
    thread("waiting", "waiting", 20),
    thread("active-new", "active", 30),
  ];

  it("orders waiting tasks first, then active tasks, then recent tasks", () => {
    expect(sortCodexThreads(threads).map((item) => item.id)).toEqual([
      "waiting",
      "active-new",
      "active-old",
      "idle-new",
    ]);
  });

  it("keeps a valid selection and otherwise chooses the highest-priority task", () => {
    expect(preferredCodexThreadId(threads, "idle-new")).toBe("idle-new");
    expect(preferredCodexThreadId(threads, "missing")).toBe("waiting");
    expect(preferredCodexThreadId([], "missing")).toBeNull();
  });

  it("prefers inferred lifecycle activity over a stale notLoaded runtime marker", () => {
    expect(mapCodexThreadStatus("running", "notLoaded")).toBe("active");
    expect(mapCodexThreadStatus("waiting", "notLoaded")).toBe("waiting");
    expect(mapCodexThreadStatus("unknown", "notLoaded")).toBe("not-loaded");
    expect(mapCodexThreadStatus("unknown", null)).toBe("unknown");
  });

  it("keeps the reply control enabled for a locally active stale-runtime task", async () => {
    const threadId = "01a03ab3-3112-7cf3-949f-07e0ae5a9404";
    const service = new CodexSessionsService({
      replyTransport: "cli",
      appServerRequest: async () => ({
        data: [{ id: threadId, status: { type: "notLoaded" }, canAcceptDirectInput: false }],
      }),
      localSessionScanner: async () => [{
        id: threadId,
        sessionId: threadId,
        cwd: "/tmp",
        filePath: `/tmp/${threadId}.jsonl`,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_100_000,
        preview: "UI regression",
        source: "cli",
        threadSource: "user",
        isSubagent: false,
        activity: "running" as const,
        activeTurnId: "turn-1",
        lastOutcome: null,
      }],
    });

    const session = (await service.listSessions()).sessions[0];
    const presented = {
      status: mapCodexThreadStatus(session.status.activity, session.status.runtimeType),
      canReply: session.canAcceptDirectInput,
    };
    expect(presented).toEqual({ status: "active", canReply: true });
  });

  it("keeps an approval-waiting reply control disabled", async () => {
    const threadId = "01a03ab3-3112-7cf3-949f-07e0ae5a9404";
    const service = new CodexSessionsService({
      replyTransport: "cli",
      appServerRequest: async () => ({
        data: [{
          id: threadId,
          status: { type: "active", activeFlags: ["waitingOnApproval"] },
          canAcceptDirectInput: false,
        }],
      }),
      localSessionScanner: async () => [{
        id: threadId,
        sessionId: threadId,
        cwd: "/tmp",
        filePath: `/tmp/${threadId}.jsonl`,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_100_000,
        preview: "approval regression",
        source: "cli",
        threadSource: "user",
        isSubagent: false,
        activity: "waiting" as const,
        activeTurnId: "turn-1",
        lastOutcome: null,
      }],
    });

    const session = (await service.listSessions()).sessions[0];
    expect({
      status: mapCodexThreadStatus(session.status.activity, session.status.runtimeType),
      canReply: session.canAcceptDirectInput,
    }).toEqual({ status: "waiting", canReply: false });
  });

  it("uses one replyability policy for active, resumable, and approval states", () => {
    const status = (activity: "running" | "waiting" | "idle" | "error", activeFlags: string[] = []) => ({
      activity,
      runtimeType: "notLoaded",
      activeFlags,
      activeTurnId: activity === "idle" || activity === "error" ? null : "turn-1",
      inferredFromLog: true,
    } as const);

    expect(canReplyToCodexSession({ canAcceptDirectInput: false, status: status("running") })).toBe(true);
    expect(canReplyToCodexSession({ canAcceptDirectInput: false, status: status("waiting") })).toBe(true);
    expect(canReplyToCodexSession({ canAcceptDirectInput: false, status: status("idle") })).toBe(true);
    expect(canReplyToCodexSession({
      canAcceptDirectInput: true,
      status: status("waiting", ["waitingOnApproval"]),
    })).toBe(false);
  });

  it("keeps command errors bounded while retaining short stderr and stdout details", () => {
    const summary = summarizeCodexProcessResult({
      code: 1,
      signal: null,
      stderr: "permission denied",
      stdout: "command context",
    });

    expect(summary).toContain("permission denied");
    expect(summary).toContain("command context");
    expect(summary.length).toBeLessThanOrEqual(500);
    expect(summary).not.toContain("已启动");
  });
});
