(function () {
  "use strict";

  var paused = false;
  var muted = false;

  function patchPlay() {
    var game = window.play;
    if (!game || game.__xiaomanPausePatched) return;
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
        if (paused) return false;
        return originalAIPlay.apply(this, arguments);
      };
    }
    game.__xiaomanPausePatched = true;
  }

  function syncAudio() {
    ["clickAudio", "selectAudio"].forEach(function (id) {
      var audio = document.getElementById(id);
      if (audio) audio.muted = muted;
    });
  }

  window.__xiaomanSetGamePaused = function (nextPaused) {
    paused = Boolean(nextPaused);
    if (window.play) {
      window.play.__xiaomanPaused = paused;
      window.play.isPlay = !paused;
    }
    patchPlay();
  };

  window.__xiaomanSetGameMuted = function (nextMuted) {
    muted = Boolean(nextMuted);
    syncAudio();
  };

  window.setInterval(function () {
    patchPlay();
    syncAudio();
  }, 100);
})();
