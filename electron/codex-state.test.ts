import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findCodexStateDb, readCodexStateDb } from "./codex-state";

function createStateDb(filePath: string): DatabaseSync {
  const database = new DatabaseSync(filePath);
  database.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER,
      updated_at INTEGER,
      source TEXT,
      cwd TEXT,
      title TEXT,
      archived INTEGER,
      has_user_event INTEGER,
      first_user_message TEXT,
      agent_nickname TEXT,
      agent_role TEXT,
      preview TEXT,
      recency_at INTEGER,
      recency_at_ms INTEGER,
      history_mode TEXT,
      name TEXT,
      thread_source TEXT,
      updated_at_ms INTEGER,
      created_at_ms INTEGER
    )
  `);
  return database;
}

describe("Codex state database reader", () => {
  it("selects the newest canonical state database and ignores backup-like names", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "xiaoman-codex-state-"));
    try {
      const first = createStateDb(path.join(root, "state_2.sqlite"));
      first.close();
      const newest = createStateDb(path.join(root, "state_5.sqlite"));
      newest.close();
      const backup = createStateDb(path.join(root, "state_99.sqlite.backup"));
      backup.close();

      expect(findCodexStateDb(root)).toBe(path.join(root, "state_5.sqlite"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns only interactive user threads and maps state-db metadata", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "xiaoman-codex-state-"));
    const databasePath = path.join(root, "state_5.sqlite");
    const database = createStateDb(databasePath);
    const insert = database.prepare(`
      INSERT INTO threads (
        id, rollout_path, created_at, updated_at, source, cwd, title, archived,
        has_user_event, first_user_message, agent_nickname, agent_role, preview,
        recency_at, recency_at_ms, name, thread_source, updated_at_ms, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      "user-vscode",
      "/Users/zk/.codex/sessions/user.jsonl",
      1_700_000_000,
      1_700_000_100,
      "vscode",
      "/Users/zk/project",
      "状态库任务",
      0,
      1,
      "修复回复",
      null,
      null,
      "状态库预览",
      1_700_000_100,
      1_700_000_100_000,
      "状态库任务",
      "user",
      1_700_000_101_000,
      1_700_000_001_000,
    );
    insert.run(
      "exec-thread",
      "/tmp/exec.jsonl",
      1,
      2,
      "exec",
      "/tmp",
      "不应出现",
      0,
      1,
      "exec",
      null,
      null,
      "exec",
      2,
      2_000,
      "不应出现",
      "user",
      2_000,
      1_000,
    );
    insert.run(
      "subagent-thread",
      "/tmp/subagent.jsonl",
      1,
      3,
      "vscode",
      "/tmp",
      "不应出现",
      0,
      1,
      "subagent",
      "helper",
      "subagent",
      "subagent",
      3,
      3_000,
      "不应出现",
      "subagent",
      3_000,
      1_000,
    );
    insert.run(
      "archived-thread",
      "/tmp/archived.jsonl",
      1,
      4,
      "vscode",
      "/tmp",
      "不应出现",
      1,
      1,
      "archived",
      null,
      null,
      "archived",
      4,
      4_000,
      "不应出现",
      "user",
      4_000,
      1_000,
    );
    database.close();

    try {
      const records = await readCodexStateDb({ stateDbPath: databasePath, limit: 20 });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        id: "user-vscode",
        rolloutPath: "/Users/zk/.codex/sessions/user.jsonl",
        cwd: "/Users/zk/project",
        title: "状态库任务",
        preview: "状态库预览",
        source: "vscode",
        threadSource: "user",
        isSubagent: false,
        createdAt: 1_700_000_001_000,
        updatedAt: 1_700_000_101_000,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
