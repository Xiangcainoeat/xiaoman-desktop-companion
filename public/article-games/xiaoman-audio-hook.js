(function () {
  "use strict";

  // Install before an embedded game creates its AudioContext. Direct output
  // connections are routed through one gain node owned by the host adapter.
  if (window.__xiaomanAudioHookInstalled) return;
  window.__xiaomanAudioHookInstalled = true;

  var contexts = window.__xiaomanAudioContexts = window.__xiaomanAudioContexts || [];
  var mediaElements = window.__xiaomanAudioElements = window.__xiaomanAudioElements || [];
  var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  var originalConnect = window.AudioNode && window.AudioNode.prototype && window.AudioNode.prototype.connect;

  function rememberMedia(media) {
    if (!media || mediaElements.indexOf(media) >= 0) return media;
    mediaElements.push(media);
    return media;
  }

  function rememberContext(context) {
    if (!context || contexts.indexOf(context) >= 0) return context;
    contexts.push(context);
    return context;
  }

  function ensureMasterGain(context) {
    if (!context || typeof context.createGain !== "function") return context;
    if (context.__xiaomanMasterGain) return rememberContext(context);
    try {
      var gain = context.createGain();
      gain.gain.value = 1;
      if (originalConnect) originalConnect.call(gain, context.destination);
      context.__xiaomanMasterGain = gain;
      rememberContext(context);
      window.__xiaomanAudioContext = context;
      window.__xiaomanAudioMasterGain = gain;
    } catch (_error) {
      // A restricted browser may deny graph inspection; the media fallback
      // in xiaoman-frame-adapter.js still handles HTML audio elements.
    }
    return context;
  }

  if (originalConnect) {
    window.AudioNode.prototype.connect = function () {
      var context = this.context;
      var destination = arguments[0];
      var master = context && context.__xiaomanMasterGain;
      if (master && destination === context.destination && this !== master) {
        var args = Array.prototype.slice.call(arguments);
        args[0] = master;
        return originalConnect.apply(this, args);
      }
      return originalConnect.apply(this, arguments);
    };
  }

  if (AudioContextCtor) {
    function WrappedAudioContext() {
      var context;
      try {
        context = arguments.length ? new AudioContextCtor(arguments[0]) : new AudioContextCtor();
      } catch (_error) {
        context = AudioContextCtor.apply(null, arguments);
      }
      return ensureMasterGain(context);
    }
    WrappedAudioContext.prototype = AudioContextCtor.prototype;
    try {
      window.AudioContext = WrappedAudioContext;
      if (window.webkitAudioContext) window.webkitAudioContext = WrappedAudioContext;
    } catch (_error) {
      // Keep the original constructor when the host exposes it as read-only.
    }
  }

  // Older games such as Battle City create detached Audio objects. They do
  // not show up in document.querySelectorAll(), so retain them for the host
  // mute/pause controller.
  var OriginalAudio = window.Audio;
  if (OriginalAudio && !OriginalAudio.__xiaomanWrapped) {
    function WrappedAudio() {
      var args = Array.prototype.slice.call(arguments);
      var media;
      try {
        if (args.length > 1) media = new OriginalAudio(args[0], args[1]);
        else if (args.length === 1) media = new OriginalAudio(args[0]);
        else media = new OriginalAudio();
      } catch (_error) {
        media = document.createElement("audio");
        if (args.length) media.src = args[0];
      }
      return rememberMedia(media);
    }
    WrappedAudio.prototype = OriginalAudio.prototype;
    WrappedAudio.__xiaomanWrapped = true;
    try { window.Audio = WrappedAudio; } catch (_error) {
      // Keep the native constructor when the WebView exposes it as read-only.
    }
  }

  var originalCreateElement = document.createElement;
  if (originalCreateElement && !originalCreateElement.__xiaomanWrapped) {
    document.createElement = function (name) {
      var element = originalCreateElement.apply(document, arguments);
      if (String(name).toLowerCase() === "audio") rememberMedia(element);
      return element;
    };
    document.createElement.__xiaomanWrapped = true;
  }

  // A library can create a context through a delayed constructor path.
  window.__xiaomanRegisterAudioContext = function (context) {
    return ensureMasterGain(context);
  };
  window.__xiaomanRememberAudioElement = rememberMedia;
})();
