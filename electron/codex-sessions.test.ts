import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCodexQueueArgs,
  buildCodexResumeArgs,
  CodexSessionsService,
  getCodexThreadDeepLink,
  parseCodexSessionLog,
  scanLocalCodexSessions,
  spawnCodexProcess,
  type CodexAppServerRequester,
  type CodexLocalSessionRecord,
  type CodexProcessInvocation,
  type CodexProcessResult,
  type CodexProcessSpawner,
} from "./codex-sessions";

const THREAD_ID = "01a03ab3-3112-7cf3-949f-07e0ae5a9404";

function jsonl(...records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

function processResult(code = 0, stderr = "", stdout = ""): CodexProcessResult {
  return { code, signal: null, stdout, stderr };
}

function recordingSpawner(results: CodexProcessResult[] = [processResult()]): {
  invocations: CodexProcessInvocation[];
  spawner: CodexProcessSpawner;
} {
  const invocations: CodexProcessInvocation[] = [];
  let index = 0;
  return {
    invocations,
    spawner: (invocation) => {
      invocations.push(invocation);
      const result = results[Math.min(index++, results.length - 1)];
      return {
        pid: 9000 + index,
        startup: Promise.resolve(result.code === 0),
        completion: Promise.resolve(result),
        cancel: () => undefined,
      };
    },
  };
}

function localRecord(overrides: Partial<CodexLocalSessionRecord> = {}): CodexLocalSessionRecord {
  return {
    id: THREAD_ID,
    sessionId: THREAD_ID,
    cwd: "/Users/example/project",
    filePath: `/Users/example/.codex/sessions/${THREAD_ID}.jsonl`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    preview: "修复登录测试",
    source: "vscode",
    threadSource: "user",
    isSubagent: false,
    activity: "running",
    activeTurnId: "turn-1",
    lastOutcome: null,
    ...overrides,
  };
}

describe("read-only Codex session parsing", () => {
  it("extracts safe summary metadata and an active turn", () => {
    const record = parseCodexSessionLog(jsonl(
      {
        timestamp: "2026-08-26T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: THREAD_ID,
          session_id: THREAD_ID,
          cwd: "/Users/example/project",
          source: "vscode",
          thread_source: "user",
          timestamp: "2026-08-26T10:00:00.000Z",
        },
      },
      {
        timestamp: "2026-08-26T10:01:00.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "  修复\n登录测试  " },
      },
      {
        timestamp: "2026-08-26T10:01:01.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-1" },
      },
    ), {
      filePath: `/tmp/${THREAD_ID}.jsonl`,
      modifiedAt: Date.parse("2026-08-26T10:01:02.000Z"),
      now: Date.parse("2026-08-26T10:02:00.000Z"),
    });

    expect(record).toMatchObject({
      id: THREAD_ID,
      preview: "修复 登录测试",
      activity: "running",
      activeTurnId: "turn-1",
    });
  });

  it("detects waiting and returns to idle after completion", () => {
    const waiting = parseCodexSessionLog(jsonl(
      { type: "session_meta", payload: { id: THREAD_ID, session_id: THREAD_ID } },
      { type: "event_msg", payload: { type: "task_started", turn_id: "turn-2" } },
      { type: "response_item", payload: { type: "custom_tool_call", name: "request_user_input" } },
    ), { filePath: "/tmp/waiting.jsonl", modifiedAt: 10_000, now: 10_100 });
    expect(waiting?.activity).toBe("waiting");

    const completed = parseCodexSessionLog(jsonl(
      { type: "session_meta", payload: { id: THREAD_ID, session_id: THREAD_ID } },
      { type: "event_msg", payload: { type: "task_started", turn_id: "turn-2" } },
      { type: "event_msg", payload: { type: "task_complete", turn_id: "turn-2" } },
    ), { filePath: "/tmp/completed.jsonl", modifiedAt: 10_000, now: 10_100 });
    expect(completed).toMatchObject({ activity: "idle", activeTurnId: null, lastOutcome: "completed" });
  });

  it("ignores malformed records and expires stale active markers", () => {
    const record = parseCodexSessionLog(`${jsonl(
      { type: "session_meta", payload: { id: THREAD_ID, session_id: THREAD_ID } },
      { timestamp: "2026-01-01T00:00:00.000Z", type: "event_msg", payload: { type: "task_started" } },
    )}\n{not-json`, {
      filePath: "/tmp/stale.jsonl",
      modifiedAt: Date.parse("2026-01-01T00:00:00.000Z"),
      now: Date.parse("2026-01-02T00:00:00.000Z"),
      activeStaleMs: 60_000,
    });
    expect(record?.activity).toBe("idle");
  });

  it("does not splice a stale head lifecycle into a large log tail", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "xiaoman-sessions-"));
    const directory = path.join(root, "2026", "08", "26");
    mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, `rollout-${THREAD_ID}.jsonl`);
    const metadata = jsonl(
      { type: "session_meta", payload: { id: THREAD_ID, session_id: THREAD_ID, cwd: "/tmp" } },
      { type: "event_msg", payload: { type: "user_message", message: "large log" } },
    );
    const nearHeadStart = jsonl({ type: "event_msg", payload: { type: "task_started", turn_id: "old-turn" } });
    const skippedCompletion = jsonl({ type: "event_msg", payload: { type: "task_complete", turn_id: "old-turn" } });
    writeFileSync(filePath, [
      metadata,
      "{}\n".repeat(40_000),
      nearHeadStart,
      "{}\n".repeat(80_000),
      skippedCompletion,
      "{}\n".repeat(1_500_000),
    ].join("\n"));
    try {
      const records = await scanLocalCodexSessions({
        sessionsRoot: root,
        limit: 5,
        now: Date.now(),
        activeStaleMs: 60_000,
      });
      expect(records[0]).toMatchObject({ id: THREAD_ID, activity: "idle", activeTurnId: null });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("finds an active turn even when its start is older than the final 4 MiB", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "xiaoman-sessions-"));
    const directory = path.join(root, "2026", "08", "26");
    mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, `rollout-${THREAD_ID}.jsonl`);
    writeFileSync(filePath, [
      jsonl(
        { type: "session_meta", payload: { id: THREAD_ID, session_id: THREAD_ID, cwd: "/tmp" } },
        { type: "event_msg", payload: { type: "user_message", message: "long active task" } },
        { type: "event_msg", payload: { type: "task_started", turn_id: "active-turn" } },
      ),
      "{}\n".repeat(1_500_000),
    ].join("\n"));
    try {
      const records = await scanLocalCodexSessions({
        sessionsRoot: root,
        limit: 5,
        now: Date.now(),
        activeStaleMs: 60_000,
      });
      expect(records[0]).toMatchObject({
        id: THREAD_ID,
        activity: "running",
        activeTurnId: "active-turn",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("scans past recent subagents to fill the requested user-task limit", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "xiaoman-sessions-"));
    const directory = path.join(root, "2026", "08", "26");
    mkdirSync(directory, { recursive: true });
    const baseTime = Date.now() - 60_000;
    try {
      for (let index = 0; index < 8; index += 1) {
        const filePath = path.join(directory, `rollout-subagent-${index}.jsonl`);
        writeFileSync(filePath, jsonl({
          type: "session_meta",
          payload: { id: `subagent-${index}`, session_id: `subagent-${index}`, source: "subagent" },
        }));
        const modifiedAt = new Date(baseTime + 20_000 + index * 1_000);
        utimesSync(filePath, modifiedAt, modifiedAt);
      }
      for (let index = 0; index < 5; index += 1) {
        const filePath = path.join(directory, `rollout-user-${index}.jsonl`);
        writeFileSync(filePath, jsonl({
          type: "session_meta",
          payload: { id: `user-${index}`, session_id: `user-${index}`, source: "cli" },
        }));
        const modifiedAt = new Date(baseTime + index * 1_000);
        utimesSync(filePath, modifiedAt, modifiedAt);
      }

      const records = await scanLocalCodexSessions({
        sessionsRoot: root,
        limit: 5,
        includeSubagents: false,
        now: Date.now(),
        activeStaleMs: 60_000,
      });
      expect(records).toHaveLength(5);
      expect(records.every((record) => !record.isSubagent)).toBe(true);
      expect(records.map((record) => record.id)).toEqual([
        "user-4",
        "user-3",
        "user-2",
        "user-1",
        "user-0",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Codex desktop navigation", () => {
  it("returns the documented thread deep link", () => {
    expect(getCodexThreadDeepLink(THREAD_ID)).toBe(`codex://threads/${THREAD_ID}`);
  });

  it("rejects path-like thread ids", () => {
    expect(() => getCodexThreadDeepLink("../../settings")).toThrow("Invalid Codex thread id");
  });
});

describe("session listing", () => {
  it("merges app-server metadata with read-only log activity", async () => {
    const appServerRequest: CodexAppServerRequester = async (method) => {
      expect(method).toBe("thread/list");
      return {
        data: [{
          id: THREAD_ID,
          sessionId: THREAD_ID,
          name: "登录修复",
          preview: "修复登录测试",
          cwd: "/Users/example/project",
          path: `/Users/example/.codex/sessions/${THREAD_ID}.jsonl`,
          source: "vscode",
          threadSource: "user",
          createdAt: 1_700_000_000,
          updatedAt: 1_700_000_050,
          status: { type: "notLoaded" },
          canAcceptDirectInput: false,
        }],
        nextCursor: null,
      };
    };
    const service = new CodexSessionsService({
      codexPath: "/Applications/ChatGPT.app/Contents/Resources/codex",
      codexHome: "/Users/example/.codex",
      appServerRequest,
      localSessionScanner: async () => [localRecord()],
    });

    const result = await service.listSessions({ limit: 10 });
    expect(result.source).toBe("app-server+logs");
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      id: THREAD_ID,
      title: "登录修复",
      status: {
        activity: "running",
        runtimeType: "notLoaded",
        activeTurnId: "turn-1",
        inferredFromLog: true,
      },
      canAcceptDirectInput: true,
      desktopUrl: `codex://threads/${THREAD_ID}`,
    });
  });

  it("keeps approval waits blocked even when the local log is waiting", async () => {
    const service = new CodexSessionsService({
      appServerRequest: async () => ({
        data: [{
          id: THREAD_ID,
          status: { type: "active", activeFlags: ["waitingOnApproval"] },
          canAcceptDirectInput: false,
        }],
      }),
      localSessionScanner: async () => [localRecord({ activity: "waiting" })],
    });

    const session = (await service.listSessions()).sessions[0];
    expect(session.status.activity).toBe("waiting");
    expect(session.canAcceptDirectInput).toBe(false);
  });

  it("marks a locally waiting task replyable when app-server says false", async () => {
    const service = new CodexSessionsService({
      appServerRequest: async () => ({
        data: [{ id: THREAD_ID, status: { type: "notLoaded" }, canAcceptDirectInput: false }],
      }),
      localSessionScanner: async () => [localRecord({ activity: "waiting" })],
    });

    const session = (await service.listSessions()).sessions[0];
    expect(session).toMatchObject({
      status: { activity: "waiting" },
      canAcceptDirectInput: true,
    });
  });

  it("falls back to local summaries when app-server is unavailable", async () => {
    const service = new CodexSessionsService({
      appServerRequest: async () => { throw new Error("offline"); },
      localSessionScanner: async () => [localRecord({ activity: "idle" })],
    });
    const result = await service.listSessions();
    expect(result.source).toBe("logs");
    expect(result.warnings).toHaveLength(1);
    expect(result.sessions[0].status.activity).toBe("idle");
  });
});

describe("safe reply dispatch", () => {
  it("acknowledges a resumed turn from JSONL stdout", async () => {
    const handle = spawnCodexProcess({
      executable: process.execPath,
      args: ["-e", "console.log(JSON.stringify({type:'turn.started'})); setInterval(() => {}, 1000)"],
      killGraceMs: 25,
    });
    await expect(handle.startup).resolves.toBe(true);
    handle.cancel();
    await expect(handle.completion).resolves.toMatchObject({ code: null });
  });

  it("force-settles a timed-out process that ignores SIGTERM", async () => {
    const handle = spawnCodexProcess({
      executable: process.execPath,
      args: ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      timeoutMs: 40,
      killGraceMs: 25,
    });
    const result = await handle.completion;
    expect(result.code).toBeNull();
    expect(result.stderr).toContain("timed out");
  });

  it("builds queue and resume argument arrays without shell command strings", () => {
    expect(buildCodexQueueArgs(THREAD_ID, "继续执行")).toEqual([
      "queue", "--thread", THREAD_ID, "--message", "继续执行",
    ]);
    expect(buildCodexResumeArgs(THREAD_ID)).toEqual([
      "exec", "resume", "--skip-git-repo-check", THREAD_ID, "-", "--json",
    ]);
  });

  it("queues replies for active sessions", async () => {
    const recorder = recordingSpawner();
    const service = new CodexSessionsService({
      codexPath: "/safe/codex",
      processSpawner: recorder.spawner,
    });
    const dispatch = await service.sendReply({
      threadId: THREAD_ID,
      message: "继续执行",
      activity: "running",
    });

    expect(dispatch.transport).toBe("queue");
    expect(recorder.invocations).toHaveLength(1);
    expect(recorder.invocations[0]).toMatchObject({
      executable: "/safe/codex",
      args: ["queue", "--thread", THREAD_ID, "--message", "继续执行"],
    });
    expect(recorder.invocations[0].stdin).toBeUndefined();
  });

  it("resumes idle sessions with the prompt on stdin", async () => {
    const recorder = recordingSpawner();
    const service = new CodexSessionsService({ codexPath: "/safe/codex", processSpawner: recorder.spawner });
    const dispatch = await service.sendReply({
      threadId: THREAD_ID,
      message: "检查失败测试",
      activity: "idle",
      cwd: os.tmpdir(),
    });

    expect(dispatch.transport).toBe("exec-resume");
    expect(recorder.invocations[0]).toMatchObject({
      executable: "/safe/codex",
      args: ["exec", "resume", "--skip-git-repo-check", THREAD_ID, "-", "--json"],
      stdin: "检查失败测试\n",
      cwd: os.tmpdir(),
    });
    await expect(dispatch.completion).resolves.toMatchObject({ code: 0 });
  });

  it("omits missing, relative, and non-directory cwd values when resuming", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "xiaoman-resume-cwd-"));
    const filePath = path.join(root, "not-a-directory");
    writeFileSync(filePath, "content");
    const missingPath = path.join(root, "missing");
    const recorder = recordingSpawner();
    const service = new CodexSessionsService({ codexPath: "/safe/codex", processSpawner: recorder.spawner });

    try {
      await service.sendReply({ threadId: THREAD_ID, message: "缺失目录", activity: "idle", cwd: missingPath });
      await service.sendReply({ threadId: THREAD_ID, message: "相对目录", activity: "idle", cwd: "relative/project" });
      await service.sendReply({ threadId: THREAD_ID, message: "文件路径", activity: "idle", cwd: filePath });
      expect(recorder.invocations.map((invocation) => invocation.cwd)).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not resume an active task when queueing fails", async () => {
    const recorder = recordingSpawner([processResult(1, "daemon unavailable")]);
    const service = new CodexSessionsService({ codexPath: "/safe/codex", processSpawner: recorder.spawner });

    await expect(service.sendReply({
      threadId: THREAD_ID,
      message: "继续",
      activity: "running",
    })).rejects.toThrow("daemon unavailable");
    expect(recorder.invocations).toHaveLength(1);
    expect(recorder.invocations[0].args[0]).toBe("queue");
  });

  it("recovers one active-session race after a fresh idle read", async () => {
    const recorder = recordingSpawner([
      processResult(1, "No active session found matching thread"),
      processResult(0),
    ]);
    let readCount = 0;
    const service = new CodexSessionsService({
      codexPath: "/safe/codex",
      processSpawner: recorder.spawner,
      localSessionScanner: async () => {
        readCount += 1;
        return [localRecord({ activity: "idle", cwd: os.tmpdir() })];
      },
      appServerRequest: async () => { throw new Error("offline"); },
    });

    const dispatch = await service.sendReply({
      threadId: THREAD_ID,
      message: "竞态后继续",
      activity: "running",
      cwd: "/definitely/missing/input-cwd",
    });

    expect(dispatch.transport).toBe("exec-resume");
    expect(dispatch.fallbackReason).toContain("No active session");
    expect(recorder.invocations.map((invocation) => invocation.args[0])).toEqual(["queue", "exec"]);
    expect(recorder.invocations[1].cwd).toBe(os.tmpdir());
    expect(readCount).toBe(1);
  });

  it("detects a late active-session marker without expanding the displayed error", async () => {
    const recorder = recordingSpawner([
      processResult(1, "stderr context", `${"x".repeat(600)} No active session found matching thread`),
      processResult(0),
    ]);
    const service = new CodexSessionsService({
      codexPath: "/safe/codex",
      processSpawner: recorder.spawner,
      localSessionScanner: async () => [localRecord({ activity: "idle" })],
      appServerRequest: async () => { throw new Error("offline"); },
    });

    const dispatch = await service.sendReply({
      threadId: THREAD_ID,
      message: "识别长错误中的竞态",
      activity: "running",
    });

    expect(dispatch.transport).toBe("exec-resume");
    expect(dispatch.fallbackReason?.length).toBeLessThanOrEqual(500);
  });

  it("does not resume when the fresh read still reports an active task", async () => {
    const recorder = recordingSpawner([processResult(1, "No active session found matching thread")]);
    let readCount = 0;
    const service = new CodexSessionsService({
      codexPath: "/safe/codex",
      processSpawner: recorder.spawner,
      localSessionScanner: async () => {
        readCount += 1;
        return [localRecord({ activity: "waiting" })];
      },
      appServerRequest: async () => { throw new Error("offline"); },
    });

    await expect(service.sendReply({
      threadId: THREAD_ID,
      message: "不要重复恢复",
      activity: "running",
    })).rejects.toThrow("No active session");
    expect(readCount).toBe(1);
    expect(recorder.invocations).toHaveLength(1);
  });

  it("does not retry beyond the single resume fallback", async () => {
    const recorder = recordingSpawner([
      processResult(1, "No active session found matching thread"),
      processResult(1, "resume failed"),
    ]);
    const service = new CodexSessionsService({
      codexPath: "/safe/codex",
      processSpawner: recorder.spawner,
      localSessionScanner: async () => [localRecord({ activity: "error" })],
      appServerRequest: async () => { throw new Error("offline"); },
    });

    await expect(service.sendReply({
      threadId: THREAD_ID,
      message: "只恢复一次",
      activity: "waiting",
    })).rejects.toThrow("resume failed");
    expect(recorder.invocations.map((invocation) => invocation.args[0])).toEqual(["queue", "exec"]);
  });

  it("does not apply the fallback to an explicitly queued reply", async () => {
    const recorder = recordingSpawner([
      processResult(1, "No active session found matching thread"),
      processResult(0),
    ]);
    let readCount = 0;
    const service = new CodexSessionsService({
      codexPath: "/safe/codex",
      processSpawner: recorder.spawner,
      localSessionScanner: async () => {
        readCount += 1;
        return [localRecord({ activity: "idle" })];
      },
      appServerRequest: async () => { throw new Error("offline"); },
    });

    await expect(service.sendReply({
      threadId: THREAD_ID,
      message: "保持 queue transport",
      mode: "queue",
      activity: "running",
    })).rejects.toThrow("No active session");
    expect(readCount).toBe(0);
    expect(recorder.invocations).toHaveLength(1);
  });

  it("retains bounded summaries from both command output streams", async () => {
    const recorder = recordingSpawner([processResult(1, "stderr detail", "stdout detail")]);
    const service = new CodexSessionsService({ codexPath: "/safe/codex", processSpawner: recorder.spawner });

    await expect(service.sendReply({
      threadId: THREAD_ID,
      message: "显示错误",
      activity: "running",
    })).rejects.toThrow(/stderr detail.*stdout detail/);
  });

  it("surfaces an immediate resume failure instead of reporting a false start", async () => {
    const recorder = recordingSpawner([
      processResult(1, "Not inside a trusted directory and --skip-git-repo-check was not specified."),
    ]);
    const service = new CodexSessionsService({ codexPath: "/safe/codex", processSpawner: recorder.spawner });

    await expect(service.sendReply({
      threadId: THREAD_ID,
      message: "继续",
      activity: "idle",
      cwd: "/Users/example/project",
    })).rejects.toThrow("Not inside a trusted directory");
  });

  it("does not report success when Codex exits cleanly without turn.started", async () => {
    const service = new CodexSessionsService({
      codexPath: "/safe/codex",
      processSpawner: () => ({
        pid: 9001,
        startup: Promise.resolve(false),
        completion: Promise.resolve(processResult(0)),
        cancel: () => undefined,
      }),
    });

    await expect(service.sendReply({
      threadId: THREAD_ID,
      message: "继续",
      activity: "idle",
      cwd: "/tmp",
    })).rejects.toThrow("before acknowledging turn.started");
  });

  it("rejects empty replies before spawning a process", async () => {
    const recorder = recordingSpawner();
    const service = new CodexSessionsService({ processSpawner: recorder.spawner });
    await expect(service.sendReply({ threadId: THREAD_ID, message: "   " })).rejects.toThrow(
      "Reply message must not be empty",
    );
    expect(recorder.invocations).toHaveLength(0);
  });
});
