/* ===================================================================
   RENDER PRIMITIVES + BACKGROUND
   - Sprite cache (Canvas 2D): bake stroked effects with shadowBlur once, blit via drawImage.
     UI cards now use generated PNGs or gothic HTML rune icons.
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

/* ───────── GENERATED GOTHIC SPRITE ASSETS ─────────
   These PNGs sit on top of the original geometry-based renderer. Unmapped
   actors still use procedural textures, so the art rollout can stay incremental. */
export const SPRITE_ASSETS = Object.freeze({
  players: Object.freeze({
    CIRCLE: { id:'player.riftWarden', url:'assets/sprites/player/rift-warden.png', width:48, height:64, animProfile:'player' },
  }),
  enemies: Object.freeze({
    TRI: { id:'enemy.hollowImp', url:'assets/sprites/enemies/hollow-imp.png', width:46, height:54, animProfile:'lightEnemy' },
    SQR: { id:'enemy.graveBrute', url:'assets/sprites/enemies/grave-brute.png', width:62, height:62, animProfile:'heavyEnemy' },
  }),
  bosses: Object.freeze({
    SPIKE_KING: { id:'boss.ashenButcher', url:'assets/sprites/bosses/ashen-butcher.png', width:128, height:142, animProfile:'boss' },
  }),
  projectiles: Object.freeze({
    bullet: { id:'projectile.hellfireCross', url:'assets/sprites/projectiles/hellfire-cross.png', width:34, height:34, spinRate:2.2, animProfile:'projectile' },
    homing: { id:'projectile.boneShard', url:'assets/sprites/projectiles/bone-shard.png', width:32, height:36, rotationOffset:-Math.PI/4, animProfile:'projectile' },
    shuriken: { id:'projectile.spectralBlade', url:'assets/sprites/projectiles/spectral-blade.png', width:30, height:42, rotationOffset:-Math.PI/4, animProfile:'projectile' },
  }),
});
export const ANIM_PROFILES = Object.freeze({
  player: Object.freeze({ bobAmp:3.0, bobHz:2.0, swayAmp:.025, leanK:.11, squashK:.075, hitJolt:.12, speedRef:280 }),
  lightEnemy: Object.freeze({ bobAmp:2.8, bobHz:3.8, swayAmp:.035, leanK:.15, squashK:.09, hitJolt:.16, speedRef:190 }),
  heavyEnemy: Object.freeze({ bobAmp:1.6, bobHz:1.7, swayAmp:.018, leanK:.07, squashK:.055, hitJolt:.20, speedRef:130 }),
  boss: Object.freeze({ bobAmp:2.0, bobHz:.85, swayAmp:.012, leanK:.025, squashK:.025, hitJolt:.09, speedRef:90 }),
  projectile: Object.freeze({ bobAmp:0, bobHz:4.2, swayAmp:.04, leanK:0, squashK:.12, hitJolt:0, speedRef:420 }),
  pickup: Object.freeze({ bobAmp:3.0, bobHz:2.8, swayAmp:.02, leanK:0, squashK:.035, hitJolt:0, speedRef:1 }),
});
export const SPRITE_ASSET_LIST = Object.freeze([
  ...Object.values(SPRITE_ASSETS.players),
  ...Object.values(SPRITE_ASSETS.enemies),
  ...Object.values(SPRITE_ASSETS.bosses),
  ...Object.values(SPRITE_ASSETS.projectiles),
]);

const IMAGE_TEX_CACHE = new Map();
export async function preloadSpriteAssets(){
  if(!globalThis.PIXI?.Assets) return;
  await Promise.all(SPRITE_ASSET_LIST.map(asset =>
    PIXI.Assets.load(asset.url).catch(err => {
      console.warn('[sprite asset preload failed]', asset.url, err);
      return null;
    })
  ));
}
export function getImageTextureAsset(asset){
  if(!asset) return null;
  let texture = IMAGE_TEX_CACHE.get(asset.id);
  if(!texture){
    texture = PIXI.Texture.from(asset.url);
    IMAGE_TEX_CACHE.set(asset.id, texture);
  }
  return { texture, key:`IMG|${asset.id}`, asset, w:asset.width, h:asset.height };
}
export function configureSpriteForAsset(sprite, asset){
  if(!sprite || !asset) return;
  sprite.width = asset.width;
  sprite.height = asset.height;
  sprite.__assetScaleX = sprite.scale.x;
  sprite.__assetScaleY = sprite.scale.y;
  sprite.__assetBaseRot = asset.rotationOffset || 0;
  sprite.tint = 0xffffff;
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
    s.tint = 0xffffff;
    s.__assetScaleX = null;
    s.__assetScaleY = null;
    s.__assetBaseRot = 0;
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
  cx2.strokeStyle = 'rgba(214,168,79,.035)';
  cx2.lineWidth = 1;
  cx2.beginPath();
  cx2.moveTo(0, 0); cx2.lineTo(g, 0);
  cx2.moveTo(0, 0); cx2.lineTo(0, g);
  cx2.stroke();
  return PIXI.Texture.from(cv);
}
function _seededRand(seed){
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function _makeFloorTexture(biomeKey){
  const sz = 256;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const c2 = cv.getContext('2d');
  const style = {
    nave: {
      seed: 12031,
      base:'#130b08', tile:'#20140f', seam:'rgba(216,199,161,.12)',
      dust:'rgba(216,199,161,.18)', crack:'rgba(5,3,2,.78)', glow:'rgba(214,168,79,.16)',
    },
    crypt: {
      seed: 41191,
      base:'#080d10', tile:'#121820', seam:'rgba(73,199,255,.09)',
      dust:'rgba(216,199,161,.16)', crack:'rgba(3,5,8,.84)', glow:'rgba(73,199,255,.18)',
    },
    hellforge: {
      seed: 88661,
      base:'#110504', tile:'#1e0a07', seam:'rgba(240,106,36,.10)',
      dust:'rgba(240,106,36,.18)', crack:'rgba(0,0,0,.9)', glow:'rgba(240,106,36,.34)',
    },
  }[biomeKey] || null;
  const s = style || {
    seed: 12031, base:'#130b08', tile:'#20140f', seam:'rgba(216,199,161,.12)',
    dust:'rgba(216,199,161,.18)', crack:'rgba(5,3,2,.78)', glow:'rgba(214,168,79,.16)',
  };
  const rnd = _seededRand(s.seed);
  c2.fillStyle = s.base;
  c2.fillRect(0, 0, sz, sz);

  const tile = biomeKey === 'crypt' ? 48 : 64;
  for(let y = -tile; y < sz + tile; y += tile){
    for(let x = -tile; x < sz + tile; x += tile){
      const ox = Math.round((rnd() - .5) * 8);
      const oy = Math.round((rnd() - .5) * 8);
      const w = tile + Math.round((rnd() - .5) * 10);
      const h = tile + Math.round((rnd() - .5) * 10);
      c2.fillStyle = s.tile;
      c2.globalAlpha = .42 + rnd() * .18;
      c2.fillRect(x + ox, y + oy, w, h);
      c2.globalAlpha = 1;
      c2.strokeStyle = s.seam;
      c2.lineWidth = 1;
      c2.strokeRect(x + ox + .5, y + oy + .5, w - 1, h - 1);
    }
  }

  for(let i = 0; i < 180; i++){
    const x = rnd() * sz, y = rnd() * sz;
    const r = .4 + rnd() * 1.4;
    c2.globalAlpha = .18 + rnd() * .24;
    c2.fillStyle = rnd() > .7 ? s.dust : '#000';
    c2.beginPath(); c2.arc(x, y, r, 0, TAU); c2.fill();
  }
  c2.globalAlpha = 1;

  for(let i = 0; i < 16; i++){
    let x = rnd() * sz, y = rnd() * sz;
    c2.beginPath();
    c2.moveTo(x, y);
    const steps = 3 + Math.floor(rnd() * 5);
    for(let j = 0; j < steps; j++){
      x += (rnd() - .5) * 46;
      y += (rnd() - .5) * 46;
      c2.lineTo(x, y);
    }
    c2.strokeStyle = s.crack;
    c2.lineWidth = .7 + rnd() * 1.2;
    c2.stroke();
    if(biomeKey === 'hellforge' && rnd() > .45){
      c2.save();
      c2.globalCompositeOperation = 'lighter';
      c2.strokeStyle = s.glow;
      c2.lineWidth = 3.5;
      c2.stroke();
      c2.restore();
    }
  }

  if(biomeKey === 'nave'){
    c2.strokeStyle = 'rgba(214,168,79,.16)';
    c2.lineWidth = 2;
    for(let x = 28; x < sz; x += 64){
      c2.beginPath();
      c2.moveTo(x, 0); c2.lineTo(x + 18, sz);
      c2.stroke();
    }
    c2.fillStyle = 'rgba(184,24,47,.12)';
    c2.fillRect(112, 0, 8, sz);
    c2.fillRect(136, 0, 8, sz);
  } else if(biomeKey === 'crypt'){
    c2.strokeStyle = 'rgba(216,199,161,.16)';
    c2.lineWidth = 1.4;
    for(let i = 0; i < 18; i++){
      const x = rnd() * sz, y = rnd() * sz, a = rnd() * TAU;
      c2.save();
      c2.translate(x, y); c2.rotate(a);
      c2.beginPath(); c2.moveTo(-8, 0); c2.lineTo(8, 0); c2.stroke();
      c2.beginPath(); c2.arc(-10, 0, 2.5, 0, TAU); c2.arc(10, 0, 2.5, 0, TAU); c2.stroke();
      c2.restore();
    }
  } else if(biomeKey === 'hellforge'){
    c2.save();
    c2.globalCompositeOperation = 'lighter';
    c2.fillStyle = 'rgba(184,24,47,.10)';
    for(let i = 0; i < 12; i++){
      c2.beginPath();
      c2.arc(rnd() * sz, rnd() * sz, 8 + rnd() * 20, 0, TAU);
      c2.fill();
    }
    c2.restore();
  }

  return PIXI.Texture.from(cv);
}
function _makePlayerGlowTexture(){
  const sz = 800;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const c2 = cv.getContext('2d');
  const g = c2.createRadialGradient(sz/2, sz/2, 30, sz/2, sz/2, 380);
  g.addColorStop(0, 'rgba(73,199,255,.16)');
  g.addColorStop(.45, 'rgba(127,77,216,.07)');
  g.addColorStop(1, 'rgba(73,199,255,0)');
  c2.fillStyle = g;
  c2.fillRect(0, 0, sz, sz);
  return PIXI.Texture.from(cv);
}

const BIOMES = {
  nave: {
    name:'RUINED NAVE',
    center:['rgba(54,22,17,1)', 'rgba(17,10,9,1)', '#050302'],
    stars:[C.gold, C.red, C.cyan, C.violet],
  },
  crypt: {
    name:'BONE CRYPT',
    center:['rgba(16,34,40,1)', 'rgba(10,12,18,1)', '#040506'],
    stars:[C.cyan, C.teal, C.violet, C.white],
  },
  hellforge: {
    name:'HELLFORGE RIFT',
    center:['rgba(70,18,12,1)', 'rgba(26,8,7,1)', '#050201'],
    stars:[C.red, C.gold, C.magenta, C.violet],
  },
};

export const BG = {
  stars: [],
  starLayerW: 0,
  starLayerH: 0,
  gradCanvas: null,
  gradHue: -999,
  biomeKey: null,
  gradSprite: null,
  starSprites: [],
  gridSprite: null,
  floorSprite: null,
  floorTextures: null,
  playerGlow: null,
  init(){
    this.stars = [];
    for(let i=0;i<140;i++){
      this.stars.push({x:Math.random()*W*3-W, y:Math.random()*H*3-H, r:Math.random()*1.5+.3, p:Math.random()*.6+.4, c:choice([C.cyan,C.red,C.violet,C.gold,C.white])});
    }
    const sw = Math.floor(W*1.5), sh = Math.floor(H*1.5);
    this.starLayerW = sw; this.starLayerH = sh;
    const starCanvas = _makeStarCanvas(sw, sh, this.stars);
    const starTex = PIXI.Texture.from(starCanvas);

    // gradient
    const gc = document.createElement('canvas');
    gc.width = W; gc.height = H;
    this.gradCanvas = gc;
    this.bakeGradient('nave');
    this.gradSprite = new PIXI.Sprite(PIXI.Texture.from(gc));
    bgC.addChild(this.gradSprite);

    this.floorTextures = {
      nave: _makeFloorTexture('nave'),
      crypt: _makeFloorTexture('crypt'),
      hellforge: _makeFloorTexture('hellforge'),
    };
    this.floorSprite = new PIXI.TilingSprite({ texture: this.floorTextures.nave, width: W, height: H });
    this.floorSprite.alpha = .82;
    bgC.addChild(this.floorSprite);

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
  bakeGradient(biomeKey){
    const biome = BIOMES[biomeKey] || BIOMES.nave;
    const gc = this.gradCanvas, gx = gc.getContext('2d');
    const g = gx.createRadialGradient(W/2, H/2+100, 0, W/2, H/2, 800);
    g.addColorStop(0, biome.center[0]);
    g.addColorStop(.52, biome.center[1]);
    g.addColorStop(1, biome.center[2]);
    gx.fillStyle = g; gx.fillRect(0,0,W,H);
    this.biomeKey = biomeKey;
    if(this.gradSprite && this.gradSprite.texture){
      // Tell PIXI the source canvas changed
      this.gradSprite.texture.source.update();
    }
    if(this.floorSprite && this.floorTextures){
      this.floorSprite.texture = this.floorTextures[biomeKey] || this.floorTextures.nave;
    }
  },
  tick(){
    const biomeKey = !G.player ? 'nave' : (G.t < 300 ? 'nave' : (G.t < 600 ? 'crypt' : 'hellforge'));
    if(biomeKey !== this.biomeKey) this.bakeGradient(biomeKey);
    G.biomeName = BIOMES[biomeKey].name;

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
      sp.alpha = biomeKey === 'nave' ? a * .42 : (biomeKey === 'crypt' ? a * .34 : a * .5);
    }

    if(this.floorSprite){
      this.floorSprite.tilePosition.x = -G.cam.x * .88;
      this.floorSprite.tilePosition.y = -G.cam.y * .88;
      this.floorSprite.alpha = biomeKey === 'hellforge' ? .9 : .82;
    }

    // grid: tilePosition is the offset of the tile pattern
    if(this.gridSprite){
      this.gridSprite.tilePosition.x = -G.cam.x;
      this.gridSprite.tilePosition.y = -G.cam.y;
      this.gridSprite.alpha = biomeKey === 'hellforge' ? .18 : .10;
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
