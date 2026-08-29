(function () {
  "use strict";

  var KEY_CODES = {
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    " ": 32,
    Space: 32,
    Enter: 13,
    Escape: 27,
    w: 87,
    W: 87,
    a: 65,
    A: 65,
    s: 83,
    S: 83,
    d: 68,
    D: 68,
    x: 88,
    X: 88,
    z: 90,
    Z: 90,
  };

  function codeFor(data) {
    return Number(data.keyCode || data.which || KEY_CODES[data.key] || 0);
  }

  function makeKeyboardEvent(type, data) {
    var keyCode = codeFor(data);
    var event = new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      key: data.key || "",
      code: data.code || "",
      repeat: Boolean(data.repeat),
      keyCode: keyCode,
      which: keyCode,
    });
    ["keyCode", "which"].forEach(function (property) {
      try {
        Object.defineProperty(event, property, { configurable: true, value: keyCode });
      } catch (_error) {
        // Old engines may expose these properties as read-only.
      }
    });
    return event;
  }

  function focusGame() {
    if (document.body && document.activeElement !== document.body) {
      document.body.setAttribute("tabindex", "0");
      document.body.focus({ preventScroll: true });
    }
    try {
      window.focus();
    } catch (_error) {
      // A sandboxed frame may reject focus without a user gesture.
    }
  }

  var gameActive = true;
  var gameMuted = false;
  var originalMediaPlay = typeof HTMLMediaElement !== "undefined"
    ? HTMLMediaElement.prototype.play
    : null;

  function syncMediaActivity() {
    var media = document.querySelectorAll("audio, video");
    for (var i = 0; i < media.length; i += 1) {
      var item = media[i];
      if (!gameActive || gameMuted) {
        if (!item.__xiaomanMuteStateSaved) {
          item.__xiaomanMuteStateSaved = true;
          item.__xiaomanMuted = { muted: item.muted, wasPlaying: !item.paused };
        }
        item.muted = true;
        if (!item.paused) item.pause();
      } else if (item.__xiaomanMuteStateSaved) {
        item.muted = item.__xiaomanMuted.muted;
        if (gameActive && item.__xiaomanMuted.wasPlaying && item.play) {
          var playResult = item.play();
          if (playResult && playResult.catch) playResult.catch(function () {});
        }
        item.__xiaomanMuteStateSaved = false;
      }
    }
  }

  function syncPhaserActivity() {
    var games = window.Phaser && window.Phaser.GAMES;
    if (!games) return;
    for (var i = 0; i < games.length; i += 1) {
      var sound = games[i] && games[i].sound;
      if (!sound) continue;
      if (!gameActive || gameMuted) {
        if (!sound.__xiaomanMuteStateSaved) {
          sound.__xiaomanMuteStateSaved = true;
          sound.__xiaomanMuted = Boolean(sound.mute);
        }
        sound.mute = true;
      } else if (sound.__xiaomanMuteStateSaved) {
        sound.mute = sound.__xiaomanMuted;
        sound.__xiaomanMuteStateSaved = false;
      }
    }
  }

  function syncWebAudioActivity() {
    var games = window.Phaser && window.Phaser.GAMES;
    var contexts = [];
    var gains = [window.__xiaomanAudioMasterGain, window.xiaomanAudioMasterGain];
    if (window.__xiaomanAudioContext) contexts.push(window.__xiaomanAudioContext);
    if (window.xiaomanAudioContext) contexts.push(window.xiaomanAudioContext);
    if (games) {
      for (var i = 0; i < games.length; i += 1) {
        var sound = games[i] && games[i].sound;
        if (!sound) continue;
        if (sound.context) contexts.push(sound.context);
        if (sound.masterGain) gains.push(sound.masterGain);
        if (sound._masterGain) gains.push(sound._masterGain);
      }
    }
    var shouldSuspend = !gameActive;
    for (var g = 0; g < gains.length; g += 1) {
      var masterGain = gains[g];
      if (!masterGain || !masterGain.gain) continue;
      if (masterGain.__xiaomanGainValue === undefined) masterGain.__xiaomanGainValue = masterGain.gain.value;
      masterGain.gain.value = gameMuted ? 0 : masterGain.__xiaomanGainValue;
    }
    for (var c = 0; c < contexts.length; c += 1) {
      var context = contexts[c];
      if (!context || !context.suspend || !context.resume) continue;
      if (shouldSuspend && context.state === "running") {
        context.__xiaomanVisibilitySuspended = true;
        context.suspend();
      } else if (!shouldSuspend && context.__xiaomanVisibilitySuspended) {
        context.__xiaomanVisibilitySuspended = false;
        context.resume();
      }
    }
  }

  function setGameActive(nextActive) {
    gameActive = nextActive !== false;
    document.documentElement.setAttribute("data-xiaoman-game-active", gameActive ? "true" : "false");
    syncMediaActivity();
    syncPhaserActivity();
    syncWebAudioActivity();
    document.dispatchEvent(new CustomEvent("xiaoman-game-visibility", {
      detail: { active: gameActive },
    }));
  }

  function setGameMuted(nextMuted) {
    gameMuted = nextMuted === true;
    document.documentElement.setAttribute("data-xiaoman-game-muted", gameMuted ? "true" : "false");
    syncMediaActivity();
    syncPhaserActivity();
    syncWebAudioActivity();
  }

  if (originalMediaPlay) {
    HTMLMediaElement.prototype.play = function () {
      if (!gameActive) return Promise.resolve();
      return originalMediaPlay.apply(this, arguments);
    };
  }

  document.documentElement.setAttribute("data-xiaoman-game-adapter", "ready");
  document.documentElement.setAttribute("data-xiaoman-game-active", "true");
  if (document.body) document.body.setAttribute("tabindex", "0");
  document.addEventListener("pointerdown", focusGame, true);
  document.addEventListener("mousedown", focusGame, true);
  document.addEventListener("touchstart", focusGame, true);

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (data && data.channel === "xiaoman-game-visibility") {
      setGameActive(data.active !== false);
      return;
    }
    if (data && data.channel === "xiaoman-game-audio") {
      setGameMuted(data.muted === true);
      return;
    }
    if (!data || data.channel !== "xiaoman-game-key") return;
    if (!codeFor(data)) return;
    document.dispatchEvent(makeKeyboardEvent(data.eventType || "keydown", data));
  });

  if (window.parent !== window) {
    window.parent.postMessage({ channel: "xiaoman-game-ready" }, "*");
  }
})();
