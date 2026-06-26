/* ===================================================================
   AUDIO — Abyssal dark-fantasy mix bus system with ducking, cathedral
   reverb, voice pool, vertical (intensity overlay) + horizontal
   (mode crossfade) music. Licensed external assets in ./audio/.
   Self-contained — exports a single AUDIO API object.
   =================================================================== */
export const AUDIO = (()=>{
  // ---- State ----
  let ctx = null, ready = false, muted = false, initPromise = null;
  let mode = 'none';
  let intensity = 0, targetIntensity = 0;
  let bossWasActive = false;
  // ---- Graph ----
  let master, preMaster, glueComp, limiter, dcBlock;
  let musicBus, sfxBus, uiBus, ambientBus;
  let convolver, reverbSend, reverbGain;
  const MUSIC_BASE_GAIN = 0.54;
  // ---- Samples ----
  const AUDIO_ASSET_VERSION = 'abyssal-licensed-v4';
  const ASSETS = {
    menu:          'audio/menu.ogg',
    main_low:      'audio/main_low.ogg',
    main_high:     'audio/main_high.ogg',
    ai_fight:      'audio/ai_fight.ogg',
    boss:          'audio/boss.ogg',
    sfx_explosion: 'audio/sfx_explosion.ogg',
    sfx_shield:    'audio/sfx_shield.ogg',
    sfx_ui:        'audio/sfx_ui.ogg',
    sfx_levelup:   'audio/sfx_levelup.ogg',
    sfx_bosslaser: 'audio/sfx_bosslaser.ogg',
    sfx_shoot:     'audio/sfx_shoot.ogg',
    sfx_hit:       'audio/sfx_hit.ogg',
    sfx_pickup:    'audio/sfx_pickup.ogg',
    sfx_damage:    'audio/sfx_damage.ogg',
    sfx_heal:      'audio/sfx_heal.ogg',
    sfx_freeze:    'audio/sfx_freeze.ogg',
    sfx_laser:     'audio/sfx_laser.ogg',
    sfx_blip:      'audio/sfx_blip.ogg'
  };
  const buffers = {};
  const cooldowns = { shoot:0.045, hit:0.045, pickup:0.075, laser:0.055, blip:0.05 };
  const lastPlayed = {};
  let camX = 0, camY = 0, screenW = 1280;
  const layers = {};
  const mainPlaylist = ['main_low', 'main_high', 'ai_fight'];
  let mainPlaylistIndex = 0;

  function makeIR(duration=3.1, decay=4.1, darkness=0.11){
    const rate = ctx.sampleRate, len = (rate*duration)|0;
    const buf = ctx.createBuffer(2, len, rate);
    for(let c=0;c<2;c++){
      const d = buf.getChannelData(c);
      let lp = 0;
      for(let i=0;i<len;i++){
        const t = i/len;
        const env = Math.pow(1 - t, decay);
        const n = (Math.random()*2-1) * env;
        lp += (n - lp) * darkness;
        d[i] = lp * 0.82;
      }
    }
    return buf;
  }

  function buildGraph(){
    master = ctx.createGain();      master.gain.value = 0.9;
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.001; limiter.release.value = 0.05;
    glueComp = ctx.createDynamicsCompressor();
    glueComp.threshold.value = -18; glueComp.knee.value = 12; glueComp.ratio.value = 3;
    glueComp.attack.value = 0.01;  glueComp.release.value = 0.2;
    preMaster = ctx.createGain();   preMaster.gain.value = 0.48;
    dcBlock = ctx.createBiquadFilter();
    dcBlock.type = 'highpass'; dcBlock.frequency.value = 22; dcBlock.Q.value = 0.707;
    preMaster.connect(dcBlock); dcBlock.connect(glueComp); glueComp.connect(limiter);
    limiter.connect(master); master.connect(ctx.destination);

    musicBus   = ctx.createGain(); musicBus.gain.value   = MUSIC_BASE_GAIN;
    sfxBus     = ctx.createGain(); sfxBus.gain.value     = 0.9;
    uiBus      = ctx.createGain(); uiBus.gain.value      = 0.78;
    ambientBus = ctx.createGain(); ambientBus.gain.value = 0.62;
    musicBus.connect(preMaster);
    sfxBus.connect(preMaster);
    uiBus.connect(preMaster);
    ambientBus.connect(preMaster);

    const rLP = ctx.createBiquadFilter();
    rLP.type = 'lowpass'; rLP.frequency.value = 2300; rLP.Q.value = 0.55;
    convolver  = ctx.createConvolver(); convolver.buffer = makeIR(3.1, 4.1, 0.11);
    reverbSend = ctx.createGain(); reverbSend.gain.value = 0.9;
    reverbGain = ctx.createGain(); reverbGain.gain.value = 0.34;
    reverbSend.connect(rLP); rLP.connect(convolver);
    convolver.connect(reverbGain); reverbGain.connect(preMaster);
  }

  async function loadBuffers(){
    const entries = Object.entries(ASSETS);
    await Promise.all(entries.map(async ([k,url])=>{
      try{
        const bustedUrl = url + (url.includes('?') ? '&' : '?') + 'v=' + AUDIO_ASSET_VERSION;
        const r = await fetch(bustedUrl, { cache: 'reload' });
        if(!r.ok) throw new Error(r.status+' '+url);
        const ab = await r.arrayBuffer();
        buffers[k] = await ctx.decodeAudioData(ab);
      } catch(e){ console.warn('[AUDIO] missing', k, e.message||e); }
    }));
  }

  async function init(){
    if(ready && ctx){
      if(ctx.state==='suspended' && ctx.resume) await ctx.resume();
      return true;
    }
    if(initPromise) return initPromise;
    initPromise = (async()=>{
      try{
        if(!ctx){
          ctx = new (window.AudioContext || window.webkitAudioContext)();
          buildGraph();
        }
        if(ctx.state==='suspended' && ctx.resume) await ctx.resume();
        await loadBuffers();
        ready = true;
        if(typeof window !== 'undefined'){
          window.__neonPulseAudio = {
            get ctx(){ return ctx; },
            get ready(){ return ready; },
            get mode(){ return mode; },
            get intensity(){ return intensity; },
            get buffers(){ return buffers; },
            get layers(){ return layers; },
            get assetVersion(){ return AUDIO_ASSET_VERSION; },
            get sources(){ return ASSETS; },
            buses(){ return { master, preMaster, musicBus, sfxBus, uiBus, ambientBus, reverbGain }; },
            call: (fn, ...a)=> API[fn] && API[fn](...a),
          };
        }
      } catch(e){
        console.warn('[AUDIO] init failed', e);
        ready = false;
        initPromise = null;
      }
      return ready;
    })();
    return initPromise;
  }

  function duck(depthDb=-8, attack=0.03, hold=0.12, release=0.5){
    if(!musicBus) return;
    const target = MUSIC_BASE_GAIN * Math.pow(10, depthDb/20);
    const g = musicBus.gain, now = ctx.currentTime;
    const cur = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.min(cur, MUSIC_BASE_GAIN), now);
    g.linearRampToValueAtTime(Math.min(target, cur), now + attack);
    g.setValueAtTime(Math.min(target, cur), now + attack + hold);
    g.linearRampToValueAtTime(MUSIC_BASE_GAIN, now + attack + hold + release);
  }

  function setCamera(x,y,w){ camX = x; camY = y; if(w) screenW = w; }
  function pan(x){
    if(typeof x!=='number' || !screenW) return 0;
    return Math.max(-0.7, Math.min(0.7, ((x - camX) / (screenW/2)) * 0.7));
  }
  function distLP(x,y){
    if(typeof x!=='number') return 18000;
    const d = Math.hypot(x-camX, (y||0)-camY);
    const n = Math.min(1, d / (screenW*0.7));
    return 18000 - n*14000;
  }

  function ping(freq=440, dur=.12, type='square', vol=.25, slide=null, bus=null, panVal=0){
    if(!ctx || muted) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    if(slide) o.frequency.exponentialRampToValueAtTime(slide, ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + dur);
    const out = bus || sfxBus;
    if(panVal){
      const pn = ctx.createStereoPanner(); pn.pan.value = panVal;
      o.connect(g); g.connect(pn); pn.connect(out); pn.connect(reverbSend);
    } else {
      o.connect(g); g.connect(out); g.connect(reverbSend);
    }
    o.start(); o.stop(ctx.currentTime + dur + .02);
  }
  function noise(dur=.18, vol=.22, hp=300, lp=4000, bus=null, panVal=0){
    if(!ctx || muted) return;
    const len = (ctx.sampleRate * dur)|0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i] = (Math.random()*2-1) * (1 - i/len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = (hp+lp)/2; f.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = vol;
    const out = bus || sfxBus;
    src.connect(f); f.connect(g);
    if(panVal){
      const pn = ctx.createStereoPanner(); pn.pan.value = panVal;
      g.connect(pn); pn.connect(out);
    } else {
      g.connect(out);
    }
    src.start();
  }
  function darkBell(freq=220, dur=.8, vol=.12, bus=null, panVal=0){
    ping(freq, dur, 'sine', vol, freq * 0.58, bus, panVal);
    ping(freq * 1.997, dur * 0.55, 'triangle', vol * 0.22, freq * 0.82, bus, panVal);
  }
  function subHit(freq=58, dur=.5, vol=.24, slide=30, bus=null, panVal=0){
    ping(freq, dur, 'sawtooth', vol, slide, bus, panVal);
    ping(freq * 0.5, dur * 0.9, 'sine', vol * 0.35, Math.max(18, slide * 0.55), bus, panVal);
  }
  function ritualChord(root=55, dur=2.2, vol=.055, bus=null, panVal=0){
    if(!ctx || muted) return;
    const now = ctx.currentTime;
    const out = bus || musicBus;
    const ratios = [1, 1.189207, 1.498307, 2];
    ratios.forEach((ratio, i)=>{
      const o = ctx.createOscillator();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = i === 0 ? 'sawtooth' : 'triangle';
      o.frequency.setValueAtTime(root * ratio * (1 + (Math.random()-0.5)*0.006), now);
      f.type = 'lowpass';
      f.frequency.value = 240 + i * 95;
      f.Q.value = 0.8;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(vol / (i + 1.4), now + 0.18 + i * 0.035);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(f); f.connect(g);
      if(panVal){
        const pn = ctx.createStereoPanner(); pn.pan.value = panVal;
        g.connect(pn); pn.connect(out); pn.connect(reverbSend);
      } else {
        g.connect(out); g.connect(reverbSend);
      }
      o.start(now); o.stop(now + dur + 0.05);
    });
  }
  function playBuf(name, {vol=1, panVal=0, rate=1, bus=null, lpHz=null, loop=false, startAt=null}={}){
    if(!ctx || muted || !buffers[name]) return null;
    const src = ctx.createBufferSource();
    src.buffer = buffers[name]; src.loop = loop; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = vol;
    let chain = src;
    if(lpHz){
      const f = ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value = lpHz; f.Q.value=0.5;
      chain.connect(f); chain = f;
    }
    chain.connect(g);
    const out = bus || sfxBus;
    if(panVal){
      const pn = ctx.createStereoPanner(); pn.pan.value = panVal;
      g.connect(pn); pn.connect(out);
    } else {
      g.connect(out);
    }
    src.start(startAt ?? ctx.currentTime);
    return { src, gain: g };
  }
  function gate(id){
    if(!ctx) return false;
    const now = ctx.currentTime, cd = cooldowns[id]||0;
    if(now - (lastPlayed[id]||0) < cd) return false;
    lastPlayed[id] = now; return true;
  }

  function shoot(x){ if(!gate('shoot')) return;
    const pv = pan(x);
    if(buffers.sfx_shoot){
      playBuf('sfx_shoot', { vol: 0.18, panVal: pv, rate: 0.92 + Math.random()*0.16, lpHz: 6500 });
      return;
    }
    const pitch = 1 + (Math.random()-0.5)*0.07;
    ping(180*pitch, 0.08, 'sawtooth', 0.09, 74*pitch, null, pv);
  }
  function hit(x){ if(!gate('hit')) return;
    const pv = pan(x);
    if(buffers.sfx_hit){
      playBuf('sfx_hit', { vol: 0.16, panVal: pv, rate: 0.92 + Math.random()*0.13, lpHz: 5200 });
      return;
    }
    subHit(118*(1+(Math.random()-0.5)*0.14), 0.12, 0.17, 48, null, pv);
  }
  function explode(x,y){
    const pv = pan(x);
    duck(-8, 0.018, 0.16, 0.58);
    if(buffers.sfx_explosion) playBuf('sfx_explosion', { vol: 0.54, panVal: pv*0.8, rate: 0.96 + Math.random()*0.08, lpHz: Math.min(6200, distLP(x,y)) });
    else {
      noise(0.42, 0.3, 50, Math.min(1050, distLP(x,y)), null, pv);
      subHit(62*(1+(Math.random()-0.5)*0.12), 0.42, 0.27, 24, null, pv);
    }
  }
  function pickup(x, opts={}){ if(!gate('pickup')) return;
    const pv = pan(x);
    const vol = opts.vol ?? 0.22;
    if(buffers.sfx_pickup){
      playBuf('sfx_pickup', { vol, panVal: pv, rate: 0.96 + Math.random()*0.1, lpHz: opts.lpHz ?? 7200 });
      return;
    }
    darkBell(360 + Math.random()*42, 0.24, Math.min(0.085, vol * 0.4), null, pv);
  }
  function level(){
    duck(-11, 0.035, 0.24, 0.86);
    if(buffers.sfx_levelup) playBuf('sfx_levelup', { vol: 0.56, rate: 1.0, lpHz: 7200 });
    else {
      ritualChord(73.42, 1.45, 0.085, sfxBus);
      darkBell(293.66, 0.72, 0.17);
      setTimeout(()=>darkBell(440, 0.85, 0.14), 120);
    }
  }
  function boss(){
    duck(-13, 0.05, 0.42, 1.4);
    if(buffers.sfx_bosslaser) playBuf('sfx_bosslaser', { vol: 0.48, rate: 0.92, lpHz: 5200 });
    else {
      subHit(48, 0.95, 0.38, 22);
      ritualChord(36.71, 1.8, 0.1, sfxBus);
      noise(0.75, 0.28, 55, 760);
    }
  }
  function damage(){
    duck(-5, 0.018, 0.1, 0.32);
    if(buffers.sfx_damage){
      playBuf('sfx_damage', { vol: 0.22, rate: 0.94 + Math.random()*0.08, lpHz: 5200 });
      return;
    }
    subHit(92, 0.18, 0.23, 36);
  }
  function heal(){
    if(buffers.sfx_heal) playBuf('sfx_heal', { vol: 0.3, rate: 1.0, lpHz: 7600 });
    else if(buffers.sfx_shield) playBuf('sfx_shield', { vol: 0.22, rate: 1.0, lpHz: 3600 });
    else {
      ritualChord(82.41, 0.9, 0.045, sfxBus);
      darkBell(246.94, 0.45, 0.12);
    }
  }
  function freeze(){
    if(buffers.sfx_freeze) playBuf('sfx_freeze', { vol: 0.26, rate: 0.94, lpHz: 7200 });
    else if(buffers.sfx_shield) playBuf('sfx_shield', { vol: 0.26, rate: 0.92, lpHz: 3200 });
    else darkBell(523.25, 0.55, 0.09);
  }
  function laser(x){ if(!gate('laser')) return;
    const pv = pan(x);
    if(buffers.sfx_laser){
      playBuf('sfx_laser', { vol: 0.1, panVal: pv, rate: 0.98 + Math.random()*0.08, lpHz: 6800 });
      return;
    }
    ping(210, 0.055, 'sawtooth', 0.055, 118, null, pv);
  }
  function blip(){ if(!gate('blip')) return;
    if(buffers.sfx_blip) playBuf('sfx_blip', { vol: 0.22, bus: uiBus, lpHz: 6500 });
    else darkBell(520, 0.08, 0.045, uiBus);
  }
  function uiClick(){
    if(buffers.sfx_ui) playBuf('sfx_ui', { vol: 0.32, rate: 1.0, lpHz: 6800, bus: uiBus });
    else darkBell(430, 0.08, 0.055, uiBus);
  }

  function startLayer(key, { vol=1, loop=true, fade=1.2, startAt=null, rate=1, lpHz=2600 } = {}){
    if(!buffers[key]) return null;
    const h = playBuf(key, { vol: 0, loop, bus: musicBus, startAt, rate, lpHz });
    if(!h) return null;
    const t = ctx.currentTime;
    h.gain.gain.setValueAtTime(0, t);
    h.gain.gain.linearRampToValueAtTime(vol, t + fade);
    h.target = vol;
    layers[key] = h;
    return h;
  }
  function fadeLayer(key, target, fade=1.0){
    const h = layers[key]; if(!h) return;
    const t = ctx.currentTime;
    h.gain.gain.cancelScheduledValues(t);
    h.gain.gain.setValueAtTime(h.gain.gain.value, t);
    h.gain.gain.linearRampToValueAtTime(target, t + fade);
    h.target = target;
  }
  function stopLayer(key, fade=1.0){
    const h = layers[key]; if(!h) return;
    const t = ctx.currentTime;
    h.gain.gain.cancelScheduledValues(t);
    h.gain.gain.setValueAtTime(h.gain.gain.value, t);
    h.gain.gain.linearRampToValueAtTime(0, t + fade);
    const stopAt = t + fade + 0.05;
    try { h.src.stop(stopAt); } catch(e) {}
    delete layers[key];
  }
  function stopAllLayers(fade=1.0){ for(const k of Object.keys(layers)) stopLayer(k, fade); }

  let arpTimer = 0, arpStep = 0;
  const ritualRoots = [55, 55, 41.2, 49, 55, 65.41, 46.25, 36.71];
  function arpTick(){
    // Gameplay music now uses only the licensed OpenGameArt BGM files above.
    // Keep this legacy generator available for non-loop stingers/fallbacks only.
    return;
    if(!ctx || muted) return;
    if(mode !== 'main' && mode !== 'boss') return;
    if(mode === 'main' && intensity < 0.18) return;
    const now = ctx.currentTime;
    if(now < arpTimer) return;
    const bossMode = mode === 'boss';
    const step = bossMode ? 1.12 : Math.max(1.05, 1.85 - intensity * 0.62);
    const root = ritualRoots[arpStep % ritualRoots.length] * (bossMode ? 0.73 : 1);
    const side = (arpStep % 2) ? -0.24 : 0.24;
    arpStep++;
    ritualChord(root, bossMode ? 2.25 : 2.7, (bossMode ? 0.07 : 0.035) + intensity * 0.045, musicBus, side);
    if(bossMode || intensity > 0.48){
      darkBell(root * (bossMode ? 5.34 : 4), bossMode ? 1.0 : 0.8, 0.035 + intensity * 0.04, musicBus, -side);
    }
    if((arpStep % (bossMode ? 3 : 5)) === 0){
      noise(bossMode ? 0.36 : 0.28, bossMode ? 0.055 : 0.035, 70, bossMode ? 720 : 520, ambientBus, side * 0.5);
    }
    arpTimer = now + step;
  }

  function setMode(newMode){
    if(!ready || !ctx) return;
    if(newMode === mode) return;
    const prev = mode; mode = newMode;
    if(newMode === 'menu'){
      stopAllLayers(0.8);
      startLayer('menu', { vol: 0.78, fade: 1.8, rate: 1.0, lpHz: 9000 });
    } else if(newMode === 'main'){
      stopAllLayers(0.8);
      const available = mainPlaylist.filter(k => buffers[k]);
      const key = available.length ? available[mainPlaylistIndex % available.length] : 'main_low';
      mainPlaylistIndex++;
      startLayer(key, { vol: key === 'main_low' ? 0.78 : 0.74, fade: 1.8, rate: 1.0, lpHz: key === 'main_low' ? 8200 : 9000 });
    } else if(newMode === 'boss'){
      duck(-16, 0.08, 0.25, 1.0);
      stopAllLayers(0.6);
      setTimeout(()=>{ if(mode === 'boss') startLayer('boss', { vol: 0.84, fade: 1.4, rate: 1.0, lpHz: 9000 }); }, 550);
    } else if(newMode === 'victory'){
      stopAllLayers(0.4);
      setTimeout(()=>{
        ritualChord(65.41, 1.6, 0.09, musicBus);
        const notes = [220, 261.63, 329.63, 440, 523.25];
        notes.forEach((n,i)=> setTimeout(()=>{
          darkBell(n, 0.48 + i*0.06, 0.12, musicBus);
        }, i*170));
      }, 400);
    } else if(newMode === 'death'){
      stopAllLayers(2.2);
      subHit(73.42, 1.6, 0.3, 24, musicBus);
      noise(1.6, 0.16, 40, 360, musicBus);
    } else if(newMode === 'none'){
      stopAllLayers(0.6);
    }
  }

  function setIntensity(x){ targetIntensity = Math.max(0, Math.min(1, x||0)); }

  function tick(){
    if(!ctx || !ready) return;
    intensity += (targetIntensity - intensity) * 0.04;
    arpTick();
  }

  function setMuted(m){ muted = m; if(master) master.gain.value = m ? 0 : 0.9; }
  function isMuted(){ return muted; }
  function isReady(){ return ready; }
  function start(){ if(mode==='none' || mode==='menu') setMode('main'); }
  function stop(){ setMode('none'); }

  const API = {
    init, start, stop, tick,
    setMuted, isMuted, isReady, setMode, setIntensity, setCamera,
    shoot, hit, explode, pickup, level, boss, damage, heal, freeze, laser, blip,
    uiClick, ping, noise
  };
  return API;
})();
