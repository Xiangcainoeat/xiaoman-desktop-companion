# 联机房间服务器

小满桌面伴侣的“联机房间”在桌面端和手机浏览器中都只走服务器。未登录时页面是
登录/注册门禁，不会显示房间或演示数据；登录后才读取用户参与的房间。
桌面端默认连接当前联调地址 `http://47.97.219.242:18080`，部署到服务器上的网页则使用
自己的同源地址。页面可以修改服务器地址，但不存在可供用户选择的本机模式。

服务器网页只渲染“互动游戏”和“联机房间”。Codex 当前任务、上下文、宠物包、养成、
提醒、应用事件和偏好设置不会出现在网页端，也没有对应的服务端接口；这些能力仅由下载的
Electron 应用通过本机 IPC 提供。

仓库里的 `GuestLocalTransport` 仅用于纯客户端单元测试和协议回归测试，不能作为生产
传输器，也没有被默认工厂或用户界面暴露。

## 当前部署

服务器使用独立的 Node 服务和 SQLite 数据文件：

```text
服务目录：/opt/xiaoman-social
容器名称：xiaoman-social
监听端口：18080 -> 容器 18080
健康检查：http://47.97.219.242:18080/healthz
数据目录：/opt/xiaoman-social/data
```

它与宿主上已有的网站、Nginx 和其他容器隔离。更新时只更新 `xiaoman-social`，不要
执行针对整个 Docker 主机的 `down`、批量重启或覆盖 Nginx 配置。

当前端口是 HTTP 联调端点，不能保护传输中的真实密码。正式使用前应在反向代理上配置
HTTPS/WSS，并将 `SOCIAL_COOKIE_SECURE=true`；同时把 `SOCIAL_PUBLIC_ORIGIN` 和
`SOCIAL_CORS_ORIGINS` 改为正式域名。不能把这个 HTTP 地址当作生产登录入口。

## 本地运行服务

服务器要求 Node 22 或更高版本，因为运行时使用内置 `node:sqlite`：

```bash
cd server
npm ci
npm test
npm start
```

从仓库根目录运行服务端测试：

```bash
npm run server:test
```

容器方式：

```bash
cd server
docker compose up -d --build
```

通过环境变量配置端口、数据库和来源：

```bash
SOCIAL_PORT=18080 \
SOCIAL_PUBLIC_ORIGIN=https://your-domain.example \
SOCIAL_CORS_ORIGINS=https://your-domain.example,null \
SOCIAL_COOKIE_SECURE=true \
docker compose up -d --build
```

## HTTP 接口

默认 API 前缀是 `/api/v1`。成功响应统一为 `{ "data": ... }`；列表放在
`data.items`。错误只返回稳定代码和用户可读消息，不回显密码、token 或数据库错误。

| 用途 | 方法 | 路径 | 请求体/查询 |
| --- | --- | --- | --- |
| 当前会话 | `GET` | `/api/v1/session` | 无 |
| 注册 | `POST` | `/api/v1/auth/register` | `{ "username": "...", "password": "...", "displayName": "..." }` |
| 登录 | `POST` | `/api/v1/auth/login` | `{ "username": "...", "password": "..." }` |
| 退出 | `POST` | `/api/v1/auth/logout` | 无 |
| 房间列表 | `GET` | `/api/v1/game-rooms` | 已登录 |
| 创建房间 | `POST` | `/api/v1/game-rooms` | `{ "gameId": "<16 个联机游戏 ID>" }` |
| 加入房间 | `POST` | `/api/v1/game-rooms/:id/join` | `{}` |
| 准备 | `POST` | `/api/v1/game-rooms/:id/ready` | `{ "ready": true }` |
| 走子兼容接口 | `POST` | `/api/v1/game-rooms/:id/moves` | `GameMoveInput`；新客户端的实时落子不使用此接口 |
| 认输 | `POST` | `/api/v1/game-rooms/:id/resign` | `{}` |
| 离开房间 | `DELETE` | `/api/v1/game-rooms/:id` | 无 |
| 再来一局 | `POST` | `/api/v1/game-rooms/:id/rematch` | `{}` |
| 申请悔棋 | `POST` | `/api/v1/game-rooms/:id/undo-request` | `{}`；仅最后落子方 |
| 回应悔棋 | `POST` | `/api/v1/game-rooms/:id/undo-response` | `{ "accept": true/false }`；仅对手 |

除公开会话检查外，接口需要 `Authorization: Bearer <token>`。浏览器也可以使用服务端
下发的 HttpOnly `xiaoman_session` cookie。桌面端只把 token 放在当前进程内存中，不写入
localStorage、配置文件或日志；应用重启后需要重新登录，服务器上的账号和游戏数据仍保留。

## 实时连接

认证成功后，客户端连接：

```text
ws(s)://<origin>/api/v1/realtime
```

连接后发送一次版本化认证信封：

```json
{
  "version": 1,
  "type": "auth",
  "payload": { "token": "<access-token>" }
}
```

认证成功后服务端发送 `session.ready`。客户端只在收到该事件后把连接标记为可用，随后通过
同一条长连接提交落子：

```json
{
  "version": 1,
  "type": "game.move.submit",
  "requestId": "move_...",
  "roomId": "room_...",
  "seq": 1,
  "payload": { "move": { "gameId": "gomoku" } }
}
```

服务端校验并提交事务后，先广播带相同 `requestId` 的 `game.move` 增量，再广播权威的
`room.updated` 快照。发送方在提交前立即进行乐观落子，因此界面不等待网络往返；拒绝、
超时或序号缺口只会通过 `GET /api/v1/game-rooms/:id` 恢复当前房间，不会重新拉取全部房间。
客户端每 15 秒发送 `ping`，服务端返回 `pong` 来维持连接。

服务端会向相关房间参与者广播以下事件：

- `session.ready`，认证后的实时连接可用
- `room.updated`，`payload.room`
- `game.move`，`payload.move`
- `game.resync`，信封中的 `roomId`、`seq` 和 `payload.position`、`payload.turn`
- `pong`，长连接心跳响应
- `error`，`payload.code` 和 `payload.message`

未知版本或事件会被忽略。客户端对房间走子要求序号严格连续；服务端也会检查席位、
回合、房间状态和序号，拒绝重复或越权走子。

## 联机棋局

联机房间支持参考目录中的 16 个游戏：`gomoku`、`tic-tac-toe`、`chess`、`reversi`、
`checkers`、`xiangqi`、`go`、`shogi`、`connect6`、`ludo`、`animal-chess`、`army-chess`、
`backgammon`、`dots-and-boxes`、`mancala` 和 `chinese-checkers`。创建者获得红方席位，
第二位加入者获得黑方席位；两方都准备后进入进行中状态。

五子棋使用 15×15 的字符串棋盘：`0` 为空位、`1` 为红方/黑方、`2` 为黑方/白方。
其他棋类使用结构化 JSON 局面，至少包含 `game`、`board` 和 `turn`。每次落子使用同一个
`GameMove` 信封，并提交完整的下一局面；服务端在事务中重新读取房间，校验游戏 ID、席位、
回合、序号、坐标、局面形状和棋子归属，再保存走子。客户端不能把越权席位或不匹配房间的
局面提交为成功结果。

邀请有两种可分享形式：创建房间后复制带房间码的链接，或复制邀请码/房间号。接收方打开
链接后登录即可加入对应房间，也可以手动输入房间号。房间列表保存所有仍属于该房间的用户，因此刷新页面、重新打开
应用或 WebSocket 断线重连后都可以重新拉取完整棋盘、回合和最后一步。结束后任意一方可以
发起再战邀请；房间保留结束局面并实时提示另一方。对方接受时，服务端在同一事务内清空
棋盘、将双方标记为已准备并直接开始新一局，不需要两人再次逐个点击准备。

进行中的棋局允许最后落子方申请悔棋。请求写入房间并实时广播，在对手接受或拒绝前双方
暂停落子；接受后服务端事务性删除最后一步、恢复上一局面和回合，再广播新的权威快照。
这套协议由全部 16 款联机棋类共享，并可在断线重连后继续显示待处理请求。

中国象棋历史房间继续兼容原有 H5 局面编码；新目录中的 16 款游戏由应用内统一棋盘渲染器
承载，并共享同一套房间恢复、准备和实时走子协议。

## 安全边界

- 密码在服务端使用 scrypt 哈希，数据库不保存明文密码。
- 会话数据库只保存 token 的 SHA-256 哈希；日志不会记录认证字段。
- 私有 REST 路由全部要求有效会话，并校验房间席位。
- 默认 CORS 是来源白名单；生产环境不要使用 `*` 配合带凭据请求。
- HTTP 联调地址只用于开发验证。生产必须使用 HTTPS/WSS、Secure cookie 和受限来源。

## 客户端配置

桌面端默认值在 `src/social/client.ts` 的 `DEFAULT_SOCIAL_SERVER_ORIGIN`。构建时可以用
`VITE_SOCIAL_SERVER_ORIGIN` 覆盖；服务器网页没有覆盖时自动使用当前页面 origin：

```bash
VITE_SOCIAL_SERVER_ORIGIN=https://your-domain.example npm run build
```

网页端和桌面端共享同一套 REST/WebSocket 客户端与房间协议；手机网页使用独立的紧凑
布局和触控输入层，不复制一套业务状态。未登录的网页只显示认证门禁，登录后才会加载私有数据。
