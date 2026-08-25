import { describe, expect, it } from "vitest";
import { classifyCodexRecord } from "../electron/codex-monitor";

describe("Codex event classification", () => {
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
});
