(function () {
  "use strict";

  // Pacman keeps its animation loop alive while a Stage is paused. The small
  // guard in game.js checks this flag and paints the last frame without
  // advancing gameplay, which preserves the original canvas implementation.
  window.__xiaomanPacmanPaused = false;
  window.__xiaomanSetGamePaused = function (nextPaused) {
    window.__xiaomanPacmanPaused = Boolean(nextPaused);
  };

  // The upstream game listens for arrow key codes only. The host catalog also
  // advertises WASD, so translate those forwarded events before they reach the
  // original window-level handler. The marker prevents a translated event from
  // being translated a second time.
  var WASD_TO_ARROW = { 65: 37, 87: 38, 68: 39, 83: 40 };
  document.addEventListener("keydown", function (event) {
    var sourceCode = Number(event.keyCode || event.which || 0);
    var arrowCode = WASD_TO_ARROW[sourceCode];
    if (!arrowCode || event.__xiaomanPacmanTranslated) return;
    var translated = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: arrowCode === 37 ? "ArrowLeft" : arrowCode === 38 ? "ArrowUp" : arrowCode === 39 ? "ArrowRight" : "ArrowDown",
      code: arrowCode === 37 ? "ArrowLeft" : arrowCode === 38 ? "ArrowUp" : arrowCode === 39 ? "ArrowRight" : "ArrowDown",
      keyCode: arrowCode,
      which: arrowCode,
      repeat: event.repeat,
    });
    try { Object.defineProperty(translated, "keyCode", { configurable: true, value: arrowCode }); } catch (_error) {}
    try { Object.defineProperty(translated, "which", { configurable: true, value: arrowCode }); } catch (_error) {}
    try { Object.defineProperty(translated, "__xiaomanPacmanTranslated", { configurable: false, value: true }); } catch (_error) { translated.__xiaomanPacmanTranslated = true; }
    document.dispatchEvent(translated);
  }, true);
})();
