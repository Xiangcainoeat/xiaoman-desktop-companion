(function () {
  "use strict";

  var paused = false;
  var muted = false;
  var online = {
    enabled: false,
    roomId: null,
    seat: null,
    turn: "red",
    seq: 0,
    status: "waiting",
    position: "initial",
  };
  var lastAppliedPosition = null;
  var pendingMode = null;

  function setBridgeState(state) {
    if (document.documentElement) {
      document.documentElement.setAttribute("data-xiaoman-xiangqi-state", state);
    }
  }

  function otherSeat(seat) {
    return seat === "red" ? "black" : "red";
  }

  function validSeat(seat) {
    return seat === "red" || seat === "black";
  }

  function validPoint(point) {
    return Boolean(point)
      && typeof point === "object"
      && Number.isInteger(point.x)
      && Number.isInteger(point.y)
      && point.x >= 0 && point.x <= 8
      && point.y >= 0 && point.y <= 9;
  }

  function cloneMap(map) {
    return map.map(function (row) {
      return row.map(function (cell) { return cell || null; });
    });
  }

  function validMap(map) {
    if (!Array.isArray(map) || map.length !== 10) return false;
    var args = window.com && window.com.args;
    return map.every(function (row) {
      return Array.isArray(row) && row.length === 9 && row.every(function (cell) {
        return cell === null || cell === undefined || cell === ""
          || (typeof cell === "string" && args && Boolean(args[cell.slice(0, 1)]));
      });
    });
  }

  function mapFromPosition(position) {
    if (position === "initial" || !position) {
      // The bundled starting position is trusted source data. Its sparse
      // array rows contain holes, so do not run it through the remote snapshot
      // validator before the upstream board has normalized it.
      return window.com && Array.isArray(window.com.initMap)
        ? cloneMap(window.com.initMap)
        : null;
    }
    if (typeof position !== "string") return null;
    try {
      var parsed = JSON.parse(position);
      var map = Array.isArray(parsed) ? parsed : parsed && parsed.map;
      return validMap(map) ? cloneMap(map) : null;
    } catch (_error) {
      return null;
    }
  }

  function positionFromPlay() {
    var map = window.play && window.play.map;
    return validMap(map) ? JSON.stringify({ version: 1, map: cloneMap(map) }) : null;
  }

  function boardResourceState() {
    var chess = window.com;
    if (!chess || !chess.pane || !chess.bg || !chess.dot) return "waiting-core";
    // com.init() starts these requests before window.onload creates the draw
    // objects. Online mode can arrive during that gap, so wait instead of
    // painting a permanently blank canvas.
    var images = [chess.bgImg, chess.dotImg, chess.paneImg];
    if (chess.args) {
      for (var key in chess.args) {
        var piece = chess[key] && chess[key].img;
        if (piece) images.push(piece);
      }
    }
    return images.every(function (image) {
      return image && image.complete
        && (typeof image.naturalWidth !== "number" || image.naturalWidth > 0);
    }) ? "ready" : "waiting-assets";
  }

  function boardResourcesReady() {
    return boardResourceState() === "ready";
  }

  function postToHost(channel, payload) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ channel: channel, ...payload }, "*");
    }
  }

  function patchPlay() {
    var game = window.play;
    if (!game) return;
    if (!game.__xiaomanPausePatched) {
      var originalClickCanvas = game.clickCanvas;
      var originalAIPlay = game.AIPlay;
      if (typeof originalClickCanvas === "function") {
        game.clickCanvas = function () {
          if (paused) return false;
          return originalClickCanvas.apply(this, arguments);
        };
      }
      if (typeof originalAIPlay === "function") {
        game.AIPlay = function () {
          if (paused || online.enabled) return false;
          return originalAIPlay.apply(this, arguments);
        };
      }
      game.__xiaomanPausePatched = true;
    }
  }

  function syncAudio() {
    ["clickAudio", "selectAudio"].forEach(function (id) {
      var audio = document.getElementById(id);
      if (audio) audio.muted = muted;
    });
  }

  function syncPlayState() {
    var game = window.play;
    if (!game) return;
    game.__xiaomanOnline = online.enabled;
    game.__xiaomanSeat = online.seat;
    game.__xiaomanTurn = online.turn;
    game.__xiaomanRoomId = online.roomId;
    game.__xiaomanSeq = online.seq;
    game.__xiaomanPaused = paused;
    game.__xiaomanOnLocalMove = onLocalMove;
    game.isPlay = !paused
      && online.enabled
      && online.status === "playing"
      && validSeat(online.seat);
    patchPlay();
  }

  function showOnlineBoard() {
    var board = document.getElementById("chessBox");
    var menu = document.getElementById("menuBox");
    if (board) board.style.display = "block";
    if (menu) menu.style.display = "none";
  }

  function applyPosition(position) {
    var map = mapFromPosition(position);
    var game = window.play;
    if (!map || !game || typeof game.init !== "function") return false;
    game.init(game.depth || 3, map);
    lastAppliedPosition = position || "initial";
    syncPlayState();
    return true;
  }

  function setOnlineMode(data) {
    if (!data || data.mode !== "online") return;
    pendingMode = data;
    online.enabled = true;
    online.roomId = typeof data.roomId === "string" ? data.roomId : null;
    online.seat = validSeat(data.seat) ? data.seat : null;
    online.turn = validSeat(data.turn) ? data.turn : "red";
    online.seq = Number.isInteger(data.seq) && data.seq >= 0 ? data.seq : 0;
    online.status = typeof data.status === "string" ? data.status : "waiting";
    online.position = typeof data.position === "string" ? data.position : "initial";
    showOnlineBoard();

    var resourceState = boardResourceState();
    if (!window.play || !window.com || !window.com.initMap || resourceState !== "ready") {
      setBridgeState("online-" + resourceState);
      return;
    }
    try {
      if (lastAppliedPosition !== online.position || !window.play.map) {
        if (!applyPosition(online.position)) {
          setBridgeState("online-invalid-position");
          postToHost("xiaoman-xiangqi-error", { roomId: online.roomId, message: "棋局快照无效" });
          return;
        }
      } else {
        syncPlayState();
      }
    } catch (_error) {
      setBridgeState("online-init-error");
      postToHost("xiaoman-xiangqi-error", { roomId: online.roomId, message: "棋盘初始化失败" });
      return;
    }
    pendingMode = null;
    setBridgeState("online-ready");
    postToHost("xiaoman-xiangqi-ready", { roomId: online.roomId, seq: online.seq });
  }

  function onLocalMove(move) {
    if (!online.enabled || !online.roomId || !validSeat(online.seat) || online.status !== "playing") return;
    if (online.turn !== online.seat || !validPoint(move.from) || !validPoint(move.to)) return;
    var position = positionFromPlay();
    if (!position) {
      postToHost("xiaoman-xiangqi-error", { roomId: online.roomId, message: "无法生成棋局快照" });
      return;
    }
    var nextSeq = online.seq + 1;
    var sentMove = {
      roomId: online.roomId,
      gameId: "xiangqi",
      seat: online.seat,
      from: move.from,
      to: move.to,
      captured: move.captured || null,
      position: position,
      seq: nextSeq,
      createdAt: Date.now(),
    };
    online.seq = nextSeq;
    online.turn = otherSeat(online.seat);
    online.position = position;
    lastAppliedPosition = position;
    syncPlayState();
    postToHost("xiaoman-xiangqi-move", { move: sentMove });
  }

  function applyRemoteMove(data) {
    if (!data || data.channel !== "xiaoman-xiangqi-remote-move") return;
    var move = data.move;
    if (!online.enabled || !online.roomId || !move || typeof move !== "object") return;
    if (move.roomId !== online.roomId || move.gameId !== "xiangqi" || !validSeat(move.seat)) return;
    if (move.seat === online.seat || move.seq !== online.seq + 1 || move.seat !== online.turn) return;
    if (!validPoint(move.from) || !validPoint(move.to) || typeof move.position !== "string") return;
    if (!applyPosition(move.position)) {
      postToHost("xiaoman-xiangqi-error", { roomId: online.roomId, message: "远端棋局快照无效" });
      return;
    }
    online.seq = move.seq;
    online.turn = otherSeat(move.seat);
    online.position = move.position;
    syncPlayState();
  }

  function applyRoomState(data) {
    if (!data || data.channel !== "xiaoman-xiangqi-room-state") return;
    if (!online.enabled || !online.roomId || data.roomId !== online.roomId) return;
    if (!Number.isInteger(data.seq) || data.seq < online.seq) return;
    if (typeof data.status === "string") online.status = data.status;
    if (validSeat(data.turn)) online.turn = data.turn;
    online.seq = data.seq;
    syncPlayState();
  }

  window.__xiaomanSetOnlineMode = setOnlineMode;
  setBridgeState("boot");

  window.addEventListener("message", function (event) {
    if (event.source && window.parent && event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.channel === "xiaoman-xiangqi-mode") {
      setOnlineMode(data);
      return;
    }
    if (data.channel === "xiaoman-xiangqi-room-state") {
      applyRoomState(data);
      return;
    }
    applyRemoteMove(data);
  });

  window.__xiaomanSetGamePaused = function (nextPaused) {
    paused = Boolean(nextPaused);
    syncPlayState();
  };

  window.__xiaomanSetGameMuted = function (nextMuted) {
    muted = Boolean(nextMuted);
    syncAudio();
  };

  window.setInterval(function () {
    patchPlay();
    syncAudio();
    if (pendingMode) setOnlineMode(pendingMode);
  }, 100);
})();
