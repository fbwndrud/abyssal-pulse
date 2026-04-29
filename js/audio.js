/* ===================================================================
   AUDIO — Dark-synthwave mix bus system with ducking, procedural
   reverb, voice pool, vertical (intensity overlay) + horizontal
   (mode crossfade) music. CC0 assets in ./audio/.
   Self-contained — exports a single AUDIO API object.
   =================================================================== */
export const AUDIO = (()=>{
  // ---- State ----
  let ctx = null, ready = false, muted = false;
  let mode = 'none';
  let intensity = 0, targetIntensity = 0;
  let bossWasActive = false;
  // ---- Graph ----
  let master, preMaster, glueComp, limiter, dcBlock;
  let musicBus, sfxBus, uiBus, ambientBus;
  let convolver, reverbSend, reverbGain;
  // ---- Samples ----
  const ASSETS = {
    menu:          'audio/menu.ogg',
    main_low:      'audio/main_low.ogg',
    main_high:     'audio/main_high.ogg',
    boss:          'audio/boss.ogg',
    sfx_explosion: 'audio/sfx_explosion.ogg',
    sfx_shield:    'audio/sfx_shield.ogg',
    sfx_ui:        'audio/sfx_ui.ogg',
    sfx_levelup:   'audio/sfx_levelup.ogg',
    sfx_bosslaser: 'audio/sfx_bosslaser.ogg'
  };
  const buffers = {};
  const cooldowns = { shoot:0.022, hit:0.018, pickup:0.04, laser:0.025, blip:0.035 };
  const lastPlayed = {};
  let camX = 0, camY = 0, screenW = 1280;
  const layers = {};
  let mainAltUsesHigh = false;

  function makeIR(duration=2.2, decay=3.2, darkness=0.18){
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
        d[i] = lp * 0.9;
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
    preMaster = ctx.createGain();   preMaster.gain.value = 0.5;
    dcBlock = ctx.createBiquadFilter();
    dcBlock.type = 'highpass'; dcBlock.frequency.value = 22; dcBlock.Q.value = 0.707;
    preMaster.connect(dcBlock); dcBlock.connect(glueComp); glueComp.connect(limiter);
    limiter.connect(master); master.connect(ctx.destination);

    musicBus   = ctx.createGain(); musicBus.gain.value   = 0.62;
    sfxBus     = ctx.createGain(); sfxBus.gain.value     = 0.95;
    uiBus      = ctx.createGain(); uiBus.gain.value      = 0.85;
    ambientBus = ctx.createGain(); ambientBus.gain.value = 0.7;
    musicBus.connect(preMaster);
    sfxBus.connect(preMaster);
    uiBus.connect(preMaster);
    ambientBus.connect(preMaster);

    const rLP = ctx.createBiquadFilter();
    rLP.type = 'lowpass'; rLP.frequency.value = 3800; rLP.Q.value = 0.6;
    convolver  = ctx.createConvolver(); convolver.buffer = makeIR(2.4, 3.0, 0.18);
    reverbSend = ctx.createGain(); reverbSend.gain.value = 1.0;
    reverbGain = ctx.createGain(); reverbGain.gain.value = 0.28;
    reverbSend.connect(rLP); rLP.connect(convolver);
    convolver.connect(reverbGain); reverbGain.connect(preMaster);
  }

  async function loadBuffers(){
    const entries = Object.entries(ASSETS);
    await Promise.all(entries.map(async ([k,url])=>{
      try{
        const r = await fetch(url);
        if(!r.ok) throw new Error(r.status+' '+url);
        const ab = await r.arrayBuffer();
        buffers[k] = await ctx.decodeAudioData(ab);
      } catch(e){ console.warn('[AUDIO] missing', k, e.message||e); }
    }));
  }

  async function init(){
    if(ctx){ if(ctx.state==='suspended' && ctx.resume) await ctx.resume(); return ready; }
    try{
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      buildGraph();
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
          buses(){ return { master, preMaster, musicBus, sfxBus, uiBus, ambientBus, reverbGain }; },
          call: (fn, ...a)=> API[fn] && API[fn](...a),
        };
      }
    } catch(e){ console.warn('[AUDIO] init failed', e); ready = false; }
    return ready;
  }

  function duck(depthDb=-8, attack=0.03, hold=0.12, release=0.5){
    if(!musicBus) return;
    const target = Math.pow(10, depthDb/20);
    const g = musicBus.gain, now = ctx.currentTime;
    const cur = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.min(cur, 1), now);
    g.linearRampToValueAtTime(Math.min(target, cur), now + attack);
    g.setValueAtTime(Math.min(target, cur), now + attack + hold);
    g.linearRampToValueAtTime(1.0, now + attack + hold + release);
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
    const pv = pan(x), pitch = 1 + (Math.random()-0.5)*0.08;
    ping(880*pitch, 0.06, 'square', 0.11, 1200*pitch, null, pv);
  }
  function hit(x){ if(!gate('hit')) return;
    const pv = pan(x);
    ping(140*(1+(Math.random()-0.5)*0.2), 0.08, 'sawtooth', 0.22, 60, null, pv);
    noise(0.04, 0.1, 300, 4000, null, pv);
  }
  function explode(x,y){
    const pv = pan(x);
    duck(-6, 0.02, 0.1, 0.45);
    noise(0.3, 0.28, 80, Math.min(1600, distLP(x,y)), null, pv);
    ping(80*(1+(Math.random()-0.5)*0.15), 0.25, 'sawtooth', 0.22, 30, null, pv);
    if(buffers.sfx_explosion) playBuf('sfx_explosion', { vol: 0.55, panVal: pv*0.8, rate: 0.9 + Math.random()*0.2, lpHz: distLP(x,y) });
  }
  function pickup(x){ if(!gate('pickup')) return;
    const pv = pan(x);
    ping(1320 + Math.random()*200, 0.07, 'triangle', 0.18, 2400, null, pv);
  }
  function level(){
    duck(-10, 0.03, 0.2, 0.7);
    ping(660, 0.12, 'sine', 0.22, 990);
    setTimeout(()=>ping(990, 0.15, 'sine', 0.22, 1480), 80);
    setTimeout(()=>ping(1480, 0.25, 'sine', 0.22, 2200), 160);
    if(buffers.sfx_levelup) setTimeout(()=>playBuf('sfx_levelup', { vol: 0.45 }), 40);
  }
  function boss(){
    duck(-12, 0.05, 0.35, 1.2);
    ping(80, 0.8, 'sawtooth', 0.4, 50);
    noise(0.6, 0.3, 80, 800);
    if(buffers.sfx_bosslaser) setTimeout(()=>playBuf('sfx_bosslaser', { vol: 0.35, rate: 0.75 }), 180);
  }
  function damage(){
    duck(-4, 0.02, 0.08, 0.28);
    ping(220, 0.15, 'square', 0.3, 80);
    noise(0.1, 0.2, 200, 800);
  }
  function heal(){
    ping(523, 0.1, 'sine', 0.2);
    setTimeout(()=>ping(784, 0.14, 'sine', 0.2), 70);
    if(buffers.sfx_shield) playBuf('sfx_shield', { vol: 0.22 });
  }
  function freeze(){
    if(buffers.sfx_shield) playBuf('sfx_shield', { vol: 0.32, rate: 0.85 });
    ping(1760, 0.25, 'sine', 0.12, 220);
  }
  function laser(x){ if(!gate('laser')) return;
    ping(660, 0.04, 'sawtooth', 0.06, null, null, pan(x));
  }
  function blip(){ if(!gate('blip')) return;
    ping(1200, 0.03, 'square', 0.08);
  }
  function uiClick(){
    if(buffers.sfx_ui) playBuf('sfx_ui', { vol: 0.45, bus: uiBus });
    else ping(1400, 0.04, 'square', 0.08, null, uiBus);
  }

  function startLayer(key, { vol=1, loop=true, fade=1.2, startAt=null } = {}){
    if(!buffers[key]) return null;
    const h = playBuf(key, { vol: 0, loop, bus: musicBus, startAt });
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
  const arpScale = [110, 130.81, 146.83, 164.81, 196, 220, 261.63];
  function arpTick(){
    if(!ctx || muted) return;
    if(mode !== 'main') return;
    if(intensity < 0.35) return;
    const now = ctx.currentTime;
    if(now < arpTimer) return;
    const bpm = 129, beat = 60/bpm, step = beat/2;
    const note = arpScale[arpStep % arpScale.length];
    arpStep++;
    const vol = 0.07 + (intensity-0.35) * 0.13;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = note * 2;
    const f = ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value = 900 + intensity*2400; f.Q.value = 4;
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, now + step*0.9);
    const pn = ctx.createStereoPanner(); pn.pan.value = ((arpStep%2)?-0.3:0.3);
    o.connect(f); f.connect(g); g.connect(pn); pn.connect(musicBus); g.connect(reverbSend);
    o.start(now); o.stop(now + step + 0.05);
    arpTimer = now + step;
  }

  function setMode(newMode){
    if(!ready || !ctx) return;
    if(newMode === mode) return;
    const prev = mode; mode = newMode;
    if(newMode === 'menu'){
      stopAllLayers(0.8);
      startLayer('menu', { vol: 1.25, fade: 1.5 });
    } else if(newMode === 'main'){
      stopAllLayers(0.8);
      const pickHigh = mainAltUsesHigh && buffers.main_high;
      const key = pickHigh ? 'main_high' : 'main_low';
      mainAltUsesHigh = !mainAltUsesHigh;
      startLayer(key, { vol: 0.78, fade: 1.4 });
    } else if(newMode === 'boss'){
      duck(-16, 0.08, 0.25, 1.0);
      stopAllLayers(0.6);
      setTimeout(()=> startLayer('boss', { vol: 0.88, fade: 1.2 }), 550);
    } else if(newMode === 'victory'){
      stopAllLayers(0.4);
      setTimeout(()=>{
        const notes = [523, 659, 784, 1046, 1318];
        notes.forEach((n,i)=> setTimeout(()=>{
          ping(n, 0.35, 'triangle', 0.25, null, musicBus);
          ping(n*2, 0.25, 'sine', 0.08, null, musicBus);
        }, i*130));
      }, 400);
    } else if(newMode === 'death'){
      stopAllLayers(2.2);
      ping(220, 1.5, 'sawtooth', 0.28, 40, musicBus);
      noise(1.4, 0.15, 50, 400, musicBus);
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
