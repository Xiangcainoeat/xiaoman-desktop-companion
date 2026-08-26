import { randomUUID } from "node:crypto";
import * as net from "node:net";
import os from "node:os";
import path from "node:path";

export const NATIVE_CODEX_IPC_MAX_FRAME_BYTES = 8 * 1024 * 1024;
export const NATIVE_CODEX_IPC_DEFAULT_TIMEOUT_MS = 8_000;

export const NATIVE_CODEX_IPC_METHOD_VERSIONS = {
  "thread-owner-discovery": 1,
  "thread-follower-start-turn": 2,
  "thread-follower-steer-turn": 1,
} as const;

export type NativeCodexIpcMethod = keyof typeof NATIVE_CODEX_IPC_METHOD_VERSIONS;

export interface NativeCodexIpcConnection {
  write(frame: Buffer): void;
  onData(listener: (chunk: Buffer) => void): void;
  onError(listener: (error: Error) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}

export type NativeCodexIpcConnector = (socketPath: string) => Promise<NativeCodexIpcConnection>;

export interface NativeCodexIpcReplyInput {
  threadId: string;
  message: string;
  mode: "start" | "steer";
  cwd?: string | null;
}

export interface NativeCodexIpcReplyResult {
  transport: "native-start" | "native-steer";
  clientUserMessageId: string;
}

export interface NativeCodexIpcClientOptions {
  codexHome?: string;
  socketPath?: string;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  connector?: NativeCodexIpcConnector;
  idFactory?: () => string;
  requestIdFactory?: () => string;
  clientType?: string;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorText(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  const object = asObject(value);
  return textValue(object?.message) ?? textValue(object?.error) ?? "Codex IPC request failed";
}

export class NativeCodexIpcError extends Error {
  constructor(
    message: string,
    readonly code:
      | "unsupported-platform"
      | "connect-failed"
      | "timeout"
      | "protocol"
      | "owner-not-found"
      | "request-failed" = "request-failed",
  ) {
    super(message);
    this.name = "NativeCodexIpcError";
  }
}

export function encodeIpcFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length > NATIVE_CODEX_IPC_MAX_FRAME_BYTES) {
    throw new NativeCodexIpcError("Codex IPC request exceeds the frame limit", "protocol");
  }
  const frame = Buffer.allocUnsafe(4 + body.length);
  frame.writeUInt32LE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

export class IpcFrameDecoder {
  private remainder = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    if (!Buffer.isBuffer(chunk) || chunk.length === 0) return [];
    this.remainder = this.remainder.length === 0
      ? Buffer.from(chunk)
      : Buffer.concat([this.remainder, chunk]);
    const messages: unknown[] = [];

    while (this.remainder.length >= 4) {
      const length = this.remainder.readUInt32LE(0);
      if (length > NATIVE_CODEX_IPC_MAX_FRAME_BYTES) {
        throw new NativeCodexIpcError("Codex IPC response exceeds the frame limit", "protocol");
      }
      if (this.remainder.length < length + 4) break;
      const body = this.remainder.subarray(4, length + 4).toString("utf8");
      this.remainder = this.remainder.subarray(length + 4);
      try {
        messages.push(JSON.parse(body) as unknown);
      } catch {
        throw new NativeCodexIpcError("Codex IPC returned invalid JSON", "protocol");
      }
    }
    return messages;
  }
}

export function decodeIpcFrames(chunk: Buffer): unknown[] {
  return new IpcFrameDecoder().push(chunk);
}

function connectNativeSocket(socketPath: string): Promise<NativeCodexIpcConnection> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let connected = false;
    const handleSocketError = (error: Error): void => {
      if (!connected) reject(error);
    };
    // Keep an error listener installed for the whole socket lifetime. The
    // wrapper attaches its request-level listener after the connect event.
    socket.on("error", handleSocketError);
    socket.once("connect", () => {
      connected = true;
      resolve({
        write: (frame) => {
          socket.write(frame);
        },
        onData: (listener) => {
          socket.on("data", listener);
        },
        onError: (listener) => {
          socket.on("error", listener);
        },
        onClose: (listener) => {
          socket.on("close", listener);
        },
        close: () => socket.destroy(),
      });
    });
  });
}

function unwrapResult(value: unknown): unknown {
  const object = asObject(value);
  if (!object) return value;
  if (object.result !== undefined && (object.method !== undefined || object.type === "result")) {
    return unwrapResult(object.result);
  }
  return value;
}

function extractClientId(value: unknown): string | null {
  const unwrapped = unwrapResult(value);
  const object = asObject(unwrapped);
  if (typeof unwrapped === "string") return textValue(unwrapped);
  if (!object) return null;
  return textValue(object.clientId)
    ?? textValue(object.sourceClientId)
    ?? textValue(object.id)
    ?? (object.result !== undefined ? extractClientId(object.result) : null);
}

function extractOwnerId(value: unknown): string | null {
  const unwrapped = unwrapResult(value);
  const object = asObject(unwrapped);
  if (!object) return null;
  return textValue(object.handledByClientId)
    ?? textValue(object.ownerClientId)
    ?? textValue(object.clientId)
    ?? (object.result !== undefined ? extractOwnerId(object.result) : null);
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

class NativeIpcSession {
  private readonly decoder = new IpcFrameDecoder();
  private readonly pending = new Map<string, PendingRequest>();
  private sourceClientId: string | null = null;
  private closed = false;

  constructor(
    private readonly connection: NativeCodexIpcConnection,
    private readonly timeoutMs: number,
    private readonly requestIdFactory: () => string,
  ) {
    connection.onData((chunk) => {
      try {
        for (const message of this.decoder.push(chunk)) this.handleMessage(message);
      } catch (error) {
        this.failAll(error instanceof Error ? error : new Error(String(error)));
        this.close();
      }
    });
    connection.onError((error) => this.failAll(error));
    connection.onClose(() => this.failAll(new NativeCodexIpcError("Codex IPC connection closed", "connect-failed")));
  }

  setSourceClientId(clientId: string | null): void {
    this.sourceClientId = clientId;
  }

  request(
    method: "initialize" | NativeCodexIpcMethod,
    params: JsonObject,
    targetClientId?: string,
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(new NativeCodexIpcError("Codex IPC connection is closed", "connect-failed"));
    const requestId = this.requestIdFactory();
    const message: JsonObject = {
      type: "request",
      requestId,
      version: method === "initialize" ? 0 : NATIVE_CODEX_IPC_METHOD_VERSIONS[method],
      method,
      params,
    };
    if (this.sourceClientId) message.sourceClientId = this.sourceClientId;
    if (targetClientId) message.targetClientId = targetClientId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new NativeCodexIpcError(`Codex IPC request timed out: ${method}`, "timeout"));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.connection.write(encodeIpcFrame(message));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
    this.connection.close();
  }

  private handleMessage(value: unknown): void {
    const message = asObject(value);
    if (!message) return;
    if (message.type === "client-discovery-request") {
      const requestId = textValue(message.requestId);
      if (!requestId) return;
      // The companion follows threads but does not own IDE context. Explicitly
      // decline this router handshake so the native Codex client stays owner.
      this.connection.write(encodeIpcFrame({
        type: "client-discovery-response",
        requestId,
        response: { canHandle: false },
      }));
      return;
    }
    const requestId = textValue(message.requestId) ?? textValue(message.id);
    if (!requestId) return;
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    if (message.error !== undefined) {
      pending.reject(new NativeCodexIpcError(errorText(message.error), "request-failed"));
      return;
    }
    const result = unwrapResult(message.result);
    const envelopeOwner = textValue(message.handledByClientId);
    if (!envelopeOwner) {
      pending.resolve(result);
      return;
    }
    const resultObject = asObject(result);
    pending.resolve(resultObject
      ? { ...resultObject, handledByClientId: envelopeOwner }
      : { result, handledByClientId: envelopeOwner });
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export class NativeCodexIpcClient {
  readonly socketPath: string;
  private readonly platform: NodeJS.Platform;
  private readonly timeoutMs: number;
  private readonly connector: NativeCodexIpcConnector;
  private readonly idFactory: () => string;
  private readonly requestIdFactory: () => string;
  private readonly clientType: string;

  constructor(options: NativeCodexIpcClientOptions = {}) {
    const codexHome = path.resolve(options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"));
    this.socketPath = options.socketPath ?? path.join(codexHome, "ipc", "ipc.sock");
    this.platform = options.platform ?? process.platform;
    this.timeoutMs = Math.max(100, options.timeoutMs ?? NATIVE_CODEX_IPC_DEFAULT_TIMEOUT_MS);
    this.connector = options.connector ?? connectNativeSocket;
    this.idFactory = options.idFactory ?? randomUUID;
    this.requestIdFactory = options.requestIdFactory ?? randomUUID;
    this.clientType = options.clientType ?? "xiaoman_desktop_companion";
  }

  async sendReply(input: NativeCodexIpcReplyInput): Promise<NativeCodexIpcReplyResult> {
    if (this.platform !== "darwin") {
      throw new NativeCodexIpcError("原生 Codex 窗口路由仅支持 macOS", "unsupported-platform");
    }
    let connection: NativeCodexIpcConnection;
    try {
      connection = await this.connector(this.socketPath);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new NativeCodexIpcError(`无法连接原生 Codex IPC：${detail}`, "connect-failed");
    }

    const session = new NativeIpcSession(connection, this.timeoutMs, this.requestIdFactory);
    try {
      const initialized = await session.request("initialize", { clientType: this.clientType });
      session.setSourceClientId(extractClientId(initialized) ?? this.idFactory());
      const ownerResponse = await session.request("thread-owner-discovery", {
        hostId: "local",
        conversationId: input.threadId,
      });
      const ownerClientId = extractOwnerId(ownerResponse);
      if (!ownerClientId) {
        throw new NativeCodexIpcError("没有找到拥有该 Codex 任务的原生窗口", "owner-not-found");
      }

      const clientUserMessageId = this.idFactory();
      const textInput = [{ type: "text", text: input.message }];
      if (input.mode === "start") {
        const request: JsonObject = {
          threadId: input.threadId,
          clientUserMessageId,
          input: textInput,
        };
        await session.request("thread-follower-start-turn", {
          conversationId: input.threadId,
          turnStart: {
            request,
            context: { attachments: [], commentAttachments: [] },
          },
        }, ownerClientId);
        return { transport: "native-start", clientUserMessageId };
      }

      await session.request("thread-follower-steer-turn", {
        conversationId: input.threadId,
        clientUserMessageId,
        input: textInput,
        attachments: [],
        serviceTier: null,
        additionalContext: null,
        restoreMessage: null,
      }, ownerClientId);
      return { transport: "native-steer", clientUserMessageId };
    } finally {
      session.close();
    }
  }
}
