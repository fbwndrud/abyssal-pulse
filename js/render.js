/* ===================================================================
   RENDER PRIMITIVES + BACKGROUND
   - Sprite cache: bake stroked shapes with shadowBlur once, blit via drawImage.
   - withDrawCtx: redirect blit target so HUD/levelup icons can use the same primitives.
   - BG: animated grid + parallax stars + nebula tint, with gradient/star pre-bake.
   =================================================================== */
import { TAU, W, H, C, ctx, choice, hsl, G, worldToScreen } from './core.js';

const SPRITE_CACHE = new Map();
// Bumped from 384 → 1024 to reduce eviction churn. Eviction creates GC pressure
// (Map.delete + canvas element churn) which manifests as stutters mid-run.
const SPRITE_CACHE_LIMIT = 1024;
let _drawCtx = ctx;
export function withDrawCtx(target, fn){
  const prev = _drawCtx;
  _drawCtx = target;
  try { fn(); }
  finally { _drawCtx = prev; }
}
function _spriteBake(key, wh, bake){
  let s = SPRITE_CACHE.get(key);
  if(s) return s;
  if(SPRITE_CACHE.size >= SPRITE_CACHE_LIMIT){
    let n = SPRITE_CACHE_LIMIT >> 2;
    for(const k of SPRITE_CACHE.keys()){ SPRITE_CACHE.delete(k); if(--n <= 0) break; }
  }
  const c = document.createElement('canvas');
  c.width = wh; c.height = wh;
  const x = c.getContext('2d');
  x.translate(wh/2, wh/2);
  bake(x);
  SPRITE_CACHE.set(key, c);
  return c;
}

export function drawPolygon(x, y, sides, radius, rot=0, color='#fff', glow=12, fill=null, lineWidth=2){
  // Round non-discrete params to integers in the cache key so item-pulse / fx
  // animations don't thrash the sprite cache (continuous radius → constant misses
  // → canvas element churn → GC stutter). Visual rounding is imperceptible.
  const ri = radius|0;
  const pad = Math.ceil(glow + lineWidth + 2);
  const wh = Math.ceil(ri*2 + pad*2);
  const key = `P|${sides}|${ri}|${color}|${glow|0}|${fill||''}|${lineWidth|0}`;
  const spr = _spriteBake(key, wh, (c)=>{
    c.beginPath();
    for(let i=0;i<sides;i++){
      const a = (i/sides)*TAU - Math.PI/2;
      const px = Math.cos(a)*ri, py = Math.sin(a)*ri;
      if(i===0) c.moveTo(px,py); else c.lineTo(px,py);
    }
    c.closePath();
    if(fill){ c.fillStyle = fill; c.fill(); }
    c.strokeStyle = color; c.lineWidth = lineWidth;
    c.shadowBlur = glow; c.shadowColor = color;
    c.stroke();
  });
  const dc = _drawCtx;
  if(rot){
    dc.save();
    dc.translate(x, y); dc.rotate(rot);
    dc.drawImage(spr, -wh/2, -wh/2);
    dc.restore();
  } else {
    dc.drawImage(spr, x - wh/2, y - wh/2);
  }
}
export function drawStar(x, y, points, radiusO, radiusI, rot=0, color='#fff', glow=12, fill=null, lineWidth=2){
  const ro = radiusO|0, ri = radiusI|0;
  const pad = Math.ceil(glow + lineWidth + 2);
  const wh = Math.ceil(ro*2 + pad*2);
  const key = `S|${points}|${ro}|${ri}|${color}|${glow|0}|${fill||''}|${lineWidth|0}`;
  const spr = _spriteBake(key, wh, (c)=>{
    c.beginPath();
    for(let i=0;i<points*2;i++){
      const a = (i/(points*2))*TAU - Math.PI/2;
      const r = (i%2===0) ? ro : ri;
      const px = Math.cos(a)*r, py = Math.sin(a)*r;
      if(i===0) c.moveTo(px,py); else c.lineTo(px,py);
    }
    c.closePath();
    if(fill){ c.fillStyle = fill; c.fill(); }
    c.strokeStyle = color; c.lineWidth = lineWidth;
    c.shadowBlur = glow; c.shadowColor = color;
    c.stroke();
  });
  const dc = _drawCtx;
  if(rot){
    dc.save();
    dc.translate(x, y); dc.rotate(rot);
    dc.drawImage(spr, -wh/2, -wh/2);
    dc.restore();
  } else {
    dc.drawImage(spr, x - wh/2, y - wh/2);
  }
}
export function drawCircle(x, y, r, color='#fff', glow=14, fill=null, lineWidth=2){
  const ri = r|0;
  const pad = Math.ceil(glow + lineWidth + 2);
  const wh = Math.ceil(ri*2 + pad*2);
  const key = `C|${ri}|${color}|${glow|0}|${fill||''}|${lineWidth|0}`;
  const spr = _spriteBake(key, wh, (c)=>{
    c.beginPath(); c.arc(0,0, ri, 0, TAU);
    if(fill){ c.fillStyle = fill; c.fill(); }
    c.strokeStyle = color; c.lineWidth = lineWidth;
    c.shadowBlur = glow; c.shadowColor = color;
    c.stroke();
  });
  const dc = _drawCtx;
  dc.drawImage(spr, x - wh/2, y - wh/2);
  dc.shadowBlur = 0;
}
export function drawDiamond(x, y, r, rot=0, color='#fff', glow=12, fill=null){
  drawPolygon(x, y, 4, r, rot + Math.PI/4, color, glow, fill);
}

/* ===================================================================
   BACKGROUND
   =================================================================== */
export const BG = {
  stars: [],
  starLayerW: 0,
  starLayerH: 0,
  starLayer: null,
  gradCanvas: null,
  gradHue: -999,
  init(){
    this.stars = [];
    for(let i=0;i<140;i++){
      this.stars.push({x:Math.random()*W*3-W, y:Math.random()*H*3-H, r:Math.random()*1.5+.3, p:Math.random()*.6+.4, c:choice([C.cyan,C.magenta,C.violet,C.lime,C.gold])});
    }
    const sw = Math.floor(W*1.5), sh = Math.floor(H*1.5);
    this.starLayerW = sw; this.starLayerH = sh;
    const sc = document.createElement('canvas');
    sc.width = sw; sc.height = sh;
    const sx2 = sc.getContext('2d');
    for(const s of this.stars){
      const px = ((s.x % sw) + sw) % sw;
      const py = ((s.y % sh) + sh) % sh;
      sx2.globalAlpha = s.p;
      sx2.fillStyle = s.c;
      sx2.beginPath(); sx2.arc(px, py, s.r, 0, TAU); sx2.fill();
      sx2.globalAlpha = s.p * 0.25;
      sx2.beginPath(); sx2.arc(px, py, s.r * 2.2, 0, TAU); sx2.fill();
    }
    sx2.globalAlpha = 1;
    this.starLayer = sc;
    const gc = document.createElement('canvas');
    gc.width = W; gc.height = H;
    this.gradCanvas = gc;
  },
  bakeGradient(hue){
    const gc = this.gradCanvas, gx = gc.getContext('2d');
    const g = gx.createRadialGradient(W/2, H/2+100, 0, W/2, H/2, 800);
    g.addColorStop(0, `hsla(${hue} 55% 12% / 1)`);
    g.addColorStop(.5, `hsla(${(hue+50)%360} 35% 6% / 1)`);
    g.addColorStop(1, '#04050b');
    gx.fillStyle = g; gx.fillRect(0,0,W,H);
    this.gradHue = hue;
  },
  draw(){
    const hue = (G.bgT*8) % 360;
    let dh = Math.abs(hue - this.gradHue);
    if(dh > 180) dh = 360 - dh;
    if(this.gradHue === -999 || dh > 8) this.bakeGradient(hue);
    ctx.drawImage(this.gradCanvas, 0, 0);

    const sw = this.starLayerW, sh = this.starLayerH;
    const cx = ((G.cam.x*.05) % sw + sw) % sw;
    const cy = ((G.cam.y*.05) % sh + sh) % sh;
    ctx.globalAlpha = .78 + .22*Math.sin(G.bgT*1.6);
    ctx.drawImage(this.starLayer, -cx, -cy);
    if(cx > 0)           ctx.drawImage(this.starLayer, sw - cx, -cy);
    if(cy > 0)           ctx.drawImage(this.starLayer, -cx, sh - cy);
    if(cx > 0 && cy > 0) ctx.drawImage(this.starLayer, sw - cx, sh - cy);
    ctx.globalAlpha = 1;

    const grid = 64;
    const ox = -((G.cam.x % grid) + grid) % grid;
    const oy = -((G.cam.y % grid) + grid) % grid;
    ctx.strokeStyle = 'rgba(60,120,220,.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for(let x = ox; x < W; x += grid){ ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for(let y = oy; y < H; y += grid){ ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    if(G.player){
      const ps = worldToScreen(G.player.x, G.player.y);
      const rg = ctx.createRadialGradient(ps.x, ps.y, 30, ps.x, ps.y, 380);
      rg.addColorStop(0, 'rgba(0,240,255,.18)');
      rg.addColorStop(1, 'rgba(0,240,255,0)');
      ctx.fillStyle = rg; ctx.fillRect(0,0,W,H);
    }
  }
};
BG.init();
