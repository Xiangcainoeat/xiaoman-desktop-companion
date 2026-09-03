import {
  CircleDot,
  CircleHelp,
  Dices,
  Gamepad2,
  Grid3X3,
  LogIn,
  Plus,
  Shield,
  Sparkles,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { LucideIcon } from "lucide-react";
import type { SocialClient, SocialClientSnapshot } from "../social/client";
import { socialErrorMessage } from "../social/state";
import type { SocialGameId } from "../social/types";
import { ONLINE_GAME_IDS, type OnlineGameId } from "../online-games/types";
import { GameArtMark } from "./ArticleGameView";

export interface OnlineGameCatalogItem {
  id: OnlineGameId;
  label: string;
  description: string;
  rules: string;
  players: string;
  category: "棋类" | "桌游";
  icon: LucideIcon;
  tone: "green" | "blue" | "coral" | "amber";
}

const GAME_DETAILS: Record<OnlineGameId, Omit<OnlineGameCatalogItem, "id">> = {
  gomoku: { label: "五子棋", description: "落子连成五子即可取胜。", rules: "15 × 15 棋盘", players: "双人", category: "棋类", icon: CircleDot, tone: "green" },
  "tic-tac-toe": { label: "井字棋", description: "三乘三棋盘上的快速对局。", rules: "连成三子", players: "双人", category: "棋类", icon: Grid3X3, tone: "blue" },
  chess: { label: "国际象棋", description: "经典的王、后、车、马、象、兵对弈。", rules: "标准棋盘", players: "双人", category: "棋类", icon: Shield, tone: "green" },
  reversi: { label: "黑白棋", description: "夹住对手棋子并翻转棋面。", rules: "8 × 8 棋盘", players: "双人", category: "棋类", icon: CircleDot, tone: "blue" },
  checkers: { label: "国际跳棋", description: "沿对角线跳跃并吃掉对手棋子。", rules: "跳跃吃子", players: "双人", category: "棋类", icon: Sparkles, tone: "coral" },
  xiangqi: { label: "中国象棋", description: "楚河汉界之间排兵布阵。", rules: "九宫与河界", players: "双人", category: "棋类", icon: Shield, tone: "coral" },
  go: { label: "围棋", description: "以围地和提子展开长局较量。", rules: "19 × 19 棋盘", players: "双人", category: "棋类", icon: CircleDot, tone: "green" },
  shogi: { label: "日本将棋", description: "带有持驹规则的日本棋类。", rules: "9 × 9 棋盘", players: "双人", category: "棋类", icon: Shield, tone: "amber" },
  connect6: { label: "六子棋", description: "轮流落子，先连成六子获胜。", rules: "连成六子", players: "双人", category: "棋类", icon: CircleDot, tone: "blue" },
  ludo: { label: "飞行棋", description: "掷骰子让棋子绕赛道前进。", rules: "骰子赛道", players: "多人", category: "桌游", icon: Dices, tone: "coral" },
  "animal-chess": { label: "斗兽棋", description: "利用地形和等级吃掉对方棋子。", rules: "动物等级", players: "双人", category: "桌游", icon: Sparkles, tone: "amber" },
  "army-chess": { label: "陆军棋", description: "隐藏棋子与地雷布局的策略对抗。", rules: "暗棋策略", players: "双人", category: "桌游", icon: Shield, tone: "green" },
  backgammon: { label: "双陆棋", description: "根据骰子点数移动棋子回到基地。", rules: "双骰赛道", players: "双人", category: "桌游", icon: Dices, tone: "blue" },
  "dots-and-boxes": { label: "点格棋", description: "连接边线，完成更多方格。", rules: "围成方格", players: "双人", category: "桌游", icon: Grid3X3, tone: "coral" },
  mancala: { label: "播棋", description: "分配棋子并收集更多种子。", rules: "分配与计分", players: "双人", category: "桌游", icon: CircleDot, tone: "amber" },
  "chinese-checkers": { label: "中国跳棋", description: "跳跃棋子，率先占领对角营地。", rules: "星形棋盘", players: "多人", category: "桌游", icon: Sparkles, tone: "green" },
};

export const ONLINE_GAME_CATALOG: readonly OnlineGameCatalogItem[] = ONLINE_GAME_IDS.map((id) => ({
  id,
  ...GAME_DETAILS[id],
}));

export function onlineGameLabel(gameId: string): string {
  return ONLINE_GAME_CATALOG.find((game) => game.id === gameId)?.label ?? "联机游戏";
}

/**
 * The renderer's older SocialGameId union predates the expanded room catalog.
 * Keep the conversion at this boundary so every action still goes through
 * the real SocialClient instead of introducing a second transport contract.
 */
function asSocialGameId(gameId: OnlineGameId): SocialGameId {
  return gameId as unknown as SocialGameId;
}

export interface OnlineGamesViewProps {
  client: SocialClient;
  snapshot: SocialClientSnapshot;
  onOpenRooms?: () => void;
}

const GAME_FILTERS = ["全部", "棋类", "桌游"] as const;
type GameFilter = (typeof GAME_FILTERS)[number];

export function OnlineGamesView({ client, snapshot, onOpenRooms = () => undefined }: OnlineGamesViewProps) {
  const [selectedGame, setSelectedGame] = useState<OnlineGameId>("gomoku");
  const [roomCode, setRoomCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busyGame, setBusyGame] = useState<OnlineGameId | null>(null);
  const [filter, setFilter] = useState<GameFilter>("全部");

  const visibleGames = useMemo(
    () => filter === "全部" ? ONLINE_GAME_CATALOG : ONLINE_GAME_CATALOG.filter((game) => game.category === filter),
    [filter],
  );

  const run = async (action: () => Promise<void>, gameId?: OnlineGameId) => {
    setBusyGame(gameId ?? null);
    try {
      await action();
    } catch (error) {
      setNotice(socialErrorMessage(error));
    } finally {
      setBusyGame(null);
    }
  };

  const createRoom = (gameId: OnlineGameId) => run(async () => {
    const room = await client.createRoom({ gameId: asSocialGameId(gameId) });
    setNotice(`${onlineGameLabel(room.gameId)}房间已创建：${room.code}`);
    onOpenRooms();
  }, gameId);

  const joinRoom = async (event: FormEvent) => {
    event.preventDefault();
    const code = roomCode.trim();
    if (!code) return;
    await run(async () => {
      const room = await client.joinRoom({ code });
      setRoomCode("");
      setNotice(`已加入${onlineGameLabel(room.gameId)}房间：${room.code}`);
      onOpenRooms();
    });
  };

  const authenticated = snapshot.session.authState === "authenticated";

  return (
    <div className="online-games-view" aria-label="联机游戏大厅">
      <section className="online-games-heading">
        <div>
          <span className="eyebrow">联机房间</span>
          <h2>开一局联机游戏</h2>
          <p>创建房间，分享链接或房间码，实时加入对局。</p>
        </div>
        <div className="online-games-status-group">
          <span className="online-games-live"><i />实时联机</span>
          <span className="online-games-count"><Gamepad2 size={16} />{ONLINE_GAME_CATALOG.length} 款游戏</span>
        </div>
      </section>

      <section className="online-games-lobby" aria-label="房间操作">
        <div className="online-games-action-copy">
          <span className="eyebrow">新建房间</span>
          <strong>选一个游戏，马上开局</strong>
          <small>创建后可以复制邀请链接或邀请码。</small>
        </div>
        <div className="online-games-create">
          <label>
            <span>游戏</span>
            <select value={selectedGame} onChange={(event) => setSelectedGame(event.target.value as OnlineGameId)} disabled={!authenticated || Boolean(busyGame) || snapshot.busy}>
              {ONLINE_GAME_CATALOG.map((game) => <option value={game.id} key={game.id}>{game.label}</option>)}
            </select>
          </label>
          <button className="primary-button" type="button" disabled={!authenticated || Boolean(busyGame) || snapshot.busy} onClick={() => void createRoom(selectedGame)}>
            <Plus size={16} />创建房间
          </button>
        </div>
        <form className="online-games-join" onSubmit={joinRoom}>
          <label>
            <span>已有房间</span>
            <input value={roomCode} placeholder="输入房间码" aria-label="房间码" maxLength={16} onChange={(event) => setRoomCode(event.target.value)} disabled={!authenticated || Boolean(busyGame) || snapshot.busy} />
          </label>
          <button className="secondary-button" type="submit" disabled={!authenticated || !roomCode.trim() || Boolean(busyGame) || snapshot.busy}>
            <LogIn size={15} />加入房间
          </button>
        </form>
      </section>

      {notice && <div className="social-notice online-games-notice" role="status">{notice}</div>}

      <section className="online-games-catalog" aria-label="联机游戏清单">
        <div className="online-games-section-heading">
          <div><span className="eyebrow">游戏清单</span><h3>全部联机游戏</h3></div>
          <div className="online-games-filter-row" role="tablist" aria-label="游戏分类">
            {GAME_FILTERS.map((item) => (
              <button key={item} type="button" role="tab" aria-selected={filter === item} className={filter === item ? "is-active" : ""} onClick={() => setFilter(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="online-games-grid">
          {visibleGames.map((game) => {
            const isBusy = busyGame === game.id;
            return (
              <article className="online-game-card" key={game.id}>
                <GameArtMark name={game.id} size={40} />
                <div className="online-game-copy">
                  <div className="online-game-title-row"><h4>{game.label}</h4><span>{game.category}</span></div>
                  <p>{game.description}</p>
                  <div className="online-game-meta"><span>{game.rules}</span><span>{game.players}</span><span>实时房间</span></div>
                </div>
                <button className="secondary-button compact online-game-create" type="button" disabled={!authenticated || Boolean(busyGame) || snapshot.busy} onClick={() => void createRoom(game.id)}>
                  <Plus size={14} />{isBusy ? "创建中" : "创建房间"}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="online-games-room-callout" aria-label="我的房间入口">
        <div>
          <span className="eyebrow">房间入口</span>
          <strong>创建后进入“我的房间”</strong>
          <p>在那里可以继续对局、查看剩余时间，或再次复制房间号和邀请链接。</p>
        </div>
        <button className="secondary-button" type="button" onClick={onOpenRooms}>
          <LogIn size={15} />查看我的房间
        </button>
      </section>

      <p className="online-games-footnote"><CircleHelp size={14} />房间只通过房间号、邀请码或邀请链接加入；连续 1 小时无活动后自动销毁。</p>
    </div>
  );
}
