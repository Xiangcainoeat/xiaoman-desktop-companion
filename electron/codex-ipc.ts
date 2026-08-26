import { randomUUID } from "node:crypto";
import { connect as connectSocket, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";

type JsonObject = Record<string, unknown>;

const IPC_FRAME_HEADER_BYTES = 4;
const MAX_IPC_FRAME_BYTES = 64 * 1024 * 1024;
const DEFAULT_IPC_TIMEOUT_MS = 8_000;
const IPC_VERSION = {
  initialize: 0,
  "thread-owner-discovery": 1,
  "thread-follower-start-turn": 2,
  "thread-follower-steer-turn": 1,
} as const;

export interface NativeCodexIpcConnection {
  write(frame: Buffer): void;
  onData(listener: (chunk: Buffer) => void): void;
  onError(listener: (error: Error) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}

export type NativeCodexIpcConnector = (
  socketPath: string,
) => NativeCodexIpcConnection | Promise<NativeCodexIpcConnection>;

export function encodeIpcFrame(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.length > 0xffffffff) {
    throw new Error("IPC message is too large");
  }
  const frame = Buffer.allocUnsafe(IPC_FRAME_HEADER_BYTES + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, IPC_FRAME_HEADER_BYTES);
  return frame;
}

export function decodeIpcFrames(chunk: Buffer): unknown[] {
  const messages: unknown[] = [];
  let offset = 0;

  while (chunk.length - offset >= IPC_FRAME_HEADER_BYTES) {
    const payloadLength = chunk.readUInt32LE(offset);
    if (payloadLength > MAX_IPC_FRAME_BYTES) {
      throw new Error(`IPC frame exceeds ${MAX_IPC_FRAME_BYTES} bytes`);
    }
    const frameLength = IPC_FRAME_HEADER_BYTES + payloadLength;
    if (chunk.length - offset < frameLength) break;

    const payload = chunk.subarray(offset + IPC_FRAME_HEADER_BYTES, offset + frameLength).toString("utf8");
    try {
      messages.push(JSON.parse(payload));
    } catch (error) {
      throw new Error(`Invalid IPC JSON frame: ${error instanceof Error ? error.message : String(error)}`);
    }
    offset += frameLength;
  }

  return messages;
}

class NodeSocketConnection implements NativeCodexIpcConnection {
  constructor(private readonly socket: Socket) {}

  write(frame: Buffer): void {
    this.socket.write(frame);
  }

  onData(listener: (chunk: Buffer) => void): void {
    this.socket.on("data", listener);
  }

  onError(listener: (error: Error) => void): void {
    this.socket.on("error", listener);
  }

  onClose(listener: () => void): void {
    this.socket.on("close", listener);
  }

  close(): void {
    this.socket.destroy();
  }
}

function defaultConnector(socketPath: string): Promise<NativeCodexIpcConnection> {
  return new Promise((resolve, reject) => {
    const socket = connectSocket(socketPath);
    const onError = (error: Error) => {
      socket.removeListener("connect", onConnect);
      reject(error);
    };
    const onConnect = () => {
      socket.removeListener("error", onError);
      resolve(new NodeSocketConnection(socket));
    };
    socket.once("error", onError);
    socket.once("connect", onConnect);
  });
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface NativeIpcRequest extends JsonObject {
  type: "request";
  requestId: string;
  version: number;
  method: string;
  params?: JsonObject;
  sourceClientId?: string;
  targetClientId?: string;
  timeoutMs?: number;
}

export interface NativeCodexIpcClientOptions {
  codexHome?: string;
  connector?: NativeCodexIpcConnector;
  timeoutMs?: number;
  idFactory?: () => string;
}

export interface NativeCodexReplyInput {
  threadId: string;
  message: string;
  mode: "start" | "steer";
}

export interface NativeCodexReplyResult {
  transport: "native-start" | "native-steer";
  clientUserMessageId: string;
  result: unknown;
}

export class NativeCodexIpcClient {
  private readonly socketPath: string;
  private readonly connector: NativeCodexIpcConnector;
  private readonly timeoutMs: number;
  private readonly idFactory: () => string;
  private connectionPromise: Promise<NativeCodexIpcConnection> | null = null;
  private initializationPromise: Promise<void> | null = null;
  private connection: NativeCodexIpcConnection | null = null;
  private clientId: string | null = null;
  private pending = new Map<string, PendingRequest>();
  private receiveBuffer = Buffer.alloc(0);

  constructor(options: NativeCodexIpcClientOptions = {}) {
    const codexHome = options.codexHome ?? path.join(os.homedir(), ".codex");
    this.socketPath = path.join(codexHome, "ipc", "ipc.sock");
    this.connector = options.connector ?? defaultConnector;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_IPC_TIMEOUT_MS;
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async sendReply(input: NativeCodexReplyInput): Promise<NativeCodexReplyResult> {
    await this.ensureInitialized();
    const owner = await this.discoverOwner(input.threadId);
    const clientUserMessageId = this.idFactory();
    const textInput = [{ type: "text", text: input.message }];

    if (input.mode === "start") {
      const result = await this.request(
        "thread-follower-start-turn",
        {
          conversationId: input.threadId,
          turnStart: {
            request: {
              threadId: input.threadId,
              clientUserMessageId,
              input: textInput,
            },
            context: {
              attachments: [],
              commentAttachments: [],
            },
          },
        },
        owner,
      );
      return { transport: "native-start", clientUserMessageId, result };
    }

    const result = await this.request(
      "thread-follower-steer-turn",
      {
        conversationId: input.threadId,
        clientUserMessageId,
        input: textInput,
        attachments: [],
      },
      owner,
    );
    return { transport: "native-steer", clientUserMessageId, result };
  }

  close(): void {
    this.rejectPending(new Error("Codex IPC connection closed"));
    this.connection?.close();
    this.connection = null;
    this.connectionPromise = null;
    this.initializationPromise = null;
    this.clientId = null;
    this.receiveBuffer = Buffer.alloc(0);
  }

  private async discoverOwner(threadId: string): Promise<string> {
    const result = await this.request("thread-owner-discovery", {
      hostId: "local",
      conversationId: threadId,
    });
    const owner = asObject(result)?.handledByClientId;
    if (typeof owner !== "string" || owner.length === 0) {
      throw new Error(`No native Codex window owns thread ${threadId}`);
    }
    return owner;
  }

  private async getConnection(): Promise<NativeCodexIpcConnection> {
    if (this.connection) return this.connection;
    if (!this.connectionPromise) {
      this.connectionPromise = Promise.resolve(this.connector(this.socketPath))
        .then((connection) => {
          this.connection = connection;
          this.receiveBuffer = Buffer.alloc(0);
          connection.onData((chunk) => this.handleData(chunk));
          connection.onError((error) => this.handleConnectionFailure(error));
          connection.onClose(() => this.handleConnectionFailure(new Error("Codex IPC connection closed")));
          return connection;
        })
        .catch((error) => {
          this.connectionPromise = null;
          throw asError(error, "Unable to connect to Codex IPC");
        });
    }
    return this.connectionPromise;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.clientId) return;
    if (!this.initializationPromise) {
      this.initializationPromise = this.request("initialize", { clientType: "xiaoman_desktop_companion" })
        .then((result) => {
          const clientId = asObject(result)?.clientId;
          if (typeof clientId !== "string" || clientId.length === 0) {
            throw new Error("Codex IPC initialize response did not include clientId");
          }
          this.clientId = clientId;
        })
        .catch((error) => {
          this.initializationPromise = null;
          throw error;
        });
    }
    await this.initializationPromise;
  }

  private async request(method: keyof typeof IPC_VERSION, params?: JsonObject, targetClientId?: string): Promise<unknown> {
    const connection = await this.getConnection();
    const requestId = this.idFactory();
    const request: NativeIpcRequest = {
      type: "request",
      requestId,
      version: IPC_VERSION[method],
      method,
      ...(this.clientId ? { sourceClientId: this.clientId } : {}),
      ...(targetClientId ? { targetClientId } : {}),
      ...(params ? { params } : {}),
    };

    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Codex IPC request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });

    try {
      connection.write(encodeIpcFrame(request));
    } catch (error) {
      this.pending.delete(requestId);
      throw asError(error, `Unable to write Codex IPC request: ${method}`);
    }

    const result = await response;
    if (method === "initialize") {
      const clientId = asObject(result)?.clientId;
      if (typeof clientId === "string" && clientId.length > 0) this.clientId = clientId;
    }
    return result;
  }

  private handleData(chunk: Buffer): void {
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);
    let offset = 0;
    while (this.receiveBuffer.length - offset >= IPC_FRAME_HEADER_BYTES) {
      const payloadLength = this.receiveBuffer.readUInt32LE(offset);
      if (payloadLength > MAX_IPC_FRAME_BYTES) {
        this.handleConnectionFailure(new Error(`IPC frame exceeds ${MAX_IPC_FRAME_BYTES} bytes`));
        return;
      }
      const frameLength = IPC_FRAME_HEADER_BYTES + payloadLength;
      if (this.receiveBuffer.length - offset < frameLength) break;
      const payload = this.receiveBuffer.subarray(offset + IPC_FRAME_HEADER_BYTES, offset + frameLength).toString("utf8");
      offset += frameLength;
      let message: unknown;
      try {
        message = JSON.parse(payload);
      } catch (error) {
        this.handleConnectionFailure(asError(error, "Invalid IPC JSON frame"));
        return;
      }
      this.handleMessage(message);
    }
    this.receiveBuffer = this.receiveBuffer.subarray(offset);
  }

  private handleMessage(message: unknown): void {
    const object = asObject(message);
    if (!object || object.type !== "response" || typeof object.requestId !== "string") return;
    const pending = this.pending.get(object.requestId);
    if (!pending) return;
    this.pending.delete(object.requestId);
    clearTimeout(pending.timer);
    const error = asObject(object.error);
    if (error) {
      pending.reject(new Error(stringValue(error.message) ?? "Codex IPC request failed"));
      return;
    }
    pending.resolve(object.result);
  }

  private handleConnectionFailure(error: Error): void {
    this.rejectPending(error);
    this.connection = null;
    this.connectionPromise = null;
    this.initializationPromise = null;
    this.clientId = null;
    this.receiveBuffer = Buffer.alloc(0);
  }

  private rejectPending(error: Error): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(requestId);
    }
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

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(`${fallback}: ${String(value)}`);
}
