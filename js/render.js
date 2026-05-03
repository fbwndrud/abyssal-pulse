/* ===================================================================
   RENDER PRIMITIVES + BACKGROUND
   - Sprite cache (Canvas 2D): bake stroked shapes with shadowBlur once, blit via drawImage.
     Used only by HUD/levelup card icons (via withDrawCtx).
   - Texture cache (PIXI): bakes the same Canvas 2D sprite, then converts to PIXI.Texture
     once. World rendering uses these textures via acquireSprite() pool.
   - BG: animated grid + parallax stars + nebula tint, with gradient/star pre-bake.
   =================================================================== */
import { TAU, W, H, C, ctx, choice, hsl, G, worldToScreen, bgC } from './core.js';

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
   PIXI TEXTURE BUILDERS
   - Same Canvas 2D bake (incl. shadowBlur) as drawCircle/Polygon/Star/Diamond,
     converted once to PIXI.Texture and cached. Caller acquires a pooled
     Sprite via acquireSprite(key, texture) and adds it to a container.
   =================================================================== */
const TEX_CACHE = new Map();
const TEX_CACHE_LIMIT = 1024;
function _textureFor(key, canvas){
  let t = TEX_CACHE.get(key);
  if(t) return t;
  if(TEX_CACHE.size >= TEX_CACHE_LIMIT){
    let n = TEX_CACHE_LIMIT >> 2;
    for(const [k, tex] of TEX_CACHE){
      tex.destroy(true);
      TEX_CACHE.delete(k);
      if(--n <= 0) break;
    }
  }
  t = PIXI.Texture.from(canvas);
  TEX_CACHE.set(key, t);
  return t;
}

export function getPolygonTexture(sides, radius, color='#fff', glow=12, fill=null, lineWidth=2){
  const ri = radius|0;
  const pad = Math.ceil(glow + lineWidth + 2);
  const wh = Math.ceil(ri*2 + pad*2);
  const key = `P|${sides}|${ri}|${color}|${glow|0}|${fill||''}|${lineWidth|0}`;
  const canvas = _spriteBake(key, wh, (c)=>{
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
  return { texture: _textureFor(key, canvas), key, w: wh, h: wh };
}
export function getStarTexture(points, radiusO, radiusI, color='#fff', glow=12, fill=null, lineWidth=2){
  const ro = radiusO|0, ri = radiusI|0;
  const pad = Math.ceil(glow + lineWidth + 2);
  const wh = Math.ceil(ro*2 + pad*2);
  const key = `S|${points}|${ro}|${ri}|${color}|${glow|0}|${fill||''}|${lineWidth|0}`;
  const canvas = _spriteBake(key, wh, (c)=>{
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
  return { texture: _textureFor(key, canvas), key, w: wh, h: wh };
}
export function getCircleTexture(r, color='#fff', glow=14, fill=null, lineWidth=2){
  const ri = r|0;
  const pad = Math.ceil(glow + lineWidth + 2);
  const wh = Math.ceil(ri*2 + pad*2);
  const key = `C|${ri}|${color}|${glow|0}|${fill||''}|${lineWidth|0}`;
  const canvas = _spriteBake(key, wh, (c)=>{
    c.beginPath(); c.arc(0,0, ri, 0, TAU);
    if(fill){ c.fillStyle = fill; c.fill(); }
    c.strokeStyle = color; c.lineWidth = lineWidth;
    c.shadowBlur = glow; c.shadowColor = color;
    c.stroke();
  });
  return { texture: _textureFor(key, canvas), key, w: wh, h: wh };
}
export function getDiamondTexture(r, color='#fff', glow=12, fill=null){
  return getPolygonTexture(4, r, color, glow, fill, 2);
}

/* ───────── BOSS AURA TEX (large white radial fade, tinted per-boss) ───────── */
let _BOSS_AURA_TEX = null;
export function getBossAuraTexture(){
  if(_BOSS_AURA_TEX) return _BOSS_AURA_TEX;
  const sz = 256;
  const c = document.createElement('canvas'); c.width = sz; c.height = sz;
  const cx = c.getContext('2d');
  const g = cx.createRadialGradient(sz/2, sz/2, sz*.15, sz/2, sz/2, sz/2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(.5, 'rgba(255,255,255,.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = g; cx.fillRect(0, 0, sz, sz);
  _BOSS_AURA_TEX = PIXI.Texture.from(c);
  return _BOSS_AURA_TEX;
}

/* ───────── PARTICLE TEX (white round dot for fxBurst, tinted at runtime) ─────── */
let _PARTICLE_TEX = null;
export function getParticleTexture(){
  if(_PARTICLE_TEX) return _PARTICLE_TEX;
  const sz = 32;
  const c = document.createElement('canvas'); c.width = sz; c.height = sz;
  const cx = c.getContext('2d');
  const g = cx.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(.5, 'rgba(255,255,255,.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = g; cx.fillRect(0, 0, sz, sz);
  _PARTICLE_TEX = PIXI.Texture.from(c);
  return _PARTICLE_TEX;
}

/* ───────── PARTICLE SPRITE POOL ───────── */
const PARTICLE_POOL = [];
export function acquireParticle(){
  if(PARTICLE_POOL.length){
    const p = PARTICLE_POOL.pop();
    p.visible = true;
    p.alpha = 1;
    p.scale.set(1);
    return p;
  }
  const p = new PIXI.Sprite(getParticleTexture());
  p.anchor.set(0.5);
  return p;
}
export function releaseParticle(p){
  if(!p) return;
  if(p.parent) p.parent.removeChild(p);
  p.visible = false;
  if(PARTICLE_POOL.length < 1024) PARTICLE_POOL.push(p);
  else p.destroy();
}

/* ───────── PIXI.Graphics POOL ───────── */
const GFX_POOL = [];
export function acquireGraphics(){
  if(GFX_POOL.length){
    const g = GFX_POOL.pop();
    g.clear();
    g.alpha = 1;
    g.visible = true;
    return g;
  }
  return new PIXI.Graphics();
}
export function releaseGraphics(g){
  if(!g) return;
  if(g.parent) g.parent.removeChild(g);
  g.clear();
  g.visible = false;
  if(GFX_POOL.length < 256) GFX_POOL.push(g);
  else g.destroy();
}

/* ───────── PIXI.Text POOL (damage numbers / floaters) ───────── */
const TEXT_POOL = [];
const TEXT_STYLE_NORM = { fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 14, fontWeight: '700', fill: 0xffffff, align: 'center' };
const TEXT_STYLE_BIG  = { fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 18, fontWeight: '700', fill: 0xffffff, align: 'center' };
export function acquireText(text, color, big){
  let t;
  if(TEXT_POOL.length){
    t = TEXT_POOL.pop();
    t.visible = true;
    t.alpha = 1;
  } else {
    t = new PIXI.Text({ text: '', style: TEXT_STYLE_NORM });
    t.anchor.set(0.5);
  }
  t.text = String(text);
  t.style = big ? TEXT_STYLE_BIG : TEXT_STYLE_NORM;
  t.style.fill = color || '#ffffff';
  return t;
}
export function releaseText(t){
  if(!t) return;
  if(t.parent) t.parent.removeChild(t);
  t.visible = false;
  if(TEXT_POOL.length < 128) TEXT_POOL.push(t);
  else t.destroy();
}

/* ───────── SPRITE POOL ─────────
   acquireSprite(key, texture) returns a PIXI.Sprite (anchor 0.5) ready to position.
   releaseSprite(key, sprite) hides it, removes from parent, returns to pool. */
const SPRITE_POOL = new Map();
const SPRITE_POOL_LIMIT_PER_KEY = 256;
export function acquireSprite(key, texture){
  const pool = SPRITE_POOL.get(key);
  if(pool && pool.length){
    const s = pool.pop();
    s.visible = true;
    s.alpha = 1;
    s.scale.set(1);
    s.rotation = 0;
    return s;
  }
  const s = new PIXI.Sprite(texture);
  s.anchor.set(0.5);
  return s;
}
export function releaseSprite(key, sprite){
  if(!sprite) return;
  if(sprite.parent) sprite.parent.removeChild(sprite);
  sprite.visible = false;
  let pool = SPRITE_POOL.get(key);
  if(!pool){ pool = []; SPRITE_POOL.set(key, pool); }
  if(pool.length < SPRITE_POOL_LIMIT_PER_KEY) pool.push(sprite);
  else sprite.destroy({ children: true, texture: false });
}

/* ===================================================================
   BACKGROUND (PIXI)
   - Sprites all live in bgC (no camera transform); parallax computed manually.
   - gradSprite : screen-sized radial-gradient tint, hue rebaked when shifted >8°
   - starSprites: 4-quad parallax wrap of pre-baked star canvas
   - gridSprite : TilingSprite of a 64×64 grid line texture, tilePosition camera-driven
   - playerGlow: pre-baked radial-gradient sprite, follows player in screen space
   =================================================================== */
function _makeStarCanvas(sw, sh, stars){
  const sc = document.createElement('canvas');
  sc.width = sw; sc.height = sh;
  const sx2 = sc.getContext('2d');
  for(const s of stars){
    const px = ((s.x % sw) + sw) % sw;
    const py = ((s.y % sh) + sh) % sh;
    sx2.globalAlpha = s.p;
    sx2.fillStyle = s.c;
    sx2.beginPath(); sx2.arc(px, py, s.r, 0, TAU); sx2.fill();
    sx2.globalAlpha = s.p * 0.25;
    sx2.beginPath(); sx2.arc(px, py, s.r * 2.2, 0, TAU); sx2.fill();
  }
  sx2.globalAlpha = 1;
  return sc;
}
function _makeGridTexture(){
  const g = 64;
  const cv = document.createElement('canvas');
  cv.width = g; cv.height = g;
  const cx2 = cv.getContext('2d');
  cx2.strokeStyle = 'rgba(60,120,220,.08)';
  cx2.lineWidth = 1;
  cx2.beginPath();
  cx2.moveTo(0, 0); cx2.lineTo(g, 0);
  cx2.moveTo(0, 0); cx2.lineTo(0, g);
  cx2.stroke();
  return PIXI.Texture.from(cv);
}
function _makePlayerGlowTexture(){
  const sz = 800;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const c2 = cv.getContext('2d');
  const g = c2.createRadialGradient(sz/2, sz/2, 30, sz/2, sz/2, 380);
  g.addColorStop(0, 'rgba(0,240,255,.18)');
  g.addColorStop(1, 'rgba(0,240,255,0)');
  c2.fillStyle = g;
  c2.fillRect(0, 0, sz, sz);
  return PIXI.Texture.from(cv);
}

export const BG = {
  stars: [],
  starLayerW: 0,
  starLayerH: 0,
  gradCanvas: null,
  gradHue: -999,
  gradSprite: null,
  starSprites: [],
  gridSprite: null,
  playerGlow: null,
  init(){
    this.stars = [];
    for(let i=0;i<140;i++){
      this.stars.push({x:Math.random()*W*3-W, y:Math.random()*H*3-H, r:Math.random()*1.5+.3, p:Math.random()*.6+.4, c:choice([C.cyan,C.magenta,C.violet,C.lime,C.gold])});
    }
    const sw = Math.floor(W*1.5), sh = Math.floor(H*1.5);
    this.starLayerW = sw; this.starLayerH = sh;
    const starCanvas = _makeStarCanvas(sw, sh, this.stars);
    const starTex = PIXI.Texture.from(starCanvas);

    // gradient
    const gc = document.createElement('canvas');
    gc.width = W; gc.height = H;
    this.gradCanvas = gc;
    this.bakeGradient(0);
    this.gradSprite = new PIXI.Sprite(PIXI.Texture.from(gc));
    bgC.addChild(this.gradSprite);

    // 4-quad star parallax — tile to cover screen with positive offsets too
    for(let i = 0; i < 4; i++){
      const sp = new PIXI.Sprite(starTex);
      this.starSprites.push(sp);
      bgC.addChild(sp);
    }

    // grid tiling
    this.gridSprite = new PIXI.TilingSprite({ texture: _makeGridTexture(), width: W, height: H });
    bgC.addChild(this.gridSprite);

    // player radial glow (additive blending for cyan hue on dark bg)
    this.playerGlow = new PIXI.Sprite(_makePlayerGlowTexture());
    this.playerGlow.anchor.set(0.5);
    this.playerGlow.visible = false;
    bgC.addChild(this.playerGlow);
  },
  bakeGradient(hue){
    const gc = this.gradCanvas, gx = gc.getContext('2d');
    const g = gx.createRadialGradient(W/2, H/2+100, 0, W/2, H/2, 800);
    g.addColorStop(0, `hsla(${hue} 55% 12% / 1)`);
    g.addColorStop(.5, `hsla(${(hue+50)%360} 35% 6% / 1)`);
    g.addColorStop(1, '#04050b');
    gx.fillStyle = g; gx.fillRect(0,0,W,H);
    this.gradHue = hue;
    if(this.gradSprite && this.gradSprite.texture){
      // Tell PIXI the source canvas changed
      this.gradSprite.texture.source.update();
    }
  },
  tick(){
    const hue = (G.bgT*8) % 360;
    let dh = Math.abs(hue - this.gradHue);
    if(dh > 180) dh = 360 - dh;
    if(dh > 8) this.bakeGradient(hue);

    // star parallax: 4-quad wrap so stars are continuous in any direction
    const sw = this.starLayerW, sh = this.starLayerH;
    const cx = ((G.cam.x*.05) % sw + sw) % sw;
    const cy = ((G.cam.y*.05) % sh + sh) % sh;
    const a = .78 + .22*Math.sin(G.bgT*1.6);
    const positions = [
      [-cx, -cy],
      [sw - cx, -cy],
      [-cx, sh - cy],
      [sw - cx, sh - cy],
    ];
    for(let i = 0; i < 4; i++){
      const sp = this.starSprites[i];
      sp.position.set(positions[i][0], positions[i][1]);
      sp.alpha = a;
    }

    // grid: tilePosition is the offset of the tile pattern
    if(this.gridSprite){
      this.gridSprite.tilePosition.x = -G.cam.x;
      this.gridSprite.tilePosition.y = -G.cam.y;
    }

    // player glow follows player in screen space (player is camera-centered)
    if(G.player && this.playerGlow){
      const ps = worldToScreen(G.player.x, G.player.y);
      this.playerGlow.position.set(ps.x, ps.y);
      this.playerGlow.visible = true;
    } else if(this.playerGlow){
      this.playerGlow.visible = false;
    }
  }
};
// PIXI is available globally before module script runs (CDN <script> precedes <script type="module">).
// bgC is created synchronously at core.js module load. So BG.init() is safe at module import.
BG.init();
