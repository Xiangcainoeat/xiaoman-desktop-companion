const res = (() => {
    
    let o = {};

    let _images = null;
    let _audios = null;
    let _readyCalled = false;

    if (typeof window !== 'undefined') window.__xiaomanStarAudioReady = false;


    let call = (callback) => {
        if (_images && _audios && !_readyCalled) {
            _readyCalled = true;
            if (typeof window !== 'undefined') window.__xiaomanStarAudioReady = true;
            if (typeof callback === 'function') callback();
            o.loop('bg');
        }
    };

    o.imageBy = (key) => {
        return _images && _images[key];
    }

    o.audioFor = (key) => {
        return _audios && _audios[key];
    };

    o.isReady = () => Boolean(_audios);

    o.play = (key)=>{
        const audio = o.audioFor(key);
        if (!audio) return;
        setTimeout(()=>{
            const result = audio.play();
            if (result && result.catch) result.catch(() => {});
        },50);
    }

    o.loop = (key)=>{
        const audio = o.audioFor(key);
        if (audio) audio.loop = true;
    }
    
    o.pause = (key)=>{
        const audio = o.audioFor(key);
        if (audio) audio.pause();
    };

    o.end = (key)=>{
        const audio = o.audioFor(key);
        if (!audio) return;
        audio.currentTime = 0;
        audio.pause();
    };

    o.replay = (key)=>{
        o.end(key);
        o.play(key);
    }

    o.mute = ()=>{
        for (const el of Object.values(_audios || {})){
            el.muted = true;
        }
    }

    o.speak = ()=>{
        for (const el of Object.values(_audios || {})){
            el.muted = false;
        }
    }

    o.loadAssets = callback => {
        _readyCalled = false;
        if (typeof window !== 'undefined') window.__xiaomanStarAudioReady = false;
        loadImages(config.images, images => {
            _images = images;
            call(callback);
        });
        loadAudios(config.audios, audios => {
            _audios = audios;
            call(callback);
        });
    };

    return o;

})();
