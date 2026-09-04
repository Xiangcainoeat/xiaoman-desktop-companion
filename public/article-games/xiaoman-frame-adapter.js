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
    p: 80,
    P: 80,
    m: 77,
    M: 77,
    r: 82,
    R: 82,
    j: 74,
    J: 74,
    "/": 191,
    "?": 191,
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
  // Pause is owned by the host toolbar. Do not let a native Space/Enter
  // action accidentally unpause a game while the host still marks it paused.
  var PAUSE_KEY_CODES = { 27: true, 80: true };

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
  var gamePaused = false;
  // Games open muted by default. The host sends the persisted toolbar state
  // after load, while this default also closes the short pre-load audio race.
  var gameMuted = true;
  var originalMediaPlay = typeof HTMLMediaElement !== "undefined"
    ? HTMLMediaElement.prototype.play
    : null;

  function effectivePaused() {
    return !gameActive || gamePaused;
  }

  function callGameHook(name, value) {
    var hook = window[name];
    if (typeof hook !== "function") return;
    try {
      hook(value);
    } catch (_error) {
      // A game-specific hook must not break the shared host controls.
    }
  }

  function safePlay(media) {
    if (!media || !originalMediaPlay || effectivePaused()) return;
    try {
      var result = originalMediaPlay.call(media);
      if (result && result.catch) result.catch(function () {});
    } catch (_error) {
      // Autoplay policy can reject a resume; the next user gesture can retry.
    }
  }

  function mediaState(item) {
    if (!item.__xiaomanMediaState) {
      item.__xiaomanMediaState = {
        nativeMuted: Boolean(item.muted),
        hostMuted: false,
        hostPaused: false,
        wasPlaying: false,
      };
    }
    return item.__xiaomanMediaState;
  }

  function syncMediaItem(item) {
    var state = mediaState(item);
    if (!gameMuted && !state.hostMuted) state.nativeMuted = Boolean(item.muted);
    if (gameMuted) {
      if (!state.hostMuted) {
        state.nativeMuted = Boolean(item.muted);
        state.hostMuted = true;
      }
      item.muted = true;
    } else if (state.hostMuted) {
      item.muted = state.nativeMuted;
      state.hostMuted = false;
    }

    if (effectivePaused()) {
      if (!state.hostPaused) {
        state.wasPlaying = !item.paused;
        state.hostPaused = true;
      }
      if (!item.paused) item.pause();
    } else if (state.hostPaused) {
      state.hostPaused = false;
      if (state.wasPlaying) safePlay(item);
    }
  }

  function syncMediaActivity() {
    var media = document.querySelectorAll("audio, video");
    var tracked = window.__xiaomanAudioElements || [];
    for (var i = 0; i < media.length; i += 1) syncMediaItem(media[i]);
    for (var t = 0; t < tracked.length; t += 1) syncMediaItem(tracked[t]);
  }

  function phaserGames() {
    return window.Phaser && window.Phaser.GAMES ? window.Phaser.GAMES : [];
  }

  function syncPhaserActivity() {
    var games = phaserGames();
    var shouldPause = effectivePaused();
    for (var i = 0; i < games.length; i += 1) {
      var game = games[i];
      if (!game) continue;
      if (typeof game.paused === "boolean") {
        if (shouldPause) {
          if (!game.__xiaomanPauseStateSaved) {
            game.__xiaomanPauseStateSaved = true;
            game.__xiaomanNativePaused = Boolean(game.paused);
          }
          game.paused = true;
        } else if (game.__xiaomanPauseStateSaved) {
          game.paused = game.__xiaomanNativePaused;
          game.__xiaomanPauseStateSaved = false;
        }
      }
      var sound = game.sound;
      if (!sound || typeof sound.mute !== "boolean") continue;
      if (gameMuted) {
        if (!sound.__xiaomanMuteStateSaved) {
          sound.__xiaomanMuteStateSaved = true;
          sound.__xiaomanNativeMuted = Boolean(sound.mute);
        }
        sound.mute = true;
      } else if (sound.__xiaomanMuteStateSaved) {
        sound.mute = sound.__xiaomanNativeMuted;
        sound.__xiaomanMuteStateSaved = false;
      }
    }
  }

  function uniquePush(list, item) {
    if (item && list.indexOf(item) < 0) list.push(item);
  }

  function syncWebAudioActivity() {
    var contexts = [];
    var gains = [];
    var games = phaserGames();
    var knownContexts = window.__xiaomanAudioContexts || [];
    for (var i = 0; i < knownContexts.length; i += 1) uniquePush(contexts, knownContexts[i]);
    uniquePush(contexts, window.__xiaomanAudioContext);
    uniquePush(contexts, window.xiaomanAudioContext);
    for (var g = 0; g < games.length; g += 1) {
      var sound = games[g] && games[g].sound;
      if (!sound) continue;
      uniquePush(contexts, sound.context);
      uniquePush(gains, sound.masterGain);
      uniquePush(gains, sound._masterGain);
    }

    // Register first. The shared audio hook creates a master gain lazily for
    // contexts discovered through Phaser or another library; collecting gains
    // before this step misses that newly-created node on the first sync.
    for (var c = 0; c < contexts.length; c += 1) {
      var context = contexts[c];
      if (window.__xiaomanRegisterAudioContext) {
        try { window.__xiaomanRegisterAudioContext(context); } catch (_error) {}
      }
      uniquePush(gains, context && context.__xiaomanMasterGain);
    }
    uniquePush(gains, window.__xiaomanAudioMasterGain);
    uniquePush(gains, window.xiaomanAudioMasterGain);

    for (var m = 0; m < gains.length; m += 1) {
      var masterGain = gains[m];
      if (!masterGain || !masterGain.gain) continue;
      if (masterGain.__xiaomanGainValue === undefined) masterGain.__xiaomanGainValue = masterGain.gain.value;
      masterGain.gain.value = gameMuted ? 0 : masterGain.__xiaomanGainValue;
    }

    for (var c2 = 0; c2 < contexts.length; c2 += 1) {
      var context = contexts[c2];
      var hasMaster = Boolean(context && context.__xiaomanMasterGain);
      var shouldSuspend = effectivePaused() || (gameMuted && !hasMaster);
      if (!context || !context.suspend || !context.resume) continue;
      if (shouldSuspend && context.state === "running") {
        context.__xiaomanHostSuspended = true;
        context.suspend();
      } else if (!shouldSuspend && context.__xiaomanHostSuspended) {
        context.__xiaomanHostSuspended = false;
        context.resume();
      }
    }
  }

  function syncAll() {
    syncMediaActivity();
    syncPhaserActivity();
    syncWebAudioActivity();
    // Keep game-specific engines (whose audio graph may be created lazily)
    // aligned with the same host-level mute state as native media/WebAudio.
    callGameHook("__xiaomanSetGameMuted", gameMuted);
  }

  function notifyPauseState() {
    var paused = effectivePaused();
    callGameHook("__xiaomanSetGamePaused", paused);
    document.dispatchEvent(new CustomEvent("xiaoman-game-pause", {
      detail: { paused: paused, active: gameActive, manual: gamePaused },
    }));
  }

  function setGameActive(nextActive) {
    gameActive = nextActive !== false;
    document.documentElement.setAttribute("data-xiaoman-game-active", gameActive ? "true" : "false");
    syncAll();
    document.dispatchEvent(new CustomEvent("xiaoman-game-visibility", {
      detail: { active: gameActive },
    }));
    notifyPauseState();
  }

  function setGamePaused(nextPaused) {
    gamePaused = nextPaused === true;
    document.documentElement.setAttribute("data-xiaoman-game-paused", gamePaused ? "true" : "false");
    syncAll();
    notifyPauseState();
  }

  function setGameMuted(nextMuted) {
    gameMuted = nextMuted === true;
    document.documentElement.setAttribute("data-xiaoman-game-muted", gameMuted ? "true" : "false");
    syncAll();
    document.dispatchEvent(new CustomEvent("xiaoman-game-audio", {
      detail: { muted: gameMuted },
    }));
  }

  function setGameConfig(kind, value) {
    callGameHook("__xiaomanSetGameConfig", { kind: kind, value: value });
    document.dispatchEvent(new CustomEvent("xiaoman-game-config", {
      detail: { kind: kind, value: value },
    }));
  }

  function isInteractiveGameControl(target) {
    return Boolean(target && target.closest && target.closest(
      "[data-xiaoman-control], button, a, select, input, textarea, summary, [role=\"button\"], [contenteditable=\"true\"]"
    ));
  }

  // The host CSS owns hit testing for inactive panels. Only an explicit manual
  // pause blocks game pointer input; a transient visibility flag must not make
  // the selected game's own menu buttons inert.
  function blockPausedPointer(event) {
    if (!gamePaused || isInteractiveGameControl(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function blockPausedKeyboard(event) {
    if (!effectivePaused() || PAUSE_KEY_CODES[Number(event.keyCode || event.which || 0)]) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  if (originalMediaPlay) {
    HTMLMediaElement.prototype.play = function () {
      var state = mediaState(this);
      if (gameMuted) this.muted = true;
      if (effectivePaused()) {
        state.wasPlaying = true;
        state.hostPaused = true;
        return Promise.resolve();
      }
      return originalMediaPlay.apply(this, arguments);
    };
  }

  document.documentElement.setAttribute("data-xiaoman-game-adapter", "ready");
  document.documentElement.setAttribute("data-xiaoman-game-active", "true");
  document.documentElement.setAttribute("data-xiaoman-game-paused", "false");
  document.documentElement.setAttribute("data-xiaoman-game-muted", "true");
  if (document.body) document.body.setAttribute("tabindex", "0");
  document.addEventListener("pointerdown", focusGame, true);
  document.addEventListener("mousedown", focusGame, true);
  document.addEventListener("touchstart", focusGame, true);
  document.addEventListener("pointerdown", blockPausedPointer, true);
  document.addEventListener("mousedown", blockPausedPointer, true);
  document.addEventListener("touchstart", blockPausedPointer, true);
  document.addEventListener("click", blockPausedPointer, true);
  document.addEventListener("keydown", blockPausedKeyboard, true);
  document.addEventListener("keyup", blockPausedKeyboard, true);
  if (typeof MutationObserver !== "undefined" && document.documentElement) {
    var observer = new MutationObserver(function () { syncAll(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  syncAll();
  window.setInterval(syncAll, 250);

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (data && data.channel === "xiaoman-game-visibility") {
      setGameActive(data.active !== false);
      return;
    }
    if (data && data.channel === "xiaoman-game-pause") {
      setGamePaused(data.paused === true);
      return;
    }
    if (data && data.channel === "xiaoman-game-audio") {
      setGameMuted(data.muted === true);
      return;
    }
    if (data && data.channel === "xiaoman-game-config") {
      setGameConfig(String(data.kind || ""), data.value);
      return;
    }
    if (!data || data.channel !== "xiaoman-game-key") return;
    var keyCode = codeFor(data);
    if (!keyCode || !gameActive) return;
    if (gamePaused && !PAUSE_KEY_CODES[keyCode]) return;
    document.dispatchEvent(makeKeyboardEvent(data.eventType || "keydown", data));
  });

  if (window.parent !== window) {
    window.parent.postMessage({ channel: "xiaoman-game-ready" }, "*");
  }
})();
