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
  protected dataListener: ((chunk: Buffer) => void) | null = null;
  private errorListener: ((error: Error) => void) | null = null;

  constructor(
    private readonly onRequest: (request: Record<string, unknown>) => Record<string, unknown>,
    private readonly chunkSize = 0,
    private readonly respond = true,
    private readonly emitDiscoveryRequest = false,
    private readonly discoveryResponses: Array<Record<string, unknown>> = [],
  ) {}

  write(frame: Buffer): void {
    this.writes.push(frame);
    const request = decodeIpcFrames(frame)[0] as Record<string, unknown>;
    if (request.type === "client-discovery-response") {
      this.discoveryResponses.push(request);
      return;
    }
    if (this.emitDiscoveryRequest && request.method === "initialize") {
      queueMicrotask(() => {
        this.dataListener?.(encodeIpcFrame({
          type: "client-discovery-request",
          requestId: "router-discovery-1",
          request: { clientType: "ide-context" },
        }));
      });
    }
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
  emitDiscoveryRequest = false,
  discoveryResponses: Array<Record<string, unknown>> = [],
  ownerAtEnvelope = false,
): NativeCodexIpcConnector {
  return async () => new FakeConnection((request) => {
    requests.push(request);
    const method = request.method;
    if (method === "initialize") {
      return { type: "response", requestId: request.requestId, result: { clientId: "xiaoman-client" } };
    }
    if (method === "thread-owner-discovery") {
      const response = {
        type: "response",
        requestId: request.requestId,
        result: { handledByClientId: "native-owner" },
      };
      return ownerAtEnvelope
        ? { ...response, handledByClientId: "native-owner", result: {} }
        : response;
    }
    return { type: "response", requestId: request.requestId, result: { accepted: true } };
  }, chunkSize, true, emitDiscoveryRequest, discoveryResponses);
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

  it("declines router client-discovery requests without stealing IDE context", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const discoveryResponses: Array<Record<string, unknown>> = [];
    const client = new NativeCodexIpcClient({
      codexHome: "/tmp/xiaoman-codex",
      connector: connectorFor(requests, 0, true, discoveryResponses),
      idFactory: () => "message-id-discovery",
    });

    await expect(client.sendReply({ threadId: THREAD_ID, message: "发现握手", mode: "start" }))
      .resolves.toMatchObject({ transport: "native-start" });

    expect(discoveryResponses).toEqual([
      expect.objectContaining({
        type: "client-discovery-response",
        requestId: "router-discovery-1",
        response: { canHandle: false },
      }),
    ]);
  });

  it("reads the native owner's client id from the response envelope", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = new NativeCodexIpcClient({
      codexHome: "/tmp/xiaoman-codex",
      connector: async () => connectorFor(requests, 0, false, [], true)("/tmp/socket"),
      idFactory: () => "message-id-envelope-owner",
    });

    await expect(client.sendReply({ threadId: THREAD_ID, message: "外层 owner", mode: "start" }))
      .resolves.toMatchObject({ transport: "native-start" });
    expect(requests[2]).toMatchObject({ targetClientId: "native-owner" });
  });

  it("opens a fresh native route for each sequential reply", async () => {
    const requests: Array<Record<string, unknown>> = [];
    let messageIndex = 0;
    const client = new NativeCodexIpcClient({
      codexHome: "/tmp/xiaoman-codex",
      connector: connectorFor(requests, 0, true),
      idFactory: () => `message-id-${++messageIndex}`,
    });

    await client.sendReply({ threadId: THREAD_ID, message: "第一条", mode: "start" });
    await client.sendReply({ threadId: THREAD_ID, message: "第二条", mode: "start" });

    const sentMessages = requests
      .filter((request) => request.method === "thread-follower-start-turn")
      .map((request) => {
        const params = request.params as Record<string, unknown>;
        const turnStart = params.turnStart as Record<string, unknown>;
        return (turnStart.request as Record<string, unknown>).clientUserMessageId;
      });
    expect(sentMessages).toEqual(["message-id-1", "message-id-2"]);
    expect(requests.filter((request) => request.method === "initialize")).toHaveLength(2);
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
