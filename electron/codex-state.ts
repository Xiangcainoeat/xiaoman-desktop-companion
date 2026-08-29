import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_STATE_LIMIT = 30;
const MAX_STATE_LIMIT = 100;
const STATE_DB_NAME = /^state(?:_(\d+))?\.sqlite$/;

type SqlValue = string | number | bigint | null;
type StateRow = Record<string, SqlValue>;

export interface CodexStateThreadRecord {
  id: string;
  sessionId: string;
  rolloutPath: string | null;
  createdAt: number;
  updatedAt: number;
  source: string | null;
  cwd: string | null;
  title: string;
  preview: string;
  threadSource: string | null;
  agentNickname: string | null;
  agentRole: string | null;
  isSubagent: boolean;
  archived: boolean;
}

export interface CodexStateDbReadOptions {
  codexHome?: string;
  stateDbPath?: string;
  threadId?: string;
  limit?: number;
}

export type CodexStateDbReader = (
  options: CodexStateDbReadOptions,
) => Promise<CodexStateThreadRecord[]>;

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function compactText(value: unknown, maxLength = 180): string {
  const text = typeof value === "string" ? value : "";
  const compact = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function timestampMillis(value: unknown): number {
  const number = numberValue(value);
  if (number === null || number <= 0) return 0;
  return number < 1_000_000_000_000 ? number * 1000 : number;
}

function firstPositiveTimestamp(...values: unknown[]): number {
  for (const value of values) {
    const timestamp = timestampMillis(value);
    if (timestamp > 0) return timestamp;
  }
  return 0;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const number = numberValue(value);
  if (number !== null) return number !== 0;
  return stringValue(value)?.toLowerCase() === "true";
}

function isSubagentRow(row: StateRow): boolean {
  const source = stringValue(row.source)?.toLowerCase() ?? "";
  const threadSource = stringValue(row.thread_source)?.toLowerCase() ?? "";
  const role = stringValue(row.agent_role)?.toLowerCase() ?? "";
  return source.includes("subagent") || threadSource.includes("subagent") || role.includes("subagent");
}

function resolveRolloutPath(value: unknown): string | null {
  const filePath = stringValue(value);
  if (!filePath) return null;
  return path.resolve(filePath);
}

function mapStateRow(row: StateRow): CodexStateThreadRecord | null {
  const id = stringValue(row.id);
  if (!id) return null;
  const sessionId = stringValue(row.session_id) ?? id;
  const rolloutPath = resolveRolloutPath(row.rollout_path);
  const cwd = stringValue(row.cwd);
  const preview = compactText(row.preview ?? row.first_user_message, 180);
  // `name` is the title Codex derives for the task. `title` is a legacy/raw
  // field and is frequently just the first user message in current databases.
  const title = compactText(row.name, 120)
    || (cwd ? path.basename(cwd) : "未命名任务");
  const createdAt = firstPositiveTimestamp(row.created_at_ms, row.created_at);
  const updatedAt = firstPositiveTimestamp(
    row.updated_at_ms,
    row.recency_at_ms,
    row.updated_at,
    row.recency_at,
    row.created_at_ms,
    row.created_at,
  );
  return {
    id,
    sessionId,
    rolloutPath,
    createdAt,
    updatedAt,
    source: stringValue(row.source),
    cwd,
    title,
    preview,
    threadSource: stringValue(row.thread_source),
    agentNickname: stringValue(row.agent_nickname),
    agentRole: stringValue(row.agent_role),
    isSubagent: isSubagentRow(row),
    archived: booleanValue(row.archived),
  };
}

function stateDbCandidates(codexHome: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(codexHome);
  } catch {
    return [];
  }
  return entries
    .map((name) => {
      const match = STATE_DB_NAME.exec(name);
      if (!match) return null;
      const filePath = path.join(codexHome, name);
      try {
        const details = statSync(filePath);
        if (!details.isFile()) return null;
        return {
          filePath,
          index: match[1] ? Number(match[1]) : 0,
          modifiedAt: details.mtimeMs,
        };
      } catch {
        return null;
      }
    })
    .filter((candidate): candidate is { filePath: string; index: number; modifiedAt: number } => candidate !== null)
    .sort((left, right) => right.index - left.index || right.modifiedAt - left.modifiedAt)
    .map((candidate) => candidate.filePath);
}

export function findCodexStateDb(codexHome = path.join(os.homedir(), ".codex")): string | null {
  const candidates = stateDbCandidates(path.resolve(codexHome));
  return candidates[0] ?? null;
}

const STATE_THREAD_QUERY = `
  SELECT
    id,
    rollout_path,
    created_at,
    updated_at,
    source,
    cwd,
    title,
    archived,
    first_user_message,
    agent_nickname,
    agent_role,
    preview,
    recency_at,
    recency_at_ms,
    name,
    thread_source,
    updated_at_ms,
    created_at_ms
  FROM threads
  WHERE archived = 0
    AND source IN ('vscode', 'appServer')
    AND (thread_source IS NULL OR lower(thread_source) NOT LIKE '%subagent%')
    AND (? IS NULL OR id = ?)
  ORDER BY
    COALESCE(
      NULLIF(updated_at_ms, 0),
      NULLIF(recency_at_ms, 0),
      updated_at * 1000,
      recency_at * 1000,
      created_at_ms,
      created_at * 1000
    ) DESC,
    id DESC
  LIMIT ?
`;

export const readCodexStateDb: CodexStateDbReader = async (options = {}) => {
  const codexHome = path.resolve(options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"));
  const candidatePath = options.stateDbPath ?? findCodexStateDb(codexHome);
  if (!candidatePath) {
    throw new Error(`Codex state database unavailable under ${codexHome}`);
  }
  const databasePath = path.resolve(candidatePath);
  if (!existsSync(databasePath)) throw new Error(`Codex state database is missing: ${databasePath}`);
  const limit = Math.max(1, Math.min(MAX_STATE_LIMIT, Math.trunc(options.limit ?? DEFAULT_STATE_LIMIT)));
  const threadId = options.threadId ?? null;
  const database = new DatabaseSync(databasePath, { readOnly: true, timeout: 1500 });
  try {
    const rows = database.prepare(STATE_THREAD_QUERY).all(threadId, threadId, limit) as unknown as StateRow[];
    return rows
      .map(mapStateRow)
      .filter((record): record is CodexStateThreadRecord => record !== null && !record.archived && !record.isSubagent);
  } finally {
    database.close();
  }
};
