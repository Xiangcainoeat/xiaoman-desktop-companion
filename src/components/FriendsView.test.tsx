import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./FriendsView.tsx", import.meta.url), "utf8");
const onlineSource = readFileSync(new URL("./OnlineGamesView.tsx", import.meta.url), "utf8");

describe("friends and online workspace", () => {
  it("keeps room workspaces behind an explicit authentication gate", () => {
    for (const label of ["单机游戏", "联机房间", "我的房间", "登录联机房间", "创建小满账号", "退出登录", "房间号", "复制邀请码", "复制邀请链接", "剩余"]) {
      expect(source).toContain(label);
    }
    expect(source).toContain('snapshot.session.authState !== "authenticated"');
    expect(source).toContain("AuthenticatedSocialWorkspace");
    expect(source).not.toContain("登录好友与联机");
    expect(source).not.toContain("邀请好友");
  });

  it("routes room creation, joining, sharing and play actions through SocialClient", () => {
    for (const method of ["createRoom", "joinRoom", "setReady", "leaveRoom", "resign", "rematch", "refreshRooms"]) {
      expect(source).toContain(`client.${method}`);
    }
    expect(source).toContain("useSocialClient");
    expect(source).toContain("OnlineGomokuBoard");
    expect(source).toContain('import { OnlineBoardGame } from "../online-games"');
    expect(source).toContain("<OnlineBoardGame room={activeRoom} seat={ownSeat} client={client} />");
    expect(source).toContain("roomInviteUrl");
    expect(source).toContain("navigator.share");
    expect(source).not.toContain("selectedFriendId");
    expect(source).not.toContain("sendMessage");
  });

  it("keeps the online game lobby and my-room route separate", () => {
    expect(source).toContain("OnlineGamesView");
    expect(source).toContain('FriendsViewSection = "social" | "online-games"');
    expect(source).toContain('initialSection = "social"');
    for (const label of ["创建或加入联机房间", "我的房间列表", "闲置 1 小时自动销毁", "onOpenSingleGames"]) expect(source).toContain(label);
    expect(source).not.toContain('className="social-section-tabs"');
    expect(onlineSource).toContain("全部联机游戏");
    expect(onlineSource).toContain("查看我的房间");
    expect(onlineSource).toContain("房间只通过房间号");
  });

  it("distinguishes the configured server and does not expose a local fallback", () => {
    expect(source).toContain("连接服务器");
    expect(source).toContain("服务器地址");
    expect(source).toContain("服务器连接");
    expect(source).not.toContain("本地测试对手");
  });
});
