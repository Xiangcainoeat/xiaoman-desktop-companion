import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const bridgeSource = readFileSync(
  new URL("../public/article-games/xiangqi-h5/xiaoman-xiangqi-bridge.js", import.meta.url),
  "utf8",
);

type Harness = {
  context: vm.Context;
  play: {
    map: unknown[][] | null;
    depth: number;
    isPlay: boolean;
    initCalls: number;
    aiCalls: number;
    init: (depth: number, map: unknown[][]) => void;
    AIPlay: () => boolean;
    clickCanvas: () => boolean;
    __xiaomanOnLocalMove?: (move: unknown) => void;
    __xiaomanOnline?: boolean;
    __xiaomanSeat?: string | null;
    __xiaomanTurn?: string;
    __xiaomanSeq?: number;
  };
  parentMessages: Array<Record<string, unknown>>;
  dispatch: (data: unknown) => void;
  markResourcesReady: () => void;
  tick: () => void;
};

function makeHarness(options: { resourcesReady?: boolean } = {}): Harness {
  let resourcesReady = options.resourcesReady !== false;
  let intervalCallback: (() => void) | null = null;
  const initialMap: unknown[][] = Array.from({ length: 10 }, () => Array(9).fill(null));
  initialMap[0][0] = "r0";
  initialMap[9][8] = "b0";
  const parentMessages: Array<Record<string, unknown>> = [];
  const messageListeners: Array<(event: { source: object; data: unknown }) => void> = [];
  const parent = { postMessage: (message: Record<string, unknown>) => parentMessages.push(message) };
  const play: Harness["play"] = {
    map: null,
    depth: 3,
    isPlay: false,
    initCalls: 0,
    aiCalls: 0,
    init(depth, map) {
      this.depth = depth;
      this.map = map.map((row) => row.slice());
      this.initCalls += 1;
    },
    AIPlay() {
      this.aiCalls += 1;
      return true;
    },
    clickCanvas() { return true; },
  };
  const document = {
    getElementById(id: string) {
      if (id === "chessBox") return { style: { display: "none" } };
      if (id === "menuBox") return { style: { display: "block" } };
      return { muted: false };
    },
  };
  const windowObject = {
    play,
    com: {
      initMap: initialMap,
      args: { r: {}, b: {} },
      bg: {},
      dot: {},
      pane: {},
      bgImg: { get complete() { return resourcesReady; }, naturalWidth: 1 },
      dotImg: { get complete() { return resourcesReady; }, naturalWidth: 1 },
      paneImg: { get complete() { return resourcesReady; }, naturalWidth: 1 },
    },
    parent,
    addEventListener(type: string, listener: (event: { source: object; data: unknown }) => void) {
      if (type === "message") messageListeners.push(listener);
    },
    setInterval(callback: () => void) {
      intervalCallback = callback;
      return 1;
    },
  };
  const context = vm.createContext({ window: windowObject, document, Number, Date, JSON });
  vm.runInContext(bridgeSource, context);
  return {
    context,
    play,
    parentMessages,
    dispatch(data) {
      for (const listener of messageListeners) listener({ source: parent, data });
    },
    markResourcesReady() { resourcesReady = true; },
    tick() { intervalCallback?.(); },
  };
}

function onlineMode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channel: "xiaoman-xiangqi-mode",
    mode: "online",
    roomId: "room-1",
    seat: "red",
    status: "playing",
    turn: "red",
    position: "initial",
    seq: 0,
    ...overrides,
  };
}

describe("bundled Xiangqi online bridge", () => {
  it("initializes a room and forwards a local legal move with the next sequence", () => {
    const harness = makeHarness();
    harness.dispatch(onlineMode());

    expect(harness.play.__xiaomanOnline).toBe(true);
    expect(harness.play.__xiaomanSeat).toBe("red");
    expect(harness.play.isPlay).toBe(true);
    expect(harness.play.initCalls).toBe(1);
    expect(harness.play.__xiaomanOnLocalMove).toBeTypeOf("function");

    harness.play.__xiaomanOnLocalMove?.({
      from: { x: 0, y: 0 },
      to: { x: 0, y: 1 },
      captured: null,
    });

    const moveMessage = harness.parentMessages.find((message) => message.channel === "xiaoman-xiangqi-move");
    expect(moveMessage).toBeDefined();
    expect(moveMessage?.move).toMatchObject({ roomId: "room-1", seat: "red", seq: 1 });
    expect(JSON.parse(String((moveMessage?.move as { position: string }).position)).map[0][0]).toBe("r0");
    expect(harness.play.__xiaomanTurn).toBe("black");
    expect(harness.play.__xiaomanSeq).toBe(1);
  });

  it("applies only the expected remote seat and ignores stale or foreign messages", () => {
    const harness = makeHarness();
    harness.dispatch(onlineMode({ seat: "black", turn: "red" }));
    const remoteMap = Array.from({ length: 10 }, () => Array(9).fill(null));
    remoteMap[1][0] = "r0";
    remoteMap[9][8] = "b0";
    const position = JSON.stringify({ version: 1, map: remoteMap });

    harness.dispatch({
      channel: "xiaoman-xiangqi-remote-move",
      move: {
        roomId: "room-1",
        gameId: "xiangqi",
        seat: "red",
        from: { x: 0, y: 0 },
        to: { x: 0, y: 1 },
        captured: null,
        position,
        seq: 1,
      },
    });

    expect(harness.play.initCalls).toBe(2);
    expect(harness.play.map?.[1]?.[0]).toBe("r0");
    expect(harness.play.__xiaomanTurn).toBe("black");
    expect(harness.play.__xiaomanSeq).toBe(1);

    harness.dispatch({
      channel: "xiaoman-xiangqi-remote-move",
      move: {
        roomId: "room-1",
        gameId: "xiangqi",
        seat: "red",
        from: { x: 0, y: 1 },
        to: { x: 0, y: 2 },
        captured: null,
        position,
        seq: 1,
      },
    });
    expect(harness.play.initCalls).toBe(2);
    expect(harness.play.AIPlay()).toBe(false);
    expect(harness.play.aiCalls).toBe(0);
  });

  it("freezes the board while the room is waiting and accepts newer room state", () => {
    const harness = makeHarness();
    harness.dispatch(onlineMode({ status: "waiting" }));
    expect(harness.play.isPlay).toBe(false);

    harness.dispatch({
      channel: "xiaoman-xiangqi-room-state",
      roomId: "room-1",
      status: "playing",
      turn: "red",
      seq: 0,
    });
    expect(harness.play.isPlay).toBe(true);
    expect(harness.play.__xiaomanTurn).toBe("red");

    harness.dispatch({
      channel: "xiaoman-xiangqi-room-state",
      roomId: "room-1",
      status: "waiting",
      turn: "black",
      seq: -1,
    });
    expect(harness.play.isPlay).toBe(true);
    expect(harness.play.__xiaomanTurn).toBe("red");
  });

  it("waits for the bundled board resources before initializing online mode", () => {
    const harness = makeHarness({ resourcesReady: false });

    expect(() => harness.dispatch(onlineMode())).not.toThrow();
    expect(harness.play.initCalls).toBe(0);

    harness.markResourcesReady();
    harness.tick();
    expect(harness.play.initCalls).toBe(1);
    expect(harness.parentMessages.some((message) => message.channel === "xiaoman-xiangqi-ready")).toBe(true);
  });
});
