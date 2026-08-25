import { describe, expect, it } from "vitest";
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
});
