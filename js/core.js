/* ===================================================================
   CORE — constants, math helpers, canvas/input, save/load, game state.
   Imported by every other module. Has no game-logic dependencies.
   =================================================================== */

export const W = 1280, H = 720;
export const WORLD = 16000;
export const TAU = Math.PI * 2;
export const TWO_PI = TAU;
export const RUN_LENGTH_SEC = 15 * 60;
export const SAVE_KEY = 'neonpulse.save.v1';

export const C = {
  cyan:'#00f0ff', magenta:'#ff2bd6', violet:'#9b5cff', lime:'#9eff5b',
  gold:'#ffd400', pink:'#ff71b8', red:'#ff3a5e', teal:'#1de9b6',
  white:'#e9faff', dim:'#5d7290'
};

export const rand   = (a,b)=> a + Math.random()*(b-a);
export const irand  = (a,b)=> Math.floor(rand(a,b+1));
export const choice = arr => arr[Math.floor(Math.random()*arr.length)];
export const clamp  = (v,a,b)=> v<a?a:(v>b?b:v);
export const lerp   = (a,b,t)=> a + (b-a)*t;
export const dist2  = (a,b)=>{ const dx=a.x-b.x, dy=a.y-b.y; return dx*dx+dy*dy; };
export const dist   = (a,b)=> Math.sqrt(dist2(a,b));
export const angTo  = (a,b)=> Math.atan2(b.y-a.y, b.x-a.x);
export const fmtTime= s=>{ s=Math.max(0,s|0); return String((s/60)|0).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); };
export const hsl    = (h,s,l,a)=> a==null ? `hsl(${h} ${s}% ${l}%)` : `hsla(${h} ${s}% ${l}% / ${a})`;
export const pulse  = (t,speed=1)=> .5 + .5*Math.sin(t*speed);

/* ───────── CANVAS / DPR ─────────
   Legacy 2D canvas kept only for HUD card icons (ui.js), which use their
   own per-card <canvas> elements via withDrawCtx. World rendering moved to
   PIXI (see PIXI APP block below). */
export const canvas = document.getElementById('canvas');
export const ctx = canvas.getContext('2d');
export function resizeCanvas(){
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

/* ───────── PIXI APP ─────────
   PIXI is loaded via CDN <script> in index.html, so it's available as a
   global. We expose the Application + container hierarchy here so other
   modules can attach sprites/graphics. initPixi() is called from main.js
   at boot (top-level await). */
export const app = new PIXI.Application();
export const bgC         = new PIXI.Container();  // background — no camera transform
export const world       = new PIXI.Container();  // camera + shake transform applied here
export const entityLayer = new PIXI.Container();  // enemies / player / pickups / projectiles
export const fxLayer     = new PIXI.Container();  // particles / rings / shock / lines / fans / text
export const beamLayer   = new PIXI.Container();  // beams / blackholes (per-frame Graphics redraw)
export const hudC        = new PIXI.Container();  // PIXI-side HUD (currently empty — DOM HUD handles UI)

export async function initPixi(){
  const pixiCanvas = document.createElement('canvas');
  pixiCanvas.id = 'pixi-canvas';
  document.getElementById('shake').appendChild(pixiCanvas);
  await app.init({
    canvas: pixiCanvas,
    width: W,
    height: H,
    backgroundAlpha: 0,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    antialias: true,
  });
  world.addChild(entityLayer, fxLayer, beamLayer);
  app.stage.addChild(bgC, world, hudC);
}

/* ───────── INPUT STATE ─────────
   Input handler wiring lives in main.js (needs refs to togglePause/toggleMute). */
export const keys = {};
export const mouse = {x:W/2, y:H/2, down:false};

/* ───────── SAVE / META ───────── */
export const meta = loadMeta();
function loadMeta(){
  const def = {
    coins: 0, bestTime: 0, runs: 0, wins: 0, kills: 0,
    shop: {hp:0, dmg:0, magnet:0, reroll:0, speed:0, regen:0, start:0, luck:0, armor:0},
    unlocked: ['CIRCLE','TRIANGLE'],
    seenCodex: {weapons:[], passives:[], enemies:[]},
  };
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if(!raw) return def;
    const s = JSON.parse(raw);
    return Object.assign(def, s, {
      shop: Object.assign(def.shop, s.shop || {}),
      unlocked: s.unlocked && s.unlocked.length ? s.unlocked : def.unlocked,
      seenCodex: Object.assign(def.seenCodex, s.seenCodex || {}),
    });
  } catch(e){ return def; }
}
let _metaDirty = false, _metaLastFlush = 0;
export function saveMeta(){
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(meta)); }catch(e){}
  _metaDirty = false;
  _metaLastFlush = performance.now();
}
export function saveMetaLater(){ _metaDirty = true; }
export function flushMetaIfNeeded(){
  if(!_metaDirty) return;
  if(performance.now() - _metaLastFlush < 1000) return;
  saveMeta();
}
export function flushMetaNow(){ if(_metaDirty) saveMeta(); }

/* ───────── GAME STATE ───────── */
export const G = {
  mode: 'menu',
  t: 0, dt: 0, realT: 0,
  shake: 0, hitstop: 0,
  ents: [],
  player: null,
  bgT: 0,
  cam: {x:0, y:0, zoom:1, tx:0, ty:0},
  combo: 0, comboTimer: 0,
  killCount: 0,
  coinsRun: 0,
  spawnTimer: 0,
  bossActive: null,
  bossTimer: 0,
  endReason: null,
  rerollCost: 3,
  classChosen: null,
  weaponPickPool: null,
  paletteShift: 0,
  flash: 0, flashColor: '#fff',
  announce: '',
  announceTimer: 0,
  bannerTimer: 0,
  pickupMagnetMul: 1,
  superMagnetTimer: 0,
  freezeTimer: 0,
};

/* ───────── CAMERA ─────────
   Frame-rate-independent exponential follow. Original code used a fixed
   lerp factor 0.14 which under-shoots when fps drops; raising it to a
   dt-aware exponential keeps the player visually centered at any FPS.
   Initial spawn snap (in player.js) avoids the (0,0)→target ramp-in. */
export function updateCamera(){
  if(!G.player) return;
  G.cam.tx = G.player.x - W/2;
  G.cam.ty = G.player.y - H/2;
  const k = 1 - Math.pow(1 - .14, G.dt * 60);
  G.cam.x = lerp(G.cam.x, G.cam.tx, k);
  G.cam.y = lerp(G.cam.y, G.cam.ty, k);
}
export function worldToScreen(x,y){ return {x:x-G.cam.x, y:y-G.cam.y}; }
export function screenToWorld(x,y){ return {x:x+G.cam.x, y:y+G.cam.y}; }

/* ───────── HUD HELPERS (DOM-side, but tiny — kept here so any module can call) ───────── */
export function setBar(id, pct){ document.getElementById(id).style.width = clamp(pct,0,100) + '%'; }
export function announce(text, time=1.5){
  G.announce = text; G.announceTimer = time;
  const el = document.getElementById('announce');
  el.textContent = text; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), time*1000);
}
