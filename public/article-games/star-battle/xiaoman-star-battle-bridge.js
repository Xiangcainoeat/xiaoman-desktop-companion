(function () {
  "use strict";

  var requestedPaused = false;
  var requestedMuted = true;

  function playScene() {
    var game = window.__xiaomanStarGame;
    return game && game.scenes ? game.scenes.play : null;
  }

  function sync() {
    var scene = playScene();
    if (!scene || typeof scene.pause !== "function" || typeof scene.start !== "function") return;

    if (requestedPaused && scene.pauseFlag !== true) scene.pause();
    if (!requestedPaused && scene.pauseFlag === true) scene.start();
    if (window.__xiaomanStarAudioReady !== true) return;
    if (requestedMuted && scene.muteFlag !== true && typeof scene.mute === "function") scene.mute();
    if (!requestedMuted && scene.muteFlag === true && typeof scene.speak === "function") scene.speak();
  }

  window.__xiaomanSetGamePaused = function (nextPaused) {
    requestedPaused = Boolean(nextPaused);
    sync();
  };

  window.__xiaomanSetGameMuted = function (nextMuted) {
    requestedMuted = Boolean(nextMuted);
    sync();
  };

  window.setInterval(sync, 120);
})();
