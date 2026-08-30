(function () {
  "use strict";

  // The upstream bundle reads its initial speed from this record before it
  // mounts React. Persisting the selected level and reloading gives the
  // original reducers the same state they would have received from their
  // missing settings screen.
  var STORAGE_KEY = "REACT_TETRIS";
  var MIN_LEVEL = 1;
  var MAX_LEVEL = 6;
  var hostPaused = false;
  var reloadQueued = false;

  function readRecord() {
    var raw = null;
    try { raw = window.localStorage.getItem(STORAGE_KEY); } catch (_error) { return {}; }
    if (!raw) return {};
    try {
      raw = window.atob(raw);
      raw = window.decodeURIComponent(raw);
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  function writeRecord(record) {
    try {
      var encoded = window.encodeURIComponent(JSON.stringify(record));
      window.localStorage.setItem(STORAGE_KEY, window.btoa(encoded));
    } catch (_error) {
      // The game can still run with its built-in default when storage is blocked.
    }
  }

  function dispatchKey(type, key, code, keyCode) {
    var event = new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      key: key,
      code: code,
      keyCode: keyCode,
      which: keyCode,
    });
    ["keyCode", "which"].forEach(function (property) {
      try { Object.defineProperty(event, property, { configurable: true, value: keyCode }); } catch (_error) {}
    });
    document.dispatchEvent(event);
  }

  function toggleNativePause() {
    dispatchKey("keydown", "p", "KeyP", 80);
  }

  function setDifficulty(value) {
    var level = Number(value);
    if (!isFinite(level)) level = MIN_LEVEL;
    level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(level)));
    var record = readRecord();
    if (Number(record.speedStart) === level && Number(record.speedRun) === level) return;
    record.speedStart = level;
    record.speedRun = level;
    writeRecord(record);
    if (reloadQueued) return;
    reloadQueued = true;
    window.setTimeout(function () { window.location.reload(); }, 0);
  }

  window.__xiaomanSetGameConfig = function (payload) {
    if (!payload || payload.kind !== "tetris-difficulty") return;
    setDifficulty(payload.value);
  };

  // React Tetris owns its timer and Redux pause state, so the generic iframe
  // pause controller also forwards the native P action through this hook.
  window.__xiaomanSetGamePaused = function (nextPaused) {
    var paused = Boolean(nextPaused);
    if (paused === hostPaused) return;
    hostPaused = paused;
    toggleNativePause();
  };
})();
