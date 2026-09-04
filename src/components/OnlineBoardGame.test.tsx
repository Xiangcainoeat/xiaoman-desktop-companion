import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GameRoom } from "../social/types";
import {
  ONLINE_GAME_CATALOG,
  ONLINE_GAME_IDS,
  OnlineBoardGame,
  applyOnlineMove,
  createInitialPosition,
  createOnlineMove,
  getLegalMoves,
  parseOnlinePosition,
  validateOnlineMove,
  type OnlineGameId,
  type OnlinePoint,
} from "../online-games";
import { ArmyChessBoard, ArmyChessModeContext } from "../online-games/ArmyChessBoard";

function inBoard(point: OnlinePoint, columns: number, rows: number): boolean {
  return Number.isInteger(point.x) && Number.isInteger(point.y)
    && point.x >= 0 && point.x < columns && point.y >= 0 && point.y < rows;
}

function firstMove(gameId: OnlineGameId): ReturnType<typeof createOnlineMove> {
  const position = createInitialPosition(gameId);
  const candidate = getLegalMoves(gameId, position, "red")[0];
  if (!candidate) throw new Error(`没有找到 ${gameId} 的首步合法落点`);
  return createOnlineMove({
    roomId: "room-test",
    gameId,
    seat: "red",
    seq: 1,
    position,
    from: candidate.from,
    to: candidate.to,
    createdAt: 123,
  });
}

function roomFor(gameId: OnlineGameId): GameRoom {
  const redUser = { id: "red-user", username: "red", displayName: "红方测试", avatarUrl: null };
  const blackUser = { id: "black-user", username: "black", displayName: "黑方测试", avatarUrl: null };
  return {
    id: `room-${gameId}`,
    code: "TEST01",
    gameId,
    hostUserId: redUser.id,
    players: {
      red: { user: redUser, seat: "red", ready: true, connected: true },
      black: { user: blackUser, seat: "black", ready: true, connected: true },
    },
    status: "playing",
    turn: "red",
    seq: 0,
    position: createInitialPosition(gameId),
    lastMove: null,
    winner: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("联机棋盘 catalog 与位置契约", () => {
  it("完整覆盖 16 个中文联机棋类", () => {
    expect(ONLINE_GAME_CATALOG).toHaveLength(16);
    expect(ONLINE_GAME_CATALOG.map((entry) => entry.id)).toEqual([...ONLINE_GAME_IDS]);
    for (const entry of ONLINE_GAME_CATALOG) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.engine.id).toBe(entry.id);
    }
  });

  it.each([...ONLINE_GAME_IDS])("%s 有可解析的初始局面和首步 GameMove", (gameId) => {
    const entry = ONLINE_GAME_CATALOG.find((item) => item.id === gameId)!;
    const position = createInitialPosition(gameId);
    const parsed = parseOnlinePosition(gameId, position);
    expect(parsed?.game).toBe(gameId);
    expect(parsed?.turn).toBe("red");
    expect(parsed?.board).toBeDefined();

    const candidate = getLegalMoves(gameId, position, "red")[0];
    expect(candidate).toBeDefined();
    expect(inBoard(candidate.from, entry.engine.board.columns, entry.engine.board.rows)).toBe(true);
    expect(inBoard(candidate.to, entry.engine.board.columns, entry.engine.board.rows)).toBe(true);

    const move = firstMove(gameId);
    expect(move).not.toBeNull();
    expect(move!.roomId).toBe("room-test");
    expect(move!.gameId).toBe(gameId);
    expect(move!.seq).toBe(1);
    expect(inBoard(move!.from, entry.engine.board.columns, entry.engine.board.rows)).toBe(true);
    expect(inBoard(move!.to, entry.engine.board.columns, entry.engine.board.rows)).toBe(true);
    const next = parseOnlinePosition(gameId, move!.position);
    expect(next?.game).toBe(gameId);
    expect(next?.board).toBeDefined();
  });

  it.each([...ONLINE_GAME_IDS])("%s 的初始局面可以渲染为非空中文棋盘", (gameId) => {
    const entry = ONLINE_GAME_CATALOG.find((item) => item.id === gameId)!;
    const markup = renderToStaticMarkup(
      <OnlineBoardGame room={roomFor(gameId)} seat="red" client={{ sendMove: async () => undefined }} />,
    );
    expect(markup).toContain(entry.label);
    expect(markup).toContain("联机");
    expect(markup.length).toBeGreaterThan(500);
  });

  it.each([
    ["gomoku", "reference-line-board"],
    ["connect6", "reference-line-board"],
    ["go", "reference-line-board"],
    ["chess", "reference-square-board"],
    ["reversi", "reference-square-board"],
    ["checkers", "reference-square-board"],
    ["tic-tac-toe", "reference-square-board"],
    ["xiangqi", "reference-xiangqi-board"],
    ["shogi", "reference-shogi-board"],
    ["animal-chess", "reference-animal-board"],
    ["chinese-checkers", "reference-star-board"],
    ["dots-and-boxes", "reference-dots-board"],
    ["mancala", "reference-mancala-board"],
    ["ludo", "reference-ludo-board"],
    ["backgammon", "reference-backgammon-board"],
  ] as const)("%s 使用独立的参考式棋盘，而不是旧通用网格", (gameId, boardClass) => {
    const markup = renderToStaticMarkup(
      <OnlineBoardGame room={roomFor(gameId)} seat="red" client={{ sendMove: async () => undefined }} />,
    );
    expect(markup).toContain(boardClass);
  });

  it("棋类首局的双方棋子都会生成可区分的视觉阵营样式", () => {
    const cases = [
      ["chess", "reference-chess-piece is-red", "reference-chess-piece is-black"],
      ["xiangqi", "reference-xiangqi-piece is-red", "reference-xiangqi-piece is-black"],
      ["shogi", "reference-shogi-piece is-red", "reference-shogi-piece is-black"],
      ["animal-chess", "reference-animal-piece is-red", "reference-animal-piece is-black"],
    ] as const;
    for (const [gameId, redClass, blackClass] of cases) {
      const markup = renderToStaticMarkup(
        <OnlineBoardGame room={roomFor(gameId)} seat="red" client={{ sendMove: async () => undefined }} />,
      );
      expect(markup).toContain(redClass);
      expect(markup).toContain(blackClass);
    }
  });

  it("每种棋类都保留自己的参考式棋盘语言和棋子层", () => {
    const markup = (gameId: OnlineGameId) => renderToStaticMarkup(
      <OnlineBoardGame room={roomFor(gameId)} seat="red" client={{ sendMove: async () => undefined }} />,
    );

    expect(markup("chess")).toContain("reference-chess-vector-piece");
    expect(markup("chess")).toContain("data-piece-kind=\"k\"");
    expect(markup("chess")).toContain("<svg");

    expect(markup("shogi")).toContain("data-reference-zone=\"gote\"");
    expect(markup("shogi")).toContain("data-piece-kind=\"k\"");
    expect(markup("shogi")).toContain("data-coordinate=\"9一\"");

    expect(markup("go")).toContain("reference-line-board-star");
    const goAfterOpening = applyOnlineMove("go", createInitialPosition("go"), "red", { x: 4, y: 4 });
    expect(goAfterOpening).not.toBeNull();
    expect(renderToStaticMarkup(
      <OnlineBoardGame room={{ ...roomFor("go"), position: goAfterOpening! }} seat="red" client={{ sendMove: async () => undefined }} />,
    )).toContain("reference-stone");
    expect(markup("checkers")).toContain("reference-checker-piece");
    expect(markup("reversi")).toContain("reference-disc");

    expect(markup("animal-chess")).toContain("data-piece-kind=\"e\"");
    expect(markup("animal-chess")).toContain("🐘");
    expect(markup("chinese-checkers")).toContain("reference-star-shape");
    expect(markup("chinese-checkers")).toContain("reference-marble");
  });

  it("军棋保持参考站的纵向盖棋布局，并支持翻棋牌面", () => {
    const state = parseOnlinePosition("army-chess", createInitialPosition("army-chess"));
    const props = { state, selected: null, targets: [], onPoint: () => undefined };
    const darkMarkup = renderToStaticMarkup(<ArmyChessBoard {...props} />);
    const flipMarkup = renderToStaticMarkup(<ArmyChessModeContext.Provider value="flip"><ArmyChessBoard {...props} /></ArmyChessModeContext.Provider>);

    expect(darkMarkup.match(/class="online-army-slot/g)?.length).toBe(60);
    expect(darkMarkup).toContain('viewBox="0 0 900 1280"');
    expect(darkMarkup).toContain('r="25"');
    expect(darkMarkup).toContain('width="38"');
    expect(darkMarkup).toContain("前");
    expect(darkMarkup).toContain("is-hidden");
    expect(flipMarkup).toContain("is-hidden");
  });

  it("军棋翻牌写入共享局面并立即把回合交给对方", () => {
    const initial = createInitialPosition("army-chess");
    const redReveal = createOnlineMove({
      roomId: "army-room",
      gameId: "army-chess",
      seat: "red",
      seq: 1,
      position: initial,
      from: { x: 0, y: 0 },
      to: { x: 0, y: 0 },
    });

    expect(redReveal).not.toBeNull();
    const afterRed = parseOnlinePosition("army-chess", redReveal!.position);
    expect(afterRed?.turn).toBe("black");
    expect(afterRed?.revealed).toEqual([0]);
    expect(getLegalMoves("army-chess", redReveal!.position, "red")).toEqual([]);

    const blackReveal = createOnlineMove({
      roomId: "army-room",
      gameId: "army-chess",
      seat: "black",
      seq: 2,
      position: redReveal!.position,
      from: { x: 1, y: 0 },
      to: { x: 1, y: 0 },
    });
    expect(blackReveal).not.toBeNull();
    expect(parseOnlinePosition("army-chess", blackReveal!.position)?.turn).toBe("red");

    const markup = renderToStaticMarkup(
      <ArmyChessBoard state={afterRed} selected={null} targets={[]} onPoint={() => undefined} />,
    );
    expect(markup.match(/is-occupied is-revealed/g)?.length).toBe(1);
    expect(markup.match(/is-hidden/g)?.length).toBe(49);
  });

  it("中国象棋使用仓库内的真实棋盘和双方棋子素材", () => {
    const markup = renderToStaticMarkup(
      <OnlineBoardGame room={roomFor("xiangqi")} seat="red" client={{ sendMove: async () => undefined }} />,
    );
    expect(markup).toContain("http://47.97.219.242:18080/article-games/xiangqi-h5/img/stype_2/bg.png");
    expect(markup).toContain("http://47.97.219.242:18080/article-games/xiangqi-h5/img/stype_2/r_j.png");
    expect(markup).toContain("http://47.97.219.242:18080/article-games/xiangqi-h5/img/stype_2/b_j.png");
  });

  it("五子棋保留旧版 225 位位置兼容，同时新局面使用 JSON", () => {
    const legacy = "0".repeat(225);
    expect(getLegalMoves("gomoku", legacy, "red")).toHaveLength(225);
    const move = createOnlineMove({ roomId: "legacy", gameId: "gomoku", seat: "red", seq: 1, position: legacy, from: { x: 7, y: 7 } });
    expect(move?.position).toHaveLength(225);
    expect(move?.position[7 * 15 + 7]).toBe("1");
    expect(parseOnlinePosition("gomoku", move!.position)?.turn).toBe("black");
    expect(getLegalMoves("gomoku", move!.position, "red")).toHaveLength(0);
    expect(getLegalMoves("gomoku", move!.position, "black")).toHaveLength(224);

    const reply = createOnlineMove({
      roomId: "legacy",
      gameId: "gomoku",
      seat: "black",
      seq: 2,
      position: move!.position,
      from: { x: 8, y: 7 },
    });
    expect(reply?.position).toHaveLength(225);
    expect(reply?.position[7 * 15 + 8]).toBe("2");
    expect(parseOnlinePosition("gomoku", reply!.position)?.turn).toBe("red");
    expect(() => JSON.parse(createInitialPosition("gomoku"))).not.toThrow();
  });
});

describe("简单棋类纯函数规则", () => {
  it("井字棋拒绝占用位置并识别三连", () => {
    let position = createInitialPosition("tic-tac-toe");
    position = applyOnlineMove("tic-tac-toe", position, "red", { x: 0, y: 0 })!;
    position = applyOnlineMove("tic-tac-toe", position, "black", { x: 0, y: 1 })!;
    position = applyOnlineMove("tic-tac-toe", position, "red", { x: 1, y: 0 })!;
    position = applyOnlineMove("tic-tac-toe", position, "black", { x: 1, y: 1 })!;
    const winning = applyOnlineMove("tic-tac-toe", position, "red", { x: 2, y: 0 });
    expect(winning).not.toBeNull();
    expect(JSON.parse(winning!).result).toBe("red");
    expect(validateOnlineMove("tic-tac-toe", winning!, "black", { x: 0, y: 0 })).toBe(false);
  });

  it("黑白棋首步只接受能夹子的落点并翻转棋子", () => {
    const position = createInitialPosition("reversi");
    const moves = getLegalMoves("reversi", position, "red");
    expect(moves.length).toBe(4);
    const move = createOnlineMove({ roomId: "reversi", gameId: "reversi", seat: "red", seq: 1, position, from: moves[0].from, to: moves[0].to });
    expect(move).not.toBeNull();
    const next = JSON.parse(move!.position) as { board: string };
    expect(next.board.split("").filter((cell) => cell === "1")).toHaveLength(4);
    expect(validateOnlineMove("reversi", position, "red", { x: 0, y: 0 })).toBe(false);
  });

  it("六子棋首回合一子，随后同一回合可以落第二子", () => {
    let position = createInitialPosition("connect6");
    position = applyOnlineMove("connect6", position, "red", { x: 9, y: 9 })!;
    expect(JSON.parse(position).turn).toBe("black");
    position = applyOnlineMove("connect6", position, "black", { x: 8, y: 9 })!;
    expect(JSON.parse(position).turn).toBe("black");
    expect(getLegalMoves("connect6", position, "black").length).toBeGreaterThan(0);
    position = applyOnlineMove("connect6", position, "black", { x: 10, y: 9 })!;
    expect(JSON.parse(position).turn).toBe("red");
  });

  it("点格棋记录边、得格后保留回合", () => {
    let position = createInitialPosition("dots-and-boxes");
    position = applyOnlineMove("dots-and-boxes", position, "red", { x: 0, y: 0 }, { x: 1, y: 0 })!;
    expect(JSON.parse(position).board.h[0]).toBe("1");
    expect(JSON.parse(position).turn).toBe("black");
    expect(validateOnlineMove("dots-and-boxes", position, "black", { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(false);
  });

  it("播棋从己方坑播撒并保持可解析的仓位", () => {
    const position = createInitialPosition("mancala");
    const move = createOnlineMove({ roomId: "mancala", gameId: "mancala", seat: "red", seq: 1, position, from: { x: 0, y: 1 } });
    expect(move).not.toBeNull();
    const next = JSON.parse(move!.position) as { board: { pits: number[]; stores: number[] } };
    expect(next.board.pits.reduce((sum, value) => sum + value, 0) + next.board.stores[0] + next.board.stores[1]).toBe(48);
    expect(next.board.pits[0]).toBe(0);
  });

  it("点位型棋类不会发出越界坐标", () => {
    for (const gameId of ["ludo", "backgammon"] as const) {
      const entry = ONLINE_GAME_CATALOG.find((item) => item.id === gameId)!;
      const moves = getLegalMoves(gameId, createInitialPosition(gameId), "red");
      expect(moves.length).toBeGreaterThan(0);
      for (const move of moves) {
        expect(inBoard(move.from, entry.engine.board.columns, entry.engine.board.rows)).toBe(true);
        expect(inBoard(move.to, entry.engine.board.columns, entry.engine.board.rows)).toBe(true);
      }
    }
  });

  it("双陆棋收棋目标使用协议内的保留行，并且应用时严格匹配目标", () => {
    const points = Array.from({ length: 24 }, () => 0);
    points[23] = 1;
    const position = JSON.stringify({
      game: "backgammon",
      board: { points, bar: [0, 0], borneOff: [0, 0], roll: 1 },
      turn: "red",
    });
    const moves = getLegalMoves("backgammon", position, "red", { x: 11, y: 1 });
    expect(moves).toHaveLength(1);
    expect(moves[0].to).toEqual({ x: 11, y: 2 });
    expect(validateOnlineMove("backgammon", position, "red", { x: 11, y: 1 }, { x: 11, y: 1 })).toBe(false);
    const move = createOnlineMove({ roomId: "backgammon", gameId: "backgammon", seat: "red", seq: 1, position, from: { x: 11, y: 1 }, to: { x: 11, y: 2 } });
    expect(move).not.toBeNull();
    expect((JSON.parse(move!.position) as { board: { borneOff: number[] } }).board.borneOff[0]).toBe(1);
  });
});
