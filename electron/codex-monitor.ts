import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";

export type CodexMonitorEvent =
  | { kind: "started"; turnId: string; at: number; recovered?: boolean }
  | { kind: "waiting"; turnId: string; at: number; recovered?: boolean }
  | { kind: "completed"; turnId: string; at: number; durationMs: number | null }
  | { kind: "failed"; turnId: string; at: number; durationMs: number | null }
  | { kind: "aborted"; turnId: string; at: number };

interface JsonlRecord {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

export function classifyCodexRecord(record: JsonlRecord): CodexMonitorEvent | null {
  const payload = record.payload ?? {};
  const payloadType = typeof payload.type === "string" ? payload.type : "";
  const at = record.timestamp ? Date.parse(record.timestamp) || Date.now() : Date.now();
  const turnId = typeof payload.turn_id === "string" ? payload.turn_id : "unknown";

  if (record.type === "event_msg") {
    if (payloadType === "task_started") return { kind: "started", turnId, at };
    if (payloadType === "task_complete") {
      const durationMs = typeof payload.duration_ms === "number" ? payload.duration_ms : null;
      return { kind: payload.error ? "failed" : "completed", turnId, at, durationMs };
    }
    if (payloadType === "turn_aborted") return { kind: "aborted", turnId, at };
    return null;
  }

  if (record.type === "response_item" && (payloadType === "custom_tool_call" || payloadType === "function_call")) {
    const name = typeof payload.name === "string" ? payload.name.toLowerCase() : "";
    if (name.includes("request_user_input")) return { kind: "waiting", turnId, at };
  }
  return null;
}

const MAX_READ_BYTES = 1024 * 1024;
const RECOVERY_READ_BYTES = 8 * 1024 * 1024;
const RECOVERY_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export class CodexSessionMonitor {
  private watcher: FSWatcher | null = null;
  private readonly offsets = new Map<string, number>();
  private readonly remainders = new Map<string, string>();

  constructor(
    private readonly sessionsRoot: string,
    private readonly onEvent: (event: CodexMonitorEvent) => void,
    private readonly onAvailability: (available: boolean) => void,
  ) {}

  async start(): Promise<void> {
    if (this.watcher) return;
    if (!existsSync(this.sessionsRoot)) {
      this.onAvailability(false);
      return;
    }

    const existingFiles = this.primeExistingOffsets();
    this.recoverActiveTurns(existingFiles);
    this.watcher = chokidar.watch(this.sessionsRoot, {
      ignoreInitial: true,
      persistent: true,
      depth: 6,
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 25 },
    });
    this.watcher.on("add", (filePath) => this.handleFile(filePath, true));
    this.watcher.on("change", (filePath) => this.handleFile(filePath, false));
    this.watcher.on("error", () => this.onAvailability(false));
    this.onAvailability(true);
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
    this.offsets.clear();
    this.remainders.clear();
  }

  private primeExistingOffsets(): Array<{ filePath: string; modifiedAt: number }> {
    const files: Array<{ filePath: string; modifiedAt: number }> = [];
    try {
      const entries = readdirSync(this.sessionsRoot, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const parentPath = String(entry.parentPath);
        const filePath = path.join(parentPath, entry.name);
        try {
          const stats = statSync(filePath);
          this.offsets.set(filePath, stats.size);
          files.push({ filePath, modifiedAt: stats.mtimeMs });
        } catch {
          // A session can rotate while startup enumeration is in progress.
        }
      }
    } catch {
      this.onAvailability(false);
    }
    return files;
  }

  private recoverActiveTurns(files: Array<{ filePath: string; modifiedAt: number }>): void {
    const cutoff = Date.now() - RECOVERY_MAX_AGE_MS;
    const recentFiles = files
      .filter((file) => file.modifiedAt >= cutoff)
      .sort((left, right) => left.modifiedAt - right.modifiedAt)
      .slice(-16);
    const active = new Map<string, { started: Extract<CodexMonitorEvent, { kind: "started" }>; waiting: boolean }>();

    for (const { filePath } of recentFiles) {
      let descriptor: number | null = null;
      try {
        const size = statSync(filePath).size;
        const start = Math.max(0, size - RECOVERY_READ_BYTES);
        const buffer = Buffer.alloc(size - start);
        descriptor = openSync(filePath, "r");
        const bytesRead = readSync(descriptor, buffer, 0, buffer.length, start);
        let text = buffer.subarray(0, bytesRead).toString("utf8");
        if (start > 0) text = text.slice(Math.max(0, text.indexOf("\n") + 1));
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          let record: JsonlRecord;
          try {
            record = JSON.parse(line) as JsonlRecord;
          } catch {
            continue;
          }
          const event = classifyCodexRecord(record);
          if (!event || event.turnId === "unknown") continue;
          if (event.kind === "started") active.set(event.turnId, { started: event, waiting: false });
          else if (event.kind === "waiting" && active.has(event.turnId)) active.get(event.turnId)!.waiting = true;
          else if (event.kind !== "waiting") active.delete(event.turnId);
        }
      } catch {
        // Recovery is best-effort; normal append watching remains available.
      } finally {
        if (descriptor !== null) closeSync(descriptor);
      }
    }

    for (const { started, waiting } of active.values()) {
      this.onEvent({ ...started, recovered: true });
      if (waiting) this.onEvent({ kind: "waiting", turnId: started.turnId, at: Date.now(), recovered: true });
    }
  }

  private handleFile(filePath: string, isNew: boolean): void {
    if (!filePath.endsWith(".jsonl")) return;
    let size = 0;
    try {
      size = statSync(filePath).size;
    } catch {
      return;
    }

    const previousOffset = isNew ? 0 : (this.offsets.get(filePath) ?? size);
    if (size < previousOffset) {
      this.offsets.set(filePath, 0);
      this.remainders.delete(filePath);
    }
    const start = Math.max(0, Math.min(this.offsets.get(filePath) ?? previousOffset, size));
    if (start === size) return;

    const bytesToRead = Math.min(size - start, MAX_READ_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    let descriptor: number | null = null;
    try {
      descriptor = openSync(filePath, "r");
      const bytesRead = readSync(descriptor, buffer, 0, bytesToRead, start);
      const combined = `${this.remainders.get(filePath) ?? ""}${buffer.subarray(0, bytesRead).toString("utf8")}`;
      const lines = combined.split("\n");
      this.remainders.set(filePath, lines.pop() ?? "");
      this.offsets.set(filePath, start + bytesRead);
      for (const line of lines) this.parseLine(line);
    } catch {
      this.onAvailability(false);
    } finally {
      if (descriptor !== null) closeSync(descriptor);
    }
  }

  private parseLine(line: string): void {
    if (!line.trim()) return;
    let record: JsonlRecord;
    try {
      record = JSON.parse(line) as JsonlRecord;
    } catch {
      return;
    }

    const event = classifyCodexRecord(record);
    if (event) this.onEvent(event);
  }
}
