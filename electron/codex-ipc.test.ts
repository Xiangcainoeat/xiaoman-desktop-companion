import { describe, expect, it } from "vitest";
import {
  NativeCodexIpcClient,
  decodeIpcFrames,
  encodeIpcFrame,
  type NativeCodexIpcConnection,
  type NativeCodexIpcConnector,
} from "./codex-ipc";

const THREAD_ID = "01a03ab3-3112-7cf3-949f-07e0ae5a9404";

class FakeConnection implements NativeCodexIpcConnection {
  readonly writes: Buffer[] = [];
  private dataListener: ((chunk: Buffer) => void) | null = null;
  private errorListener: ((error: Error) => void) | null = null;

  constructor(
    private readonly onRequest: (request: Record<string, unknown>) => Record<string, unknown>,
    private readonly chunkSize = 0,
    private readonly respond = true,
  ) {}

  write(frame: Buffer): void {
    this.writes.push(frame);
    const request = decodeIpcFrames(frame)[0] as Record<string, unknown>;
    const response = this.onRequest(request);
    if (!this.respond) return;
    queueMicrotask(() => {
      const frame = encodeIpcFrame(response);
      if (this.chunkSize <= 0) {
        this.dataListener?.(frame);
        return;
      }
      for (let offset = 0; offset < frame.length; offset += this.chunkSize) {
        this.dataListener?.(frame.subarray(offset, offset + this.chunkSize));
      }
    });
  }

  onData(listener: (chunk: Buffer) => void): void {
    this.dataListener = listener;
  }

  onError(listener: (error: Error) => void): void {
    this.errorListener = listener;
  }

  onClose(_listener: () => void): void {}

  close(): void {
    this.errorListener = null;
  }
}

function connectorFor(
  requests: Array<Record<string, unknown>>,
  chunkSize = 0,
): NativeCodexIpcConnector {
  return async () => new FakeConnection((request) => {
    requests.push(request);
    const method = request.method;
    if (method === "initialize") {
      return { type: "response", requestId: request.requestId, result: { clientId: "xiaoman-client" } };
    }
    if (method === "thread-owner-discovery") {
      return {
        type: "response",
        requestId: request.requestId,
        result: { handledByClientId: "native-owner" },
      };
    }
    return { type: "response", requestId: request.requestId, result: { accepted: true } };
  }, chunkSize);
}

describe("native Codex IPC framing", () => {
  it("encodes and decodes a little-endian length-prefixed JSON frame", () => {
    const message = { type: "request", method: "ping", text: "小满" };
    const frame = encodeIpcFrame(message);
    expect(frame.readUInt32LE(0)).toBe(Buffer.byteLength(JSON.stringify(message), "utf8"));
    expect(decodeIpcFrames(Buffer.concat([frame.subarray(0, 3), frame.subarray(3)]))).toEqual([message]);
    expect(decodeIpcFrames(Buffer.concat([frame, encodeIpcFrame({ type: "event" })]))).toEqual([
      message,
      { type: "event" },
    ]);
  });
});

describe("native Codex follower requests", () => {
  it("routes an idle reply through follower start with the native owner", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = new NativeCodexIpcClient({
      codexHome: "/tmp/xiaoman-codex",
      connector: connectorFor(requests),
      idFactory: () => "message-id-start",
    });

    await expect(client.sendReply({ threadId: THREAD_ID, message: "继续执行", mode: "start" }))
      .resolves.toMatchObject({ transport: "native-start", clientUserMessageId: "message-id-start" });

    expect(requests.map((request) => request.method)).toEqual([
      "initialize",
      "thread-owner-discovery",
      "thread-follower-start-turn",
    ]);
    expect(requests[1]).toMatchObject({
      version: 1,
      params: { hostId: "local", conversationId: THREAD_ID },
    });
    expect(requests[2]).toMatchObject({
      version: 2,
      targetClientId: "native-owner",
      params: {
        conversationId: THREAD_ID,
        turnStart: {
          request: {
            threadId: THREAD_ID,
            clientUserMessageId: "message-id-start",
            input: [{ type: "text", text: "继续执行" }],
          },
          context: { attachments: [], commentAttachments: [] },
        },
      },
    });
  });

  it("routes an active reply through follower steer and creates a fresh message id", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = new NativeCodexIpcClient({
      codexHome: "/tmp/xiaoman-codex",
      connector: connectorFor(requests),
      idFactory: () => "message-id-steer",
    });

    await expect(client.sendReply({ threadId: THREAD_ID, message: "补充说明", mode: "steer" }))
      .resolves.toMatchObject({ transport: "native-steer", clientUserMessageId: "message-id-steer" });

    const request = requests[2];
    expect(request).toMatchObject({
      method: "thread-follower-steer-turn",
      version: 1,
      targetClientId: "native-owner",
      params: {
        conversationId: THREAD_ID,
        clientUserMessageId: "message-id-steer",
        input: [{ type: "text", text: "补充说明" }],
        attachments: [],
      },
    });
  });

  it("keeps partial response chunks until a complete frame is available", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = new NativeCodexIpcClient({
      codexHome: "/tmp/xiaoman-codex",
      connector: connectorFor(requests, 2),
      idFactory: () => "message-id-partial",
    });

    await expect(client.sendReply({ threadId: THREAD_ID, message: "分片回复", mode: "start" }))
      .resolves.toMatchObject({ transport: "native-start" });
  });

  it("rejects a request when the native IPC peer returns an error", async () => {
    const connector: NativeCodexIpcConnector = async () => new FakeConnection((request) => ({
      type: "response",
      requestId: request.requestId,
      error: { message: "native peer rejected request" },
    }));
    const client = new NativeCodexIpcClient({
      codexHome: "/tmp/xiaoman-codex",
      connector,
      timeoutMs: 50,
      idFactory: () => "message-id-error",
    });

    await expect(client.sendReply({ threadId: THREAD_ID, message: "失败", mode: "start" }))
      .rejects.toThrow("native peer rejected request");
  });

  it("rejects a request when the native IPC peer does not respond before the timeout", async () => {
    const connector: NativeCodexIpcConnector = async () => new FakeConnection(
      () => ({ type: "response" }),
      0,
      false,
    );
    const client = new NativeCodexIpcClient({
      codexHome: "/tmp/xiaoman-codex",
      connector,
      timeoutMs: 10,
      idFactory: () => "message-id-timeout",
    });

    await expect(client.sendReply({ threadId: THREAD_ID, message: "超时", mode: "start" }))
      .rejects.toThrow("Codex IPC request timed out: initialize");
  });
});
