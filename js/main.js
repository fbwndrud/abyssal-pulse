/* ===================================================================
   MAIN — entry. Wires the loop, registers input + lifecycle handlers,
   and exposes the small set of inline-onclick globals used in index.html.
   =================================================================== */
import {
  G, keys, mouse, touchMove, canvas, W, H, fmtTime, meta,
  flushMetaIfNeeded, flushMetaNow, initPixi,
  app, world, bgC, entityLayer, fxLayer, beamLayer, hudC,
} from './core.js';
import { BG, preloadSpriteAssets } from './render.js';
import { AUDIO } from './audio.js?v=abyssal-audio-v4';
import { update, render, setLoopHandlers } from './gameloop.js';
import {
  doLevelUp, endRun, updateHUD, openChestPick, openGlyphPick, openShrinePick,
  showMenu, togglePause, toggleMute,
  openClassPicker, openShop, openCodex,
  openSettings, toggleSetting, setCodexTab, toggleGuide,
  openChipset, chipsetPull, chipsetBuySlot,
  rerollLevelup, skipLevelup, returnToMenu, restartRun,
  confirmAbandon, cancelAbandon, abandonRun, closeOverlay,
} from './ui.js';
import { spawnBoss, killEnemy, spawnShrine } from './entities.js';

const DEBUG = new URLSearchParams(location.search).has('debug');
document.body.classList.toggle('debug-mode', DEBUG);

// Wire gameloop.js → ui.js handlers (avoids hard cycle at module level)
setLoopHandlers({ doLevelUp, endRun, updateHUD, openChestPick, openShrinePick });

/* ───────── DEV ERROR OVERLAY ─────────
   Surfaces uncaught errors as a visible banner so we can debug without devtools. */
if(DEBUG) (()=>{
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
function updatePointerPosition(clientX, clientY){
  const r = canvas.getBoundingClientRect();
  mouse.x = (clientX - r.left) * (W / r.width);
  mouse.y = (clientY - r.top) * (H / r.height);
}
canvas.addEventListener('mousemove', e=> updatePointerPosition(e.clientX, e.clientY));
canvas.addEventListener('mousedown', ()=> mouse.down = true);
canvas.addEventListener('mouseup', ()=> mouse.down = false);

let touchPointerId = null;
let touchOriginX = 0, touchOriginY = 0;
function resetTouchMove(){
  touchPointerId = null;
  touchMove.active = false;
  touchMove.x = 0;
  touchMove.y = 0;
  touchMove.strength = 0;
}
function updateTouchMove(clientX, clientY){
  updatePointerPosition(clientX, clientY);
  const dx = clientX - touchOriginX;
  const dy = clientY - touchOriginY;
  const mag = Math.hypot(dx, dy);
  const dead = 14;
  const maxRadius = 112;
  touchMove.active = true;
  if(mag <= dead){
    touchMove.x = 0;
    touchMove.y = 0;
    touchMove.strength = 0;
    return;
  }
  const raw = Math.min(1, (mag - dead) / (maxRadius - dead));
  const strength = Math.pow(raw, .72);
  touchMove.x = (dx / mag) * strength;
  touchMove.y = (dy / mag) * strength;
  touchMove.strength = strength;
}
canvas.addEventListener('pointerdown', e=>{
  if(e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
  if(touchPointerId !== null || G.mode !== 'play') return;
  e.preventDefault();
  touchPointerId = e.pointerId;
  touchOriginX = e.clientX;
  touchOriginY = e.clientY;
  try { canvas.setPointerCapture?.(e.pointerId); } catch(e) {}
  updateTouchMove(e.clientX, e.clientY);
}, { passive:false });
canvas.addEventListener('pointermove', e=>{
  if(touchPointerId !== e.pointerId) return;
  e.preventDefault();
  updateTouchMove(e.clientX, e.clientY);
}, { passive:false });
const endTouchMove = e=>{
  if(touchPointerId !== e.pointerId) return;
  e.preventDefault();
  resetTouchMove();
};
canvas.addEventListener('pointerup', endTouchMove, { passive:false });
canvas.addEventListener('pointercancel', endTouchMove, { passive:false });
canvas.addEventListener('lostpointercapture', resetTouchMove);
addEventListener('blur', ()=>{ for(const k in keys) keys[k] = false; mouse.down = false; resetTouchMove(); });

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
    if(meta.settings?.autoQuality){
      if(fps < 38 && G.qualityScale > .58){ G.qualityScale = .55; G.qualityLabel = '낮음'; }
      else if(fps > 55 && G.qualityScale < 1){ G.qualityScale = 1; G.qualityLabel = '높음'; }
    } else {
      G.qualityScale = 1; G.qualityLabel = '높음';
    }
    if(_fpsEl){
      _fpsEl.textContent = `FPS ${fps.toFixed(0)} · 개체 ${G.ents.length} · ${G.qualityLabel}`;
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
addEventListener('click', e=>{
  if(e.target.closest?.('.btn,.icon-btn,.card,.shop-card,#chipset-overlay .chip,.codex-tab,.setting-card')){
    AUDIO.uiClick?.();
  }
}, true);

await initPixi();
await preloadSpriteAssets();
requestAnimationFrame(t=>{ lastT = t; requestAnimationFrame(loop); });
document.body.classList.add('booted');
showMenu();

// Dev-mode handles for in-browser inspection (browser automation, REPL).
// Same module instances the page uses; safe to read via window.__dev.
if(DEBUG) window.__dev = { G, app, world, bgC, entityLayer, fxLayer, beamLayer, hudC, BG, spawnBoss, killEnemy, openGlyphPick, openShrinePick, spawnShrine, update, render };
document.getElementById('menu-coins').textContent = meta.coins;
document.getElementById('menu-best').textContent = fmtTime(meta.bestTime);
document.getElementById('menu-runs').textContent = meta.runs;

/* ───────── INLINE-ONCLICK GLOBALS ─────────
   The HTML uses inline onclick handlers (e.g. `onclick="openClassPicker()"`)
   which can only see globals on `window`. ES module scope is private, so we
   explicitly attach the handler set used by the overlays. */
Object.assign(window, {
  openClassPicker, openShop, openCodex,
  openSettings, toggleSetting, setCodexTab, toggleGuide,
  openChipset, chipsetPull, chipsetBuySlot,
  rerollLevelup, skipLevelup,
  returnToMenu, restartRun,
  togglePause, toggleMute, confirmAbandon, cancelAbandon, abandonRun,
  closeOverlay, showMenu,
});
const pendingInlineActions = window.__pendingInlineActions || [];
window.__pendingInlineActions = null;
for(const action of pendingInlineActions){
  const fn = window[action.name];
  if(typeof fn === 'function') fn(...(action.args || []));
}
