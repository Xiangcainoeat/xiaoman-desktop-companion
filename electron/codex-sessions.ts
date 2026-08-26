import { spawn } from "node:child_process";
import { constants as fsConstants, existsSync } from "node:fs";
import { access, open, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const CODEX_DESKTOP_BUNDLE_ID = "com.openai.codex";
export const CODEX_DESKTOP_SCHEME = "codex";
export const DEFAULT_CODEX_APP_PATH = "/Applications/ChatGPT.app";
export const DEFAULT_BUNDLED_CODEX_PATH = `${DEFAULT_CODEX_APP_PATH}/Contents/Resources/codex`;

const COMMON_CODEX_DESKTOP_APP_PATHS = [
  DEFAULT_CODEX_APP_PATH,
  "/Applications/Codex.app",
  path.join(os.homedir(), "Applications/ChatGPT.app"),
  path.join(os.homedir(), "Applications/Codex.app"),
] as const;

const MAX_MESSAGE_LENGTH = 16_000;
const MAX_PROCESS_OUTPUT = 1024 * 1024;
const MAX_JSON_RPC_LINE = 8 * 1024 * 1024;
const LOG_HEAD_BYTES = 128 * 1024;
const LOG_TAIL_BYTES = 4 * 1024 * 1024;
const DEFAULT_ACTIVE_STALE_MS = 12 * 60 * 60 * 1000;
const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const RESUME_STARTUP_GRACE_MS = 700;
const RESUME_STARTUP_TIMEOUT_MS = 5_000;
const PROCESS_KILL_GRACE_MS = 1_500;
const DEFAULT_APP_SERVER_TIMEOUT_MS = 8_000;
const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

type JsonObject = Record<string, unknown>;

export function getCodexDesktopAppCandidates(preferredPath?: string): string[] {
  return [...new Set([
    preferredPath,
    ...COMMON_CODEX_DESKTOP_APP_PATHS,
  ].filter((candidate): candidate is string => Boolean(candidate)).map((candidate) => path.resolve(candidate)))];
}

export type CodexSessionActivity = "running" | "waiting" | "idle" | "error" | "unknown";

export interface CodexSessionStatus {
  activity: CodexSessionActivity;
  runtimeType: string | null;
  activeFlags: string[];
  activeTurnId: string | null;
  inferredFromLog: boolean;
}

export interface CodexSessionSummary {
  id: string;
  sessionId: string;
  title: string;
  preview: string;
  cwd: string | null;
  path: string | null;
  createdAt: number;
  updatedAt: number;
  source: string | null;
  threadSource: string | null;
  isSubagent: boolean;
  canAcceptDirectInput: boolean;
  status: CodexSessionStatus;
  desktopUrl: string;
}

export interface CodexSessionListOptions {
  limit?: number;
  includeSubagents?: boolean;
}

export interface CodexSessionListResult {
  sessions: CodexSessionSummary[];
  source: "app-server+logs" | "app-server" | "logs" | "unavailable";
  warnings: string[];
}

export interface CodexDesktopTarget {
  available: boolean;
  appPath: string;
  bundleId: typeof CODEX_DESKTOP_BUNDLE_ID;
  scheme: typeof CODEX_DESKTOP_SCHEME;
  url: string;
  source: "official-deep-link";
}

export interface CodexRuntimeInfo {
  cliPath: string;
  cliAvailable: boolean;
  desktopAppPath: string;
  desktopAppAvailable: boolean;
  desktopBundleId: typeof CODEX_DESKTOP_BUNDLE_ID;
  desktopScheme: typeof CODEX_DESKTOP_SCHEME;
  threadDeepLinkTemplate: "codex://threads/<thread-id>";
}

export interface CodexLocalSessionRecord {
  id: string;
  sessionId: string;
  cwd: string | null;
  filePath: string;
  createdAt: number;
  updatedAt: number;
  preview: string;
  source: string | null;
  threadSource: string | null;
  isSubagent: boolean;
  activity: CodexSessionActivity;
  activeTurnId: string | null;
  lastOutcome: "completed" | "failed" | "aborted" | null;
}

export interface ParseCodexSessionLogOptions {
  filePath: string;
  modifiedAt: number;
  now?: number;
  activeStaleMs?: number;
}

export interface CodexLocalScanOptions {
  sessionsRoot: string;
  limit: number;
  includeSubagents?: boolean;
  preferredPaths?: string[];
  now: number;
  activeStaleMs: number;
}

export type CodexLocalSessionScanner = (
  options: CodexLocalScanOptions,
) => Promise<CodexLocalSessionRecord[]>;

export type CodexAppServerRequester = (
  method: string,
  params: JsonObject,
) => Promise<unknown>;

export interface CodexProcessInvocation {
  executable: string;
  args: readonly string[];
  stdin?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  killGraceMs?: number;
}

export interface CodexProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface CodexProcessHandle {
  pid: number | null;
  startup: Promise<boolean>;
  completion: Promise<CodexProcessResult>;
  cancel: () => void;
}

export type CodexProcessSpawner = (invocation: CodexProcessInvocation) => CodexProcessHandle;

export type CodexReplyMode = "auto" | "queue" | "resume";

export interface CodexReplyInput {
  threadId: string;
  message: string;
  mode?: CodexReplyMode;
  activity?: CodexSessionActivity;
  cwd?: string | null;
}

export interface CodexReplyDispatch extends CodexProcessHandle {
  transport: "queue" | "exec-resume";
  fallbackReason: string | null;
}

export interface CodexSessionsServiceOptions {
  codexPath?: string;
  codexHome?: string;
  sessionsRoot?: string;
  desktopAppPath?: string;
  platform?: NodeJS.Platform;
  commandTimeoutMs?: number;
  appServerTimeoutMs?: number;
  activeStaleMs?: number;
  now?: () => number;
  appServerRequest?: CodexAppServerRequester;
  localSessionScanner?: CodexLocalSessionScanner;
  processSpawner?: CodexProcessSpawner;
}

export class CodexSessionCommandError extends Error {
  constructor(
    message: string,
    readonly transport: "queue" | "exec-resume",
    readonly result?: CodexProcessResult,
  ) {
    super(message);
    this.name = "CodexSessionCommandError";
  }
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeTimestamp(value: unknown, fallback = 0): number {
  const numeric = numberValue(value);
  if (numeric !== null) return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  const text = stringValue(value);
  if (!text) return fallback;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compactText(value: unknown, maxLength = 140): string {
  const text = typeof value === "string" ? value : "";
  const compact = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function sourceName(value: unknown): string | null {
  if (typeof value === "string") return compactText(value, 80) || null;
  const object = asObject(value);
  if (!object) return null;
  return stringValue(object.type)
    ?? stringValue(object.name)
    ?? ("subagent" in object ? "subAgent" : "object");
}

function recordTimestamp(record: JsonObject, fallback: number): number {
  const payload = asObject(record.payload);
  return normalizeTimestamp(
    record.timestamp
      ?? payload?.started_at
      ?? payload?.completed_at,
    fallback,
  );
}

function isRequestUserInput(payload: JsonObject): boolean {
  const payloadType = stringValue(payload.type)?.toLowerCase() ?? "";
  if (payloadType !== "custom_tool_call" && payloadType !== "function_call") return false;
  return (stringValue(payload.name)?.toLowerCase() ?? "").includes("request_user_input");
}

export function isValidCodexThreadId(threadId: string): boolean {
  return THREAD_ID_PATTERN.test(threadId);
}

function requireThreadId(threadId: string): string {
  const value = threadId.trim();
  if (!isValidCodexThreadId(value)) {
    throw new TypeError("Invalid Codex thread id");
  }
  return value;
}

function requireMessage(message: string): string {
  const value = message.trim();
  if (!value) throw new TypeError("Reply message must not be empty");
  if (value.length > MAX_MESSAGE_LENGTH) {
    throw new TypeError(`Reply message exceeds ${MAX_MESSAGE_LENGTH} characters`);
  }
  if (value.includes("\u0000")) throw new TypeError("Reply message contains a NUL character");
  return value;
}

export function getCodexThreadDeepLink(threadId: string): string {
  return `codex://threads/${encodeURIComponent(requireThreadId(threadId))}`;
}

export function buildCodexQueueArgs(threadId: string, message: string): string[] {
  return ["queue", "--thread", requireThreadId(threadId), "--message", requireMessage(message)];
}

export function buildCodexResumeArgs(threadId: string): string[] {
  return ["exec", "resume", "--skip-git-repo-check", requireThreadId(threadId), "-", "--json"];
}

function findSessionMetadata(text: string): JsonObject | null {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = asObject(JSON.parse(line) as unknown);
      if (record?.type === "session_meta") return asObject(record.payload);
    } catch {
      // A partial or malformed line cannot supply session metadata.
    }
  }
  return null;
}

function isSubagentMetadata(metadata: JsonObject): boolean {
  const source = sourceName(metadata.source);
  return source?.toLowerCase().includes("subagent") === true
    || Boolean(stringValue(metadata.parent_thread_id) && stringValue(metadata.agent_nickname));
}

export function parseCodexSessionLog(
  text: string,
  options: ParseCodexSessionLogOptions,
): CodexLocalSessionRecord | null {
  let metadata: JsonObject | null = null;
  let preview = "";
  let activity: CodexSessionActivity = "idle";
  let activeTurnId: string | null = null;
  let lastLifecycleAt = 0;
  let lastOutcome: CodexLocalSessionRecord["lastOutcome"] = null;

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let record: JsonObject;
    try {
      const parsed = JSON.parse(line) as unknown;
      const object = asObject(parsed);
      if (!object) continue;
      record = object;
    } catch {
      continue;
    }

    const type = stringValue(record.type);
    const payload = asObject(record.payload) ?? {};
    const payloadType = stringValue(payload.type);
    const at = recordTimestamp(record, options.modifiedAt);

    if (type === "session_meta" && metadata === null) {
      metadata = payload;
      continue;
    }

    if (type === "event_msg" && payloadType === "user_message") {
      if (!preview) preview = compactText(payload.message, 180);
      if (activity === "waiting" && activeTurnId) activity = "running";
      continue;
    }

    if (type === "event_msg" && payloadType === "task_started") {
      activeTurnId = stringValue(payload.turn_id);
      activity = "running";
      lastOutcome = null;
      lastLifecycleAt = at;
      continue;
    }

    if (type === "response_item" && isRequestUserInput(payload)) {
      activity = "waiting";
      lastLifecycleAt = at;
      continue;
    }

    if (type === "event_msg" && (payloadType === "task_complete" || payloadType === "turn_aborted")) {
      const completedTurnId = stringValue(payload.turn_id);
      if (!activeTurnId || !completedTurnId || completedTurnId === activeTurnId) {
        activeTurnId = null;
        activity = "idle";
        lastOutcome = payloadType === "turn_aborted"
          ? "aborted"
          : payload.error
            ? "failed"
            : "completed";
        lastLifecycleAt = at;
      }
    }
  }

  if (!metadata) return null;
  const id = stringValue(metadata.id);
  if (!id || !isValidCodexThreadId(id)) return null;

  const now = options.now ?? Date.now();
  const activeStaleMs = options.activeStaleMs ?? DEFAULT_ACTIVE_STALE_MS;
  if (
    (activity === "running" || activity === "waiting")
    && now - Math.max(lastLifecycleAt, options.modifiedAt) > activeStaleMs
  ) {
    activity = "idle";
    activeTurnId = null;
  }

  const source = sourceName(metadata.source);
  return {
    id,
    sessionId: stringValue(metadata.session_id) ?? id,
    cwd: stringValue(metadata.cwd),
    filePath: path.resolve(options.filePath),
    createdAt: normalizeTimestamp(metadata.timestamp, options.modifiedAt),
    updatedAt: options.modifiedAt,
    preview,
    source,
    threadSource: stringValue(metadata.thread_source),
    isSubagent: isSubagentMetadata(metadata),
    activity,
    activeTurnId,
    lastOutcome,
  };
}

async function readSessionPrefix(filePath: string, size: number): Promise<string> {
  const file = await open(filePath, "r");
  try {
    const length = Math.min(LOG_HEAD_BYTES, size);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}

async function readSessionWindow(filePath: string, size: number): Promise<string> {
  const file = await open(filePath, "r");
  try {
    if (size <= LOG_HEAD_BYTES + LOG_TAIL_BYTES) {
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await file.read(buffer, 0, size, 0);
      return buffer.subarray(0, bytesRead).toString("utf8");
    }

    const head = Buffer.alloc(LOG_HEAD_BYTES);
    const headRead = await file.read(head, 0, head.length, 0);
    const headText = head.subarray(0, headRead.bytesRead).toString("utf8");
    const prefixLines: string[] = [];
    let foundPreview = false;
    for (const line of headText.split("\n")) {
      try {
        const record = asObject(JSON.parse(line) as unknown);
        const payload = asObject(record?.payload);
        if (record?.type === "session_meta") prefixLines.push(line);
        if (!foundPreview && record?.type === "event_msg" && payload?.type === "user_message") {
          prefixLines.push(line);
          foundPreview = true;
        }
      } catch {
        // A partial final head line is ignored.
      }
    }
    const lifecycleLines: string[] = [];
    let position = size;
    let rightPartial = "";
    let foundBoundary = false;
    while (position > 0 && !foundBoundary) {
      const chunkSize = Math.min(LOG_TAIL_BYTES, position);
      const start = position - chunkSize;
      const chunk = Buffer.alloc(chunkSize);
      const readResult = await file.read(chunk, 0, chunkSize, start);
      const text = `${chunk.subarray(0, readResult.bytesRead).toString("utf8")}${rightPartial}`;
      const lines = text.split("\n");
      rightPartial = start > 0 ? lines.shift() ?? "" : "";
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (!line.trim()) continue;
        try {
          const record = asObject(JSON.parse(line) as unknown);
          const payload = asObject(record?.payload);
          const payloadType = stringValue(payload?.type);
          const lifecycleEvent = record?.type === "event_msg"
            && (payloadType === "task_started"
              || payloadType === "task_complete"
              || payloadType === "turn_aborted"
              || payloadType === "user_message");
          const waitingEvent = record?.type === "response_item" && isRequestUserInput(payload ?? {});
          if (!lifecycleEvent && !waitingEvent) continue;
          lifecycleLines.push(line);
          if (payloadType === "task_started" || payloadType === "task_complete" || payloadType === "turn_aborted") {
            foundBoundary = true;
            break;
          }
        } catch {
          // Non-lifecycle and partial records are skipped while scanning backward.
        }
      }
      position = start;
    }
    return `${prefixLines.join("\n")}\n${lifecycleLines.reverse().join("\n")}`;
  } finally {
    await file.close();
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function collectSessionFiles(
  directory: string,
  depth: number,
  output: string[],
): Promise<void> {
  if (depth > 6) return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectSessionFiles(entryPath, depth + 1, output);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) output.push(entryPath);
  }
}

export const scanLocalCodexSessions: CodexLocalSessionScanner = async (options) => {
  const root = path.resolve(options.sessionsRoot);
  const preferred = (options.preferredPaths ?? [])
    .map((filePath) => path.resolve(filePath))
    .filter((filePath) => filePath.endsWith(".jsonl") && isPathInside(root, filePath));

  const allFiles: string[] = [];
  await collectSessionFiles(root, 0, allFiles);
  const uniqueFiles = [...new Set([...preferred, ...allFiles])];
  const candidates: Array<{ filePath: string; size: number; modifiedAt: number }> = [];

  for (const filePath of uniqueFiles) {
    try {
      const details = await stat(filePath);
      if (!details.isFile()) continue;
      candidates.push({ filePath, size: details.size, modifiedAt: details.mtimeMs });
    } catch {
      // A rollout may rotate while the directory is being enumerated.
    }
  }

  const preferredSet = new Set(preferred);
  const includeSubagents = options.includeSubagents ?? true;
  candidates.sort((left, right) => {
    const preferredDelta = Number(preferredSet.has(right.filePath)) - Number(preferredSet.has(left.filePath));
    return preferredDelta || right.modifiedAt - left.modifiedAt;
  });

  const records: CodexLocalSessionRecord[] = [];
  for (const candidate of candidates) {
    try {
      let text: string;
      if (!includeSubagents) {
        const prefix = await readSessionPrefix(candidate.filePath, candidate.size);
        const metadata = findSessionMetadata(prefix);
        if (metadata && isSubagentMetadata(metadata)) continue;
        text = candidate.size <= LOG_HEAD_BYTES
          ? prefix
          : await readSessionWindow(candidate.filePath, candidate.size);
      } else {
        text = await readSessionWindow(candidate.filePath, candidate.size);
      }
      const record = parseCodexSessionLog(text, {
        filePath: candidate.filePath,
        modifiedAt: candidate.modifiedAt,
        now: options.now,
        activeStaleMs: options.activeStaleMs,
      });
      if (record && (includeSubagents || !record.isSubagent)) records.push(record);
    } catch {
      // Listing remains best-effort when an individual rollout is unreadable.
    }
    if (records.length >= options.limit) break;
  }
  return records;
};

function boundedAppend(current: string, chunk: Buffer | string): string {
  if (current.length >= MAX_PROCESS_OUTPUT) return current;
  return `${current}${chunk.toString()}`.slice(0, MAX_PROCESS_OUTPUT);
}

export const spawnCodexProcess: CodexProcessSpawner = (invocation) => {
  const child = spawn(invocation.executable, [...invocation.args], {
    cwd: invocation.cwd,
    env: invocation.env,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let timer: NodeJS.Timeout | null = null;
  let forceKillTimer: NodeJS.Timeout | null = null;
  let forcedSettleTimer: NodeJS.Timeout | null = null;
  let terminating = false;
  let startupBuffer = "";
  const killGraceMs = Math.max(10, invocation.killGraceMs ?? PROCESS_KILL_GRACE_MS);
  let startupSettled = false;
  let resolveStartup!: (acknowledged: boolean) => void;
  const startup = new Promise<boolean>((resolve) => {
    resolveStartup = resolve;
  });

  const finishStartup = (acknowledged: boolean): void => {
    if (startupSettled) return;
    startupSettled = true;
    resolveStartup(acknowledged);
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    stdout = boundedAppend(stdout, chunk);
    if (startupSettled) return;
    startupBuffer = `${startupBuffer}${chunk.toString("utf8")}`.slice(-MAX_JSON_RPC_LINE);
    const lines = startupBuffer.split("\n");
    startupBuffer = lines.pop() ?? "";
    for (const line of lines) {
      try {
        const message = asObject(JSON.parse(line) as unknown);
        if (message?.type === "turn.started") {
          finishStartup(true);
          break;
        }
      } catch {
        // Non-JSON diagnostics do not acknowledge a resumed turn.
      }
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = boundedAppend(stderr, chunk);
  });
  child.stdin?.on("error", () => {
    // Process exit is reported through completion; avoid an unhandled EPIPE.
  });
  child.stdin?.end(invocation.stdin);

  let completionSettled = false;
  let resolveCompletion!: (result: CodexProcessResult) => void;
  let rejectCompletion!: (error: Error) => void;
  const completion = new Promise<CodexProcessResult>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  const clearProcessTimers = (): void => {
    if (timer) clearTimeout(timer);
    if (forceKillTimer) clearTimeout(forceKillTimer);
    if (forcedSettleTimer) clearTimeout(forcedSettleTimer);
  };
  const resolveProcess = (result: CodexProcessResult): void => {
    if (completionSettled) return;
    completionSettled = true;
    clearProcessTimers();
    finishStartup(false);
    resolveCompletion(result);
  };
  const rejectProcess = (error: Error): void => {
    if (completionSettled) return;
    completionSettled = true;
    clearProcessTimers();
    finishStartup(false);
    rejectCompletion(error);
  };
  const terminate = (reason: string): void => {
    if (completionSettled || terminating) return;
    terminating = true;
    stderr = boundedAppend(stderr, `\n${reason}`);
    child.kill("SIGTERM");
    forceKillTimer = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
    forceKillTimer.unref?.();
    forcedSettleTimer = setTimeout(() => {
      resolveProcess({ code: null, signal: "SIGKILL", stdout, stderr });
    }, killGraceMs * 2);
    forcedSettleTimer.unref?.();
  };

  child.once("error", (error) => {
    rejectProcess(error);
  });
  child.once("close", (code, signal) => {
    resolveProcess({ code, signal, stdout, stderr });
  });
  if (invocation.timeoutMs && invocation.timeoutMs > 0) {
    timer = setTimeout(() => terminate(`Codex command timed out after ${invocation.timeoutMs} ms`), invocation.timeoutMs);
    timer.unref?.();
  }

  return {
    pid: child.pid ?? null,
    startup,
    completion,
    cancel: () => terminate("Codex command was cancelled"),
  };
};

function jsonRpcErrorMessage(error: unknown): string {
  const object = asObject(error);
  return compactText(object?.message, 400) || "Codex app-server request failed";
}

async function requestAppServerProcess(
  executable: string,
  args: string[],
  method: string,
  params: JsonObject,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let settled = false;
    let stdoutBuffer = "";
    let stderr = "";
    let forceKillTimer: NodeJS.Timeout | null = null;

    const finish = (error: Error | null, value?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin?.end();
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), PROCESS_KILL_GRACE_MS);
      forceKillTimer.unref?.();
      if (error) reject(error);
      else resolve(value);
    };

    const parseLines = (): void => {
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      if (stdoutBuffer.length > MAX_JSON_RPC_LINE) {
        finish(new Error("Codex app-server response exceeded the safe line limit"));
        return;
      }
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: JsonObject | null = null;
        try {
          message = asObject(JSON.parse(line) as unknown);
        } catch {
          continue;
        }
        if (message?.id !== 2) continue;
        if (message.error) finish(new Error(jsonRpcErrorMessage(message.error)));
        else finish(null, message.result);
        return;
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      parseLines();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = boundedAppend(stderr, chunk);
    });
    child.stdin?.on("error", (error) => finish(error));
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (!settled) {
        const details = compactText(stderr, 500);
        finish(new Error(details || `Codex app-server exited before responding (code ${code ?? "unknown"})`));
      }
    });

    const timer = setTimeout(() => {
      finish(new Error(`Codex app-server request timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    timer.unref?.();

    child.once("spawn", () => {
      const messages = [
        {
          method: "initialize",
          id: 1,
          params: {
            clientInfo: {
              name: "xiaoman_desktop_companion",
              title: "Xiaoman Desktop Companion",
              version: "1.1.1",
            },
            capabilities: {
              optOutNotificationMethods: [
                "thread/started",
                "thread/status/changed",
                "item/agentMessage/delta",
              ],
            },
          },
        },
        { method: "initialized", params: {} },
        { method, id: 2, params },
      ];
      child.stdin?.write(`${messages.map((message) => JSON.stringify(message)).join("\n")}\n`);
    });
  });
}

function createDefaultAppServerRequester(
  executable: string,
  codexHome: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): CodexAppServerRequester {
  return async (method, params) => {
    const controlSocket = path.join(codexHome, "app-server-control", "app-server-control.sock");
    if (!existsSync(controlSocket)) {
      throw new Error("Codex app-server daemon is unavailable");
    }
    return await requestAppServerProcess(
      executable,
      ["app-server", "proxy", "--sock", controlSocket],
      method,
      params,
      env,
      timeoutMs,
    );
  };
}

function normalizeRuntimeStatus(value: unknown): Omit<CodexSessionStatus, "activeTurnId" | "inferredFromLog"> {
  const object = asObject(value);
  const runtimeType = stringValue(object?.type);
  const activeFlags = Array.isArray(object?.activeFlags)
    ? object.activeFlags.map(stringValue).filter((flag): flag is string => Boolean(flag))
    : [];
  const loweredFlags = activeFlags.map((flag) => flag.toLowerCase());
  if (runtimeType === "active") {
    const waiting = loweredFlags.some((flag) => flag.includes("waiting") || flag.includes("approval"));
    return { activity: waiting ? "waiting" : "running", runtimeType, activeFlags };
  }
  if (runtimeType === "systemError") return { activity: "error", runtimeType, activeFlags };
  if (runtimeType === "idle" || runtimeType === "notLoaded") {
    return { activity: "idle", runtimeType, activeFlags };
  }
  return { activity: "unknown", runtimeType, activeFlags };
}

function isAppServerThread(value: unknown): value is JsonObject {
  const object = asObject(value);
  return Boolean(object && stringValue(object.id) && isValidCodexThreadId(stringValue(object.id)!));
}

function normalizeAppServerThread(value: JsonObject): CodexSessionSummary {
  const id = requireThreadId(stringValue(value.id)!);
  const cwd = stringValue(value.cwd);
  const preview = compactText(value.preview, 180);
  const name = compactText(value.name, 100);
  const source = sourceName(value.source);
  const threadSource = stringValue(value.threadSource);
  const status = normalizeRuntimeStatus(value.status);
  const filePath = stringValue(value.path);
  const createdAt = normalizeTimestamp(value.createdAt);
  const updatedAt = normalizeTimestamp(value.updatedAt ?? value.recencyAt, createdAt);
  const parentThreadId = stringValue(value.parentThreadId);
  const agentRole = stringValue(value.agentRole)?.toLowerCase() ?? "";
  return {
    id,
    sessionId: stringValue(value.sessionId) ?? id,
    title: name || preview || (cwd ? path.basename(cwd) : "未命名任务"),
    preview,
    cwd,
    path: filePath ? path.resolve(filePath) : null,
    createdAt,
    updatedAt,
    source,
    threadSource,
    isSubagent: agentRole.includes("subagent")
      || source?.toLowerCase().includes("subagent") === true
      || threadSource?.toLowerCase().includes("subagent") === true
      || Boolean(parentThreadId && value.agentNickname),
    canAcceptDirectInput: value.canAcceptDirectInput === true,
    status: {
      ...status,
      activeTurnId: null,
      inferredFromLog: false,
    },
    desktopUrl: getCodexThreadDeepLink(id),
  };
}

function localSessionSummary(record: CodexLocalSessionRecord): CodexSessionSummary {
  return {
    id: record.id,
    sessionId: record.sessionId,
    title: record.preview || (record.cwd ? path.basename(record.cwd) : "未命名任务"),
    preview: record.preview,
    cwd: record.cwd,
    path: record.filePath,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    source: record.source,
    threadSource: record.threadSource,
    isSubagent: record.isSubagent,
    canAcceptDirectInput: record.activity === "running" || record.activity === "waiting",
    status: {
      activity: record.activity,
      runtimeType: null,
      activeFlags: [],
      activeTurnId: record.activeTurnId,
      inferredFromLog: true,
    },
    desktopUrl: getCodexThreadDeepLink(record.id),
  };
}

function hasApprovalFlag(flags: readonly string[]): boolean {
  return flags.some((flag) => flag.toLowerCase().includes("approval"));
}

function isResumableActivity(activity: CodexSessionActivity): boolean {
  return activity === "idle" || activity === "error";
}

export function canReplyToCodexSession(
  session: Pick<CodexSessionSummary, "canAcceptDirectInput" | "status">,
): boolean {
  if (hasApprovalFlag(session.status.activeFlags)) return false;
  const inferredActive = session.status.inferredFromLog
    && (session.status.activity === "running" || session.status.activity === "waiting");
  return session.canAcceptDirectInput || inferredActive || isResumableActivity(session.status.activity);
}

function mergeLocalStatus(
  session: CodexSessionSummary,
  local: CodexLocalSessionRecord | undefined,
): CodexSessionSummary {
  if (!local) return session;
  const localIsActive = local.activity === "running" || local.activity === "waiting";
  const runtimeIsActive = session.status.activity === "running" || session.status.activity === "waiting";
  const shouldUseLocal = localIsActive || !runtimeIsActive && session.status.activity === "unknown";
  const approvalBlocked = hasApprovalFlag(session.status.activeFlags);
  return {
    ...session,
    sessionId: session.sessionId || local.sessionId,
    preview: session.preview || local.preview,
    title: session.title === "未命名任务" && local.preview ? local.preview : session.title,
    cwd: session.cwd ?? local.cwd,
    path: session.path ?? local.filePath,
    createdAt: session.createdAt || local.createdAt,
    updatedAt: Math.max(session.updatedAt, local.updatedAt),
    source: session.source ?? local.source,
    threadSource: session.threadSource ?? local.threadSource,
    isSubagent: session.isSubagent || local.isSubagent,
    canAcceptDirectInput: !approvalBlocked && (session.canAcceptDirectInput || localIsActive),
    status: shouldUseLocal
      ? {
          activity: local.activity,
          runtimeType: session.status.runtimeType,
          activeFlags: session.status.activeFlags,
          activeTurnId: local.activeTurnId,
          inferredFromLog: true,
        }
      : session.status,
  };
}

export function summarizeCodexProcessResult(result: CodexProcessResult): string {
  const outputs = [result.stderr, result.stdout].filter((output) => output.trim());
  let summary = "";
  if (outputs.length > 1) {
    const streamLimit = 248;
    summary = outputs
      .map((output) => compactText(output, streamLimit))
      .join(" | ");
  } else if (outputs.length === 1) {
    summary = compactText(outputs[0], 500);
  }
  return compactText(summary, 500) || `Codex exited with code ${result.code ?? "unknown"}`;
}

function processFailure(result: CodexProcessResult): string {
  return summarizeCodexProcessResult(result);
}

function isActiveSessionNotFoundError(error: unknown): error is CodexSessionCommandError {
  if (!(error instanceof CodexSessionCommandError) || error.transport !== "queue") return false;
  const matches = (detail: string): boolean => /no\s+active\s+session/i.test(detail)
    || /active\s+session.*(?:not\s+found|does\s+not\s+exist|missing)/i.test(detail);
  if (error.result) return [error.result.stderr, error.result.stdout].some(matches);
  return matches(error.message);
}

async function usableWorkingDirectory(cwd: string | null | undefined): Promise<string | undefined> {
  if (!cwd || !path.isAbsolute(cwd)) return undefined;
  try {
    const details = await stat(cwd);
    return details.isDirectory() ? cwd : undefined;
  } catch {
    return undefined;
  }
}

async function commandExists(executable: string): Promise<boolean> {
  if (!path.isAbsolute(executable)) return true;
  try {
    await access(executable, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export class CodexSessionsService {
  readonly codexPath: string;
  readonly codexHome: string;
  readonly sessionsRoot: string;
  readonly desktopAppPath: string;

  private readonly platform: NodeJS.Platform;
  private readonly commandTimeoutMs: number;
  private readonly activeStaleMs: number;
  private readonly now: () => number;
  private readonly env: NodeJS.ProcessEnv;
  private readonly appServerRequest: CodexAppServerRequester;
  private readonly localSessionScanner: CodexLocalSessionScanner;
  private readonly processSpawner: CodexProcessSpawner;

  private getAvailableDesktopAppPath(): string {
    return getCodexDesktopAppCandidates(this.desktopAppPath).find((candidate) => existsSync(candidate))
      ?? this.desktopAppPath;
  }

  constructor(options: CodexSessionsServiceOptions = {}) {
    this.codexHome = path.resolve(options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"));
    this.sessionsRoot = path.resolve(options.sessionsRoot ?? path.join(this.codexHome, "sessions"));
    this.desktopAppPath = path.resolve(options.desktopAppPath ?? DEFAULT_CODEX_APP_PATH);
    this.codexPath = options.codexPath
      ?? (existsSync(DEFAULT_BUNDLED_CODEX_PATH) ? DEFAULT_BUNDLED_CODEX_PATH : "codex");
    this.platform = options.platform ?? process.platform;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.activeStaleMs = options.activeStaleMs ?? DEFAULT_ACTIVE_STALE_MS;
    this.now = options.now ?? Date.now;
    this.env = { ...process.env, CODEX_HOME: this.codexHome };
    this.localSessionScanner = options.localSessionScanner ?? scanLocalCodexSessions;
    this.processSpawner = options.processSpawner ?? spawnCodexProcess;
    this.appServerRequest = options.appServerRequest ?? createDefaultAppServerRequester(
      this.codexPath,
      this.codexHome,
      this.env,
      options.appServerTimeoutMs ?? DEFAULT_APP_SERVER_TIMEOUT_MS,
    );
  }

  async getRuntimeInfo(): Promise<CodexRuntimeInfo> {
    const desktopAppPath = this.getAvailableDesktopAppPath();
    return {
      cliPath: this.codexPath,
      cliAvailable: await commandExists(this.codexPath),
      desktopAppPath,
      desktopAppAvailable: this.platform === "darwin" && existsSync(desktopAppPath),
      desktopBundleId: CODEX_DESKTOP_BUNDLE_ID,
      desktopScheme: CODEX_DESKTOP_SCHEME,
      threadDeepLinkTemplate: "codex://threads/<thread-id>",
    };
  }

  getDesktopTarget(threadId: string): CodexDesktopTarget {
    const appPath = this.getAvailableDesktopAppPath();
    return {
      available: this.platform === "darwin" && existsSync(appPath),
      appPath,
      bundleId: CODEX_DESKTOP_BUNDLE_ID,
      scheme: CODEX_DESKTOP_SCHEME,
      url: getCodexThreadDeepLink(threadId),
      source: "official-deep-link",
    };
  }

  async listSessions(options: CodexSessionListOptions = {}): Promise<CodexSessionListResult> {
    const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 30)));
    const includeSubagents = options.includeSubagents ?? false;
    const warnings: string[] = [];
    let appServerAvailable = false;
    let appThreads: JsonObject[] = [];

    try {
      const result = asObject(await this.appServerRequest("thread/list", {
        cursor: null,
        limit,
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: false,
        sourceKinds: ["cli", "vscode", "exec", "appServer"],
      }));
      appThreads = Array.isArray(result?.data)
        ? result.data.filter(isAppServerThread)
        : [];
      appServerAvailable = true;
    } catch {
      warnings.push("Codex app-server unavailable; using read-only local session logs.");
    }

    const preferredPaths = appThreads
      .map((thread) => stringValue(thread.path))
      .filter((filePath): filePath is string => Boolean(filePath));
    let localRecords: CodexLocalSessionRecord[] = [];
    try {
      localRecords = await this.localSessionScanner({
        sessionsRoot: this.sessionsRoot,
        limit: 100,
        includeSubagents,
        preferredPaths,
        now: this.now(),
        activeStaleMs: this.activeStaleMs,
      });
    } catch {
      warnings.push("Local Codex session logs could not be read.");
    }

    const localById = new Map(localRecords.map((record) => [record.id, record]));
    const localByPath = new Map(localRecords.map((record) => [path.resolve(record.filePath), record]));
    const matchedLocalIds = new Set<string>();
    const matchedLocalPaths = new Set<string>();
    const seenAppIds = new Set<string>();
    const seenAppPaths = new Set<string>();
    const sessions: CodexSessionSummary[] = [];
    for (const thread of appThreads) {
      const session = normalizeAppServerThread(thread);
      const normalizedPath = session.path ? path.resolve(session.path) : null;
      if (seenAppIds.has(session.id) || normalizedPath && seenAppPaths.has(normalizedPath)) continue;
      seenAppIds.add(session.id);
      if (normalizedPath) seenAppPaths.add(normalizedPath);
      const local = session.path ? localByPath.get(path.resolve(session.path)) : localById.get(session.id);
      const matchedLocal = local ?? localById.get(session.id);
      if (matchedLocal) {
        matchedLocalIds.add(matchedLocal.id);
        matchedLocalPaths.add(path.resolve(matchedLocal.filePath));
      }
      sessions.push(mergeLocalStatus(session, matchedLocal));
    }
    for (const record of localRecords) {
      if (matchedLocalIds.has(record.id) || matchedLocalPaths.has(path.resolve(record.filePath))) continue;
      sessions.push(localSessionSummary(record));
    }

    const filtered = sessions
      .filter((session) => includeSubagents || !session.isSubagent)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, limit);
    const hasLogs = localRecords.length > 0;
    const source = appServerAvailable && hasLogs
      ? "app-server+logs"
      : appServerAvailable
        ? "app-server"
        : hasLogs
          ? "logs"
          : "unavailable";
    return { sessions: filtered, source, warnings };
  }

  async readSession(threadId: string): Promise<CodexSessionSummary | null> {
    const id = requireThreadId(threadId);
    let appThread: JsonObject | null = null;
    try {
      const result = asObject(await this.appServerRequest("thread/read", {
        threadId: id,
        includeTurns: false,
      }));
      const candidate = result?.thread;
      if (isAppServerThread(candidate)) appThread = candidate;
    } catch {
      // The read-only log fallback below remains available without app-server.
    }

    const preferredPath = appThread ? stringValue(appThread.path) : null;
    const records = await this.localSessionScanner({
      sessionsRoot: this.sessionsRoot,
      limit: 100,
      preferredPaths: preferredPath ? [preferredPath] : undefined,
      now: this.now(),
      activeStaleMs: this.activeStaleMs,
    }).catch(() => []);
    const local = records.find((record) => record.id === id
      || Boolean(preferredPath && path.resolve(record.filePath) === path.resolve(preferredPath)));
    if (appThread) return mergeLocalStatus(normalizeAppServerThread(appThread), local);
    return local ? localSessionSummary(local) : null;
  }

  async sendReply(input: CodexReplyInput): Promise<CodexReplyDispatch> {
    const threadId = requireThreadId(input.threadId);
    const message = requireMessage(input.message);
    const mode = input.mode ?? "auto";
    const shouldResume = mode === "resume"
      || mode === "auto" && (input.activity === "idle" || input.activity === "error");
    if (shouldResume) return await this.startResume(threadId, message, null, input.cwd);

    if (mode !== "auto" || (input.activity !== "running" && input.activity !== "waiting")) {
      return await this.queueReply(threadId, message);
    }

    try {
      return await this.queueReply(threadId, message);
    } catch (error) {
      if (!isActiveSessionNotFoundError(error)) throw error;
      let freshSession: CodexSessionSummary | null = null;
      try {
        freshSession = await this.readSession(threadId);
      } catch {
        throw error;
      }
      if (
        !freshSession
        || !isResumableActivity(freshSession.status.activity)
        || !canReplyToCodexSession(freshSession)
      ) {
        throw error;
      }
      return await this.startResume(
        threadId,
        message,
        error.result ? summarizeCodexProcessResult(error.result) : error.message,
        freshSession.cwd,
      );
    }
  }

  async queueReply(threadId: string, message: string): Promise<CodexReplyDispatch> {
    const handle = this.processSpawner({
      executable: this.codexPath,
      args: buildCodexQueueArgs(threadId, message),
      env: this.env,
      timeoutMs: this.commandTimeoutMs,
    });
    const result = await handle.completion;
    if (result.code !== 0) {
      throw new CodexSessionCommandError(processFailure(result), "queue", result);
    }
    return {
      ...handle,
      completion: Promise.resolve(result),
      transport: "queue",
      fallbackReason: null,
    };
  }

  async continueSession(threadId: string, message: string, cwd?: string | null): Promise<CodexReplyDispatch> {
    return await this.startResume(requireThreadId(threadId), requireMessage(message), null, cwd);
  }

  private async startResume(
    threadId: string,
    message: string,
    fallbackReason: string | null,
    cwd?: string | null,
  ): Promise<CodexReplyDispatch> {
    const usableCwd = await usableWorkingDirectory(cwd);
    const handle = this.processSpawner({
      executable: this.codexPath,
      args: buildCodexResumeArgs(threadId),
      stdin: `${message}\n`,
      cwd: usableCwd,
      env: this.env,
    });
    const dispatch: CodexReplyDispatch = {
      ...handle,
      transport: "exec-resume",
      fallbackReason,
    };
    const startupAcknowledged = await Promise.race([
      handle.startup,
      new Promise<false>((resolve) => {
        const timer = setTimeout(() => resolve(false), RESUME_STARTUP_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
    if (startupAcknowledged) return dispatch;

    const earlyResult = await new Promise<CodexProcessResult | null>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        resolve(null);
      }, RESUME_STARTUP_GRACE_MS);
      timer.unref?.();
      handle.completion.then((result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }, (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
    if (earlyResult) {
      const reason = earlyResult.code === 0
        ? "Codex exited before acknowledging turn.started"
        : processFailure(earlyResult);
      throw new CodexSessionCommandError(reason, "exec-resume", earlyResult);
    }
    if (!earlyResult) {
      handle.cancel();
      throw new CodexSessionCommandError(
        `Codex did not acknowledge the resumed turn within ${RESUME_STARTUP_TIMEOUT_MS} ms`,
        "exec-resume",
      );
    }
    return dispatch;
  }
}
