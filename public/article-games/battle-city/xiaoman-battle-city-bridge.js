(function () {
  "use strict";

  var hostPaused = false;

  function dispatchEscape() {
    var event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
    });
    try { Object.defineProperty(event, "keyCode", { configurable: true, value: 27 }); } catch (_error) {}
    try { Object.defineProperty(event, "which", { configurable: true, value: 27 }); } catch (_error) {}
    document.dispatchEvent(event);
  }

  // Battle City exposes its pause action through Escape in the original
  // saga. Keep that behavior and make it idempotent from the host's point of
  // view by dispatching only when the requested state changes.
  window.__xiaomanSetGamePaused = function (nextPaused) {
    var paused = Boolean(nextPaused);
    if (paused === hostPaused) return;
    hostPaused = paused;
    dispatchEscape();
  };
})();
