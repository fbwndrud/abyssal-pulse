/* ===================================================================
   MAIN — entry. Wires the loop, registers input + lifecycle handlers,
   and exposes the small set of inline-onclick globals used in index.html.
   =================================================================== */
import {
  G, keys, mouse, canvas, W, H, fmtTime, meta,
  flushMetaIfNeeded, flushMetaNow, initPixi,
  app, world, bgC, entityLayer, fxLayer, beamLayer, hudC,
} from './core.js';
import { BG } from './render.js';
import { AUDIO } from './audio.js';
import { update, render, setLoopHandlers } from './gameloop.js';
import {
  doLevelUp, endRun, updateHUD, openChestPick, openGlyphPick, openShrinePick,
  showMenu, togglePause, toggleMute,
  openClassPicker, openShop, openCodex,
  openChipset, chipsetPull, chipsetBuySlot,
  rerollLevelup, skipLevelup, returnToMenu, restartRun,
  confirmAbandon, closeOverlay,
} from './ui.js';
import { spawnBoss, killEnemy, spawnShrine } from './entities.js';

// Wire gameloop.js → ui.js handlers (avoids hard cycle at module level)
setLoopHandlers({ doLevelUp, endRun, updateHUD, openChestPick, openShrinePick });

/* ───────── DEV ERROR OVERLAY ─────────
   Surfaces uncaught errors as a visible banner so we can debug without devtools. */
(()=>{
  const banner = document.createElement('div');
  banner.style.cssText = 'position:absolute;top:60px;left:14px;right:14px;max-height:50vh;overflow:auto;background:rgba(180,30,40,.92);color:#fff;font:11px/1.5 monospace;padding:8px 12px;border-radius:6px;z-index:200;display:none;white-space:pre-wrap;pointer-events:auto';
  banner.id = 'err-overlay';
  document.body.appendChild(banner);
  function show(msg){
    banner.style.display = 'block';
    banner.textContent = (banner.textContent ? banner.textContent + '\n──\n' : '') + msg;
  }
  window.addEventListener('error', ev => {
    show('[error] ' + (ev.error?.stack || ev.message || ev));
  });
  window.addEventListener('unhandledrejection', ev => {
    show('[promise] ' + (ev.reason?.stack || ev.reason || ev));
  });
})();

/* ───────── INPUT WIRING ───────── */
addEventListener('keydown', e=>{
  const k = e.key.toLowerCase();
  if(k===' '){ e.preventDefault(); togglePause(); }
  if(k==='m'){ toggleMute(); }
  keys[k] = true;
  if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)) e.preventDefault();
});
addEventListener('keyup', e=>{ keys[e.key.toLowerCase()] = false; });
canvas.addEventListener('mousemove', e=>{
  const r = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) * (W / r.width);
  mouse.y = (e.clientY - r.top) * (H / r.height);
});
canvas.addEventListener('mousedown', ()=> mouse.down = true);
canvas.addEventListener('mouseup', ()=> mouse.down = false);
addEventListener('blur', ()=>{ for(const k in keys) keys[k] = false; mouse.down = false; });

/* ───────── MAIN LOOP ───────── */
let lastT = 0;
let _loopErrCount = 0;
// FPS counter — smoothed over .5s window. Color-coded in HUD: green ≥55, yellow 30-55, red <30.
let _fpsAccum = 0, _fpsFrames = 0;
const _fpsEl = document.getElementById('fps-chip');
function _updateFps(dt){
  _fpsAccum += dt; _fpsFrames++;
  if(_fpsAccum >= 0.5){
    const fps = _fpsFrames / _fpsAccum;
    if(_fpsEl){
      _fpsEl.textContent = `FPS ${fps.toFixed(0)} · ENT ${G.ents.length}`;
      const col = fps >= 55 ? '#9eff5b' : (fps >= 30 ? '#ffd400' : '#ff4561');
      _fpsEl.style.color = col;
      _fpsEl.style.borderColor = col;
    }
    _fpsAccum = 0; _fpsFrames = 0;
  }
}
function loop(now){
  try {
    G.realT = now / 1000;
    const dt = Math.min(.066, (now - lastT) / 1000);
    lastT = now;
    G.bgT += dt;
    _updateFps(dt);
    if(G.mode === 'play'){
      if(G.hitstop > 0){
        G.hitstop -= dt;
      } else {
        G.dt = dt;
        G.t += dt;
        try { update(); }
        catch(err){ _loopErrCount++; if(_loopErrCount < 200) console.error('[update]', err); }
      }
    }
    try { render(); }
    catch(err){ _loopErrCount++; if(_loopErrCount < 200) console.error('[render]', err); }
    flushMetaIfNeeded();
  } catch(err){
    _loopErrCount++;
    if(_loopErrCount < 200) console.error('[loop]', err);
  }
  requestAnimationFrame(loop);
}
addEventListener('beforeunload', ()=> flushMetaNow());
addEventListener('visibilitychange', ()=>{ if(document.hidden) flushMetaNow(); });

/* ───────── BOOTSTRAP ─────────
   Audio context needs a user gesture; bootstrap lazily on first interaction.
   PIXI must finish .init() (async) before the render loop starts so that
   app.renderer is defined when render() runs. */
addEventListener('pointerdown', ()=>{ AUDIO.init().then(()=>{ if(G.mode==='menu') AUDIO.setMode('menu'); }); }, { once:true });
addEventListener('keydown',     ()=>{ AUDIO.init().then(()=>{ if(G.mode==='menu') AUDIO.setMode('menu'); }); }, { once:true });

await initPixi();
requestAnimationFrame(t=>{ lastT = t; requestAnimationFrame(loop); });
showMenu();

// Dev-mode handles for in-browser inspection (browser automation, REPL).
// Same module instances the page uses; safe to read via window.__dev.
window.__dev = { G, app, world, bgC, entityLayer, fxLayer, beamLayer, hudC, BG, spawnBoss, killEnemy, openGlyphPick, openShrinePick, spawnShrine, update, render };
document.getElementById('menu-coins').textContent = meta.coins;
document.getElementById('menu-best').textContent = fmtTime(meta.bestTime);
document.getElementById('menu-runs').textContent = meta.runs;

/* ───────── INLINE-ONCLICK GLOBALS ─────────
   The HTML uses inline onclick handlers (e.g. `onclick="openClassPicker()"`)
   which can only see globals on `window`. ES module scope is private, so we
   explicitly attach the handler set used by the overlays. */
Object.assign(window, {
  openClassPicker, openShop, openCodex,
  openChipset, chipsetPull, chipsetBuySlot,
  rerollLevelup, skipLevelup,
  returnToMenu, restartRun,
  togglePause, confirmAbandon,
  closeOverlay, showMenu,
});
