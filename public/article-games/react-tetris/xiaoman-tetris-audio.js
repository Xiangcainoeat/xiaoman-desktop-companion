(function () {
  "use strict";

  // The Electron host serves packaged games over loopback HTTP, where the
  // upstream bundle already starts its own WebAudio music. Only install the
  // fallback when somebody opens this entry directly from file:, otherwise a
  // second music track would be mixed into the normal game.
  var protocol = String(window.location && window.location.protocol || "").toLowerCase();
  if (protocol === "http:" || protocol === "https:") return;

  var audio = document.createElement("audio");
  audio.src = "./music.mp3";
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = 0.35;
  audio.setAttribute("aria-hidden", "true");
  audio.style.display = "none";
  document.body.appendChild(audio);

  window.__xiaomanSetGameMuted = function (muted) {
    audio.muted = Boolean(muted);
    if (audio.muted) {
      audio.pause();
      return;
    }
    var result = audio.play();
    if (result && result.catch) result.catch(function () {});
  };
})();
