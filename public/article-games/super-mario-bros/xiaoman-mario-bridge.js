(function () {
  "use strict";

  var difficulty = "easy";
  var level = "1-1";
  var revivesLeft = 3;
  var hostPaused = false;
  var lastDead = false;
  var overlay = null;
  var message = null;
  var reviveButton = null;
  var checkpoint = null;

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_error) { return null; }
  }

  function controller() {
    return window.controller || null;
  }

  function hero() {
    var current = controller();
    var sprites = current && current.world && current.world.sprites;
    if (!sprites) return null;
    if (typeof sprites.findWhere === "function") return sprites.findWhere({ hero: true }) || null;
    if (typeof sprites.where === "function") return (sprites.where({ hero: true }) || [])[0] || null;
    return null;
  }

  function createOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "xiaoman-mario-recovery";
    overlay.setAttribute("data-xiaoman-control", "true");
    overlay.innerHTML =
      '<div class="xiaoman-mario-recovery-panel" data-xiaoman-control="true">' +
      '<strong class="xiaoman-mario-recovery-title">本局结束</strong>' +
      '<p class="xiaoman-mario-recovery-message"></p>' +
      '<div class="xiaoman-mario-recovery-actions">' +
      '<button type="button" data-xiaoman-control="true" data-xiaoman-mario-action="revive">复活</button>' +
      '<button type="button" data-xiaoman-control="true" data-xiaoman-mario-action="restart">重新开始</button>' +
      '</div></div>';
    document.body.appendChild(overlay);
    message = overlay.querySelector(".xiaoman-mario-recovery-message");
    reviveButton = overlay.querySelector('[data-xiaoman-mario-action="revive"]');
    overlay.addEventListener("click", function (event) {
      var target = event.target;
      if (!(target instanceof HTMLElement)) return;
      var action = target.getAttribute("data-xiaoman-mario-action");
      if (action === "revive") revive();
      if (action === "restart") restart();
    });
  }

  function updateRecoveryUi() {
    createOverlay();
    if (!overlay || !message || !reviveButton) return;
    var canRevive = difficulty === "easy" && revivesLeft > 0;
    reviveButton.hidden = !canRevive;
    reviveButton.disabled = !canRevive;
    message.textContent = canRevive
      ? "还可以复活 " + revivesLeft + " 次，或重新开始本关。"
      : "困难模式不提供复活，请重新开始本关。";
  }

  function showRecovery() {
    updateRecoveryUi();
    if (overlay) overlay.style.display = "flex";
  }

  function hideRecovery() {
    if (overlay) overlay.style.display = "none";
  }

  // Keep a lightweight native-world checkpoint. It uses the engine's own
  // persistence contract so revive restores the current run instead of
  // throwing away the player's progress through a full-level restart.
  function saveCheckpoint() {
    var current = controller();
    var world = current && current.world;
    if (!world || typeof world.toShallowJSON !== "function" || !world.sprites) return false;
    var sprites = [];
    if (typeof world.sprites.each === "function") {
      world.sprites.each(function (sprite) {
        if (!sprite || typeof sprite.toSave !== "function") return;
        var saved = sprite.toSave();
        if (saved) sprites.push(saved);
      });
    }
    var shallow = clone(world.toShallowJSON());
    var savedSprites = clone(sprites);
    if (!shallow || !savedSprites) return false;
    checkpoint = {
      world: shallow,
      sprites: savedSprites,
      time: Number(typeof world.get === "function" ? world.get("time") : 0) || 0,
    };
    return true;
  }

  function restoreCheckpoint() {
    var current = controller();
    var world = current && current.world;
    if (!world || !checkpoint || typeof world.spawnSprites !== "function") return false;
    var snapshot = clone(checkpoint.world);
    var sprites = clone(checkpoint.sprites);
    if (!snapshot || !sprites) return false;
    snapshot.sprites = sprites;
    snapshot.time = checkpoint.time;
    snapshot.state = hostPaused ? "pause" : "play";
    world.set(snapshot);
    world.spawnSprites();
    lastDead = false;
    hideRecovery();
    return true;
  }

  function resetWorld() {
    var current = controller();
    if (!current || typeof current.restartWorld !== "function") return false;
    current.restartWorld();
    lastDead = false;
    hideRecovery();
    window.setTimeout(function () {
      if (hostPaused) setPaused(true);
    }, 0);
    return true;
  }

  function revive() {
    if (difficulty !== "easy" || revivesLeft <= 0) return;
    if (restoreCheckpoint()) {
      revivesLeft -= 1;
      updateRecoveryUi();
    }
  }

  function restart() {
    revivesLeft = difficulty === "easy" ? 3 : 0;
    resetWorld();
  }

  function setPaused(nextPaused) {
    hostPaused = Boolean(nextPaused);
    var current = controller();
    var world = current && current.world;
    if (!current || !world || typeof current.toggleState !== "function") return;
    var nativePaused = world.get("state") === "pause";
    if (nativePaused !== hostPaused) current.toggleState();
  }

  function sync() {
    createOverlay();
    var current = controller();
    if (!current) return;
    var currentHero = hero();
    if (!currentHero) return;
    var dead = Boolean(typeof currentHero.get === "function" ? currentHero.get("dead") : currentHero.dead);
    if (dead && !lastDead) showRecovery();
    if (!dead && lastDead) hideRecovery();
    lastDead = dead;
    var worldState = current.world && typeof current.world.get === "function" ? current.world.get("state") : null;
    if (!dead && (!current.world || worldState === "play")) saveCheckpoint();
    if (dead) updateRecoveryUi();
    if (hostPaused) setPaused(true);
  }

  window.__xiaomanSetGameConfig = function (payload) {
    if (!payload) return;
    if (payload.kind === "mario-difficulty") {
      var nextDifficulty = payload.value === "hard" ? "hard" : "easy";
      if (nextDifficulty !== difficulty) {
        difficulty = nextDifficulty;
        revivesLeft = difficulty === "easy" ? 3 : 0;
      }
      updateRecoveryUi();
    }
    if (payload.kind === "mario-level") {
      // The bundled upstream checkout contains one verified level. Keep the
      // value explicit so additional packaged level files can be added later.
      level = payload.value === "1-1" ? "1-1" : level;
      document.documentElement.setAttribute("data-xiaoman-mario-level", level);
    }
  };

  window.__xiaomanSetGamePaused = function (nextPaused) {
    setPaused(nextPaused);
  };

  var style = document.createElement("style");
  style.textContent =
    "#xiaoman-mario-recovery{position:fixed;inset:0;z-index:20;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.56);font:16px/1.5 system-ui,sans-serif}" +
    ".xiaoman-mario-recovery-panel{min-width:280px;padding:22px;border:1px solid rgba(255,255,255,.35);border-radius:12px;background:rgba(25,25,30,.94);color:#fff;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.35)}" +
    ".xiaoman-mario-recovery-title{display:block;font-size:24px}.xiaoman-mario-recovery-message{margin:8px 0 16px;color:#d9d9df}" +
    ".xiaoman-mario-recovery-actions{display:flex;justify-content:center;gap:10px}.xiaoman-mario-recovery-actions button{border:0;border-radius:7px;padding:9px 14px;background:#5b8f68;color:#fff;font:inherit;cursor:pointer}.xiaoman-mario-recovery-actions button[hidden]{display:none}";
  document.head.appendChild(style);
  window.setInterval(sync, 100);
})();
