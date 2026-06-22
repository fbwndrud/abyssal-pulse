/* ===================================================================
   ENTITIES — base entity factory + spatial hash + fx + spawning + combat helpers.
   This is the bottom of the game-logic stack: weapons.js calls into here
   (firePulse / fireProjectile / fxBurst / etc), and player.js calls dealDamage.
   =================================================================== */
import { G, TAU, C, rand, clamp, lerp, dist, dist2, angTo, announce, entityLayer, fxLayer, beamLayer, bhLayer } from './core.js';
import { AUDIO } from './audio.js';
import {
  getCircleTexture, getPolygonTexture, getStarTexture, getDiamondTexture,
  SPRITE_ASSETS, getImageTextureAsset, configureSpriteForAsset,
  acquireSprite, releaseSprite,
  acquireParticle, releaseParticle,
  acquireGraphics, releaseGraphics,
  acquireText, releaseText,
  getBossAuraTexture,
} from './render.js';

/* ───────── ENTITY BASE ───────── */
export function makeEnt(props){
  const e = Object.assign({alive:true, t:0}, props);
  G.ents.push(e);
  _autoAttachSprite(e);
  return e;
}

function _autoAttachSprite(e){
  switch(e.type){
    case 'enemy':     _attachEnemySprite(e); e.__sprKind = 'tex'; break;
    case 'proj':      _attachProjectileSprite(e); e.__sprKind = 'tex'; break;
    case 'ebullet':   _attachEnemyBulletSprite(e); e.__sprKind = 'tex'; break;
    case 'xp': case 'coin': case 'heart': case 'magnet':
    case 'freeze': case 'chest': case 'item': case 'shrine':
      _attachPickupSprite(e); e.__sprKind = 'tex'; break;
    case 'fx':        _attachFxParticleSprite(e); break;
    case 'ring': case 'shock': case 'line': case 'fan': case 'zone':
                      _attachFxGraphics(e, fxLayer); break;
    case 'blackhole': _attachFxGraphics(e, bhLayer); break;
    case 'text':      _attachFxText(e); break;
  }
}

function _attachFxParticleSprite(e){
  const sp = acquireParticle();
  sp.tint = e.color;
  // Particle texture is 32px white round dot. e.size is the rendered radius (~3).
  // scale = (size * 2) / 32 = size / 16.
  sp.scale.set(Math.max(0.05, (e.size || 3) / 16));
  sp.position.set(e.x, e.y);
  fxLayer.addChild(sp);
  e.sprite = sp;
  e.__sprKind = 'particle';
}

function _attachFxGraphics(e, layer){
  const g = acquireGraphics();
  g.position.set(0, 0); // graphics draws at world coords directly
  layer.addChild(g);
  e.sprite = g;
  e.__sprKind = 'gfx';
}

function _attachFxText(e){
  const t = acquireText(e.text, e.color || '#ffffff', !!e.big);
  t.position.set(e.x, e.y);
  fxLayer.addChild(t);
  e.sprite = t;
  e.__sprKind = 'text';
}

/* ───────── SPRITE ATTACHMENT ─────────
   Each visual entity gets a PIXI.Sprite from the pool, added to entityLayer.
   Position/rotation are synced each frame in gameloop.update(). On entity
   death (alive=false), the cleanup pass calls detachSprite() to return it. */
export function attachSpriteFromTexInfo(e, texInfo){
  e.__texKey = texInfo.key;
  e.__spriteAsset = texInfo.asset || null;
  e.sprite = acquireSprite(texInfo.key, texInfo.texture);
  e.sprite.position.set(e.x, e.y);
  if(texInfo.asset) configureSpriteForAsset(e.sprite, texInfo.asset);
  entityLayer.addChild(e.sprite);
}
export function detachSprite(e){
  // Boss aura is a separate sprite — destroy it (not pooled, bosses are rare).
  if(e.auraSprite){
    if(e.auraSprite.parent) e.auraSprite.parent.removeChild(e.auraSprite);
    e.auraSprite.destroy({ children: false, texture: false });
    e.auraSprite = null;
  }
  if(!e.sprite) return;
  switch(e.__sprKind){
    case 'particle': releaseParticle(e.sprite); break;
    case 'gfx':      releaseGraphics(e.sprite); break;
    case 'text':     releaseText(e.sprite); break;
    case 'tex':
    default:         releaseSprite(e.__texKey, e.sprite); break;
  }
  e.sprite = null;
  e.__sprKind = null;
  e.__texKey = null;
  e.__normTex = null;
  e.__flashTex = null;
  e.__spriteAsset = null;
}

/* Detach all entity + player sprites. Called by startRun to avoid sprite leaks
   when a run restarts (G.ents is cleared and a new player spawns). */
export function clearAllWorldSprites(){
  for(const e of G.ents) detachSprite(e);
  const p = G.player;
  if(p){
    if(p.sprite){ releaseSprite(p.__bodyKey, p.sprite); p.sprite = null; }
    if(p.dotSprite){ releaseSprite(p.__dotKey, p.dotSprite); p.dotSprite = null; }
    if(p.trailGfx){ releaseGraphics(p.trailGfx); p.trailGfx = null; }
    if(p.beamGfx){ releaseGraphics(p.beamGfx); p.beamGfx = null; }
  }
}

function _attachEnemySprite(e){
  const isBoss = !!e.isBoss;
  const glow = isBoss ? 14 : 6;
  const lw = isBoss ? 3 : 2;
  const fillNorm = 'rgba(8,14,30,.55)';
  const fillFlash = 'rgba(255,255,255,.6)';
  // Boss aura: large radial-gradient backdrop, added BEFORE body so body
  // renders on top. Gives bosses a distinct visual "presence" beyond polygon
  // sides (RING_LORD/SPIKE_KING/HYDRA/PRISMA all looked alike without it).
  if(isBoss){
    const auraSp = new PIXI.Sprite(getBossAuraTexture());
    auraSp.anchor.set(0.5);
    auraSp.tint = e.color;
    const auraSize = e.r * 6;
    auraSp.scale.set(auraSize / 256);
    auraSp.alpha = 0.4;
    auraSp.position.set(e.x, e.y);
    entityLayer.addChild(auraSp);
    e.auraSprite = auraSp;
    e.auraSize = auraSize;
  }
  const imageAsset = isBoss ? SPRITE_ASSETS.bosses[e.kind] : SPRITE_ASSETS.enemies[e.kind];
  const imageTex = getImageTextureAsset(imageAsset);
  if(imageTex){
    e.__normTex = imageTex;
    e.__flashTex = null;
    attachSpriteFromTexInfo(e, imageTex);
    return;
  }
  let normTex, flashTex;
  if(e.isDiamond){
    normTex  = getDiamondTexture(e.r, e.color, glow, fillNorm);
    flashTex = getDiamondTexture(e.r, '#ffffff', glow, fillFlash);
  } else if(e.sides === 0){
    normTex  = getCircleTexture(e.r, e.color, glow, fillNorm, lw);
    flashTex = getCircleTexture(e.r, '#ffffff', glow, fillFlash, lw);
  } else {
    normTex  = getPolygonTexture(e.sides, e.r, e.color, glow, fillNorm, lw);
    flashTex = getPolygonTexture(e.sides, e.r, '#ffffff', glow, fillFlash, lw);
  }
  e.__normTex = normTex;
  e.__flashTex = flashTex;
  attachSpriteFromTexInfo(e, normTex);
}

function _attachProjectileSprite(e){
  const imageAsset = SPRITE_ASSETS.projectiles[e.subtype];
  const imageTex = getImageTextureAsset(imageAsset);
  if(imageTex){
    attachSpriteFromTexInfo(e, imageTex);
    return;
  }
  let texInfo;
  if(e.subtype === 'shuriken')     texInfo = getStarTexture(4, 14, 6, e.color, 8, e.color, 1.6);
  else if(e.subtype === 'homing')  texInfo = getDiamondTexture(8, e.color, 6, e.color);
  else if(e.subtype === 'prism')   texInfo = getPolygonTexture(3, 8, e.color, 6, e.color, 1.6);
  else                             texInfo = getCircleTexture(4, e.color, 6, e.color, 1);
  attachSpriteFromTexInfo(e, texInfo);
}

function _attachEnemyBulletSprite(e){
  const tex = getCircleTexture(e.r, e.color, 6, e.color, 1.4);
  attachSpriteFromTexInfo(e, tex);
}

function _attachPickupSprite(e){
  let texInfo;
  if(e.type === 'xp'){
    // Brighter XP — was glow=6, now 10 so XP shimmers stand out against enemies on the bg.
    texInfo = getDiamondTexture(e.r, e.color, 10, e.color);
  } else if(e.type === 'coin'){
    texInfo = getDiamondTexture(e.r, C.gold, 8, C.gold);
  } else if(e.type === 'magnet'){
    texInfo = getStarTexture(4, e.r, e.r*.4, C.pink, 8, C.pink, 1.6);
  } else if(e.type === 'freeze'){
    texInfo = getStarTexture(6, e.r, e.r*.5, C.teal, 8, C.teal, 1.6);
  } else if(e.type === 'chest'){
    texInfo = getStarTexture(5, e.r*1.4, e.r*.6, C.gold, 10, 'hsla(50 90% 20% / .7)', 2);
  } else if(e.type === 'heart'){
    // Heart bezier shape isn't a regular polygon; approximate with a small filled circle.
    // (Visual regression: heart icon → red dot. Acceptable for a rare drop.)
    texInfo = getCircleTexture(e.r * 1.1, C.red, 8, C.red, 1.4);
  } else if(e.type === 'item'){
    const col = e.color || C.gold;
    const glow = e.glow || 18;
    const isRelic = e.item && e.item.kind === 'relic';
    if(isRelic){
      // Relic — large hexagon, full glow, bright fill (distinct from any enemy/XP).
      texInfo = getPolygonTexture(6, e.r * 1.6, col, glow, col, 2.4);
    } else {
      // Consumable — 5-point star (distinct from XP diamond & enemy polygons).
      texInfo = getStarTexture(5, e.r * 1.6, e.r * 0.75, col, glow, col, 2);
    }
  } else {
    texInfo = getCircleTexture(e.r, '#ffffff', 6, '#ffffff', 1);
  }
  attachSpriteFromTexInfo(e, texInfo);
}

/* ───────── SPATIAL HASH GRID (enemies only) ───────── */
export const EGRID = {
  cell: 128,
  map: new Map(),
  enemies: [],
  _key(cx, cy){ return cx * 100003 + cy; },
  build(ents){
    this.map.clear();
    const list = this.enemies;
    list.length = 0;
    const cs = this.cell;
    for(let i = 0; i < ents.length; i++){
      const e = ents[i];
      if(e.type !== 'enemy' || !e.alive) continue;
      list.push(e);
      const k = this._key(Math.floor(e.x / cs), Math.floor(e.y / cs));
      let arr = this.map.get(k);
      if(!arr){ arr = []; this.map.set(k, arr); }
      arr.push(e);
    }
  },
  query(x, y, r, out){
    out.length = 0;
    const cs = this.cell;
    const cx0 = Math.floor((x - r) / cs), cx1 = Math.floor((x + r) / cs);
    const cy0 = Math.floor((y - r) / cs), cy1 = Math.floor((y + r) / cs);
    for(let cx = cx0; cx <= cx1; cx++){
      for(let cy = cy0; cy <= cy1; cy++){
        const arr = this.map.get(this._key(cx, cy));
        if(arr) for(let i = 0; i < arr.length; i++) out.push(arr[i]);
      }
    }
    return out;
  },
  queryLine(x1, y1, x2, y2, r, out){
    const cx = (x1 + x2) * .5, cy = (y1 + y2) * .5;
    const half = Math.hypot(x2 - x1, y2 - y1) * .5;
    return this.query(cx, cy, half + r, out);
  },
  count(){ return this.enemies.length; }
};
export const _EQ1 = [], _EQ2 = [];

/* ───────── PARTICLE / FX HELPERS ───────── */
// Global particle budget — when entity count is high (mid-late run boss waves),
// shrink particle spawn counts. shadowBlur dominates draw cost so trimming fx
// is the single biggest FPS lever we have.
function _particleBudget(count){
  const n = G.ents.length;
  if(n > 1500) return Math.max(1, count >> 3);    // 12%
  if(n > 900)  return Math.max(1, count >> 2);    // 25%
  if(n > 500)  return Math.max(1, count >> 1);    // 50%
  if(n > 300)  return Math.max(2, (count*.7)|0);  // 70%
  return count;
}
export function fxBurst(x,y,color,count=14,speed=180,size=3,life=.5){
  count = _particleBudget(count);
  for(let i=0;i<count;i++){
    const a = Math.random()*TAU;
    const sp = speed * (.4 + Math.random()*.9);
    makeEnt({type:'fx', x, y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, color, size:size*(.6+Math.random()*.8), life, maxLife:life});
  }
}
export function fxRing(x,y,color,size=60,life=.4){
  makeEnt({type:'ring', x, y, color, r:8, maxR:size, life, maxLife:life});
}
export function fxText(x,y,text,color='#fff',big=false){
  // Damage-number budget: under heavy load, skip most non-boss numbers.
  // Boss damage (big=true) and crits stay readable; mob damage is noise.
  const n = G.ents.length;
  if(!big){
    if(n > 1200) return;
    if(n > 800 && Math.random() > .3) return;
    if(n > 500 && Math.random() > .6) return;
  }
  makeEnt({type:'text', x, y, text, color, life:.7, maxLife:.7, vy:-50, big});
}
export function fxLine(x1,y1,x2,y2,color,life=.18,width=2){
  makeEnt({type:'line', x1,y1,x2,y2,color,life,maxLife:life,width});
}
export function fxShockwave(x,y,color,maxR=180,life=.5){
  makeEnt({type:'shock', x, y, color, r:8, maxR, life, maxLife:life});
}
export function spawnZone(x, y, r, life, dmgPerSec, color=C.gold, opts={}){
  const z = makeEnt({
    type:'zone', x, y, r, life, maxLife:life,
    dmgPerSec, color, tick:0, tickRate:opts.tickRate || .35,
    slow:opts.slow || 0, slowDur:opts.slowDur || .6,
    burnDps:opts.burnDps || 0, burnDur:opts.burnDur || 1,
    bleedDps:opts.bleedDps || 0, bleedDur:opts.bleedDur || 1,
    pull:opts.pull || 0, kind:opts.kind || 'rune',
    seed:Math.random()*TAU,
  });
  if(z.kind !== 'hellfire') fxRing(x, y, color, r, Math.min(.55, life));
  return z;
}
export function shake(amt){ G.shake = Math.min(1, G.shake + amt); }
export function hitstop(s){ G.hitstop = Math.max(G.hitstop, s); }
export function flash(color,a=.4){ G.flash = a; G.flashColor = color; }

/* ───────── COMBAT HELPERS ───────── */
export function dealDamage(e, dmg, color='#fff'){
  if(!e.alive) return;
  if(e.isBoss && G.player && G.player.bossDmgMul) dmg *= G.player.bossDmgMul;
  // KILL STREAK chip: while the streak buff timer is active, every dealt
  // damage is multiplied. Buff is applied + ticked in killEnemy + gameloop.
  if(G.player && (G.player._streakActive||0) > 0 && G.player._killStreakBonus){
    dmg *= (1 + G.player._killStreakBonus);
  }
  // COMBO CHIP: every 10 combo gives +X% dmg, capped.
  if(G.player && G.player._comboBonusPer10 && G.combo > 0){
    const tiers = Math.floor(G.combo / 10);
    const bonus = Math.min(G.player._comboBonusCap || 0.30, tiers * G.player._comboBonusPer10);
    if(bonus > 0) dmg *= (1 + bonus);
  }
  dmg = Math.round(dmg);
  e.hp -= dmg;
  e.hitFlash = .12;
  fxText(e.x, e.y - e.r - 4, dmg, color);
  if(e.hp <= 0){ killEnemy(e); }
  else { AUDIO.hit(e.x); }
}

// Slow effect from evolution `extra:{slow, slowDur}`. Applied when an enemy
// is hit by a slow-tagged attack. Multiplier is (1 - factor); duration in s.
// Stronger slows override weaker; equal-strength refresh duration.
export function applySlow(e, factor, duration){
  if(!e || !e.alive) return;
  const mul = Math.max(0, 1 - factor);
  if(e.slowMul == null || mul < e.slowMul || (mul === e.slowMul && (e.slowTime||0) < duration)){
    e.slowMul = mul;
    e.slowTime = duration;
  }
}
export function applyBurn(e, dmgPerSec, duration, color=C.red){
  if(!e || !e.alive || dmgPerSec <= 0) return;
  if((e.burnDps || 0) <= dmgPerSec || (e.burnTime || 0) < duration){
    e.burnDps = dmgPerSec;
    e.burnTime = duration;
    e.burnColor = color;
    e._burnTick = Math.min(e._burnTick || .5, .35);
  }
}
export function applyBleed(e, dmgPerSec, duration, color=C.red){
  if(!e || !e.alive || dmgPerSec <= 0) return;
  if((e.bleedDps || 0) <= dmgPerSec || (e.bleedTime || 0) < duration){
    e.bleedDps = dmgPerSec;
    e.bleedTime = duration;
    e.bleedColor = color;
    e._bleedTick = Math.min(e._bleedTick || .5, .5);
  }
}
export function applyHex(e, dmg, radius, duration, color=C.violet){
  if(!e || !e.alive) return;
  if((e.hexDmg || 0) <= dmg || (e.hexTime || 0) < duration){
    e.hexDmg = dmg;
    e.hexR = radius;
    e.hexTime = duration;
    e.hexColor = color;
  }
}
export function killEnemy(e){
  if(!e.alive) return;
  e.alive = false;
  G.killCount++;
  G.combo++;
  G.comboTimer = 2.2;
  // KILL STREAK chip: every Nth kill activates a temporary dmg buff.
  if(G.player && G.player._killStreakBonus && G.player._killStreakNeed){
    G.player._streakKills = (G.player._streakKills||0) + 1;
    if(G.player._streakKills >= G.player._killStreakNeed){
      G.player._streakKills = 0;
      G.player._streakActive = G.player._killStreakDur || 5;
      fxRing(G.player.x, G.player.y, C.gold, 110, .55);
    }
  }
  // FROST CHIP: chance to slow nearby enemies on kill.
  if(G.player && G.player._frostKillChance && Math.random() < G.player._frostKillChance){
    const list = EGRID.query(e.x, e.y, 140, _EQ1);
    for(let i = 0; i < list.length; i++){
      const o = list[i]; if(!o.alive || o === e) continue;
      applySlow(o, .55, 1.4);
    }
    fxRing(e.x, e.y, '#aaffff', 130, .35);
  }
  if(G.player && G.player.killHealChance && Math.random() < G.player.killHealChance){
    const amt = G.player.killHealAmt || 0;
    if(amt > 0){
      G.player.hp = Math.min(G.player.maxHp, G.player.hp + amt);
      fxRing(G.player.x, G.player.y, C.lime, 36, .25);
    }
  }
  // SIPHON relic: boss kills heal a flat amount on top of the per-kill chance.
  if(e.isBoss && G.player && G.player.bossHeal){
    G.player.hp = Math.min(G.player.maxHp, G.player.hp + G.player.bossHeal);
    fxRing(G.player.x, G.player.y, C.lime, 90, .55);
  }
  fxBurst(e.x, e.y, e.color, e.isBoss?42:14, e.isBoss?340:200, e.isBoss?5:3, .6);
  fxRing(e.x, e.y, e.color, e.isBoss?160:e.r*3.5, e.isBoss?.7:.45);
  if(e.eliteAffix === 'molten'){
    const r = 150;
    fxShockwave(e.x, e.y, C.red, r, .55);
    fxBurst(e.x, e.y, C.red, 32, 320, 4, .55);
    const list = EGRID.query(e.x, e.y, r + 40, _EQ1);
    for(let i = 0; i < list.length; i++){
      const o = list[i];
      if(!o.alive || o === e) continue;
      const dx = o.x - e.x, dy = o.y - e.y;
      if(dx*dx + dy*dy <= r*r) dealDamage(o, Math.max(20, o.maxHp * .18), C.red);
    }
  } else if(e.eliteAffix === 'voidTouched'){
    spawnBlackhole(e.x, e.y, 120, 1.8, 360, 32);
    fxRing(e.x, e.y, C.violet, 150, .6);
  }
  if(e.hexDmg && e.hexR){
    fxRing(e.x, e.y, e.hexColor || C.violet, e.hexR, .38);
    fxBurst(e.x, e.y, e.hexColor || C.violet, 14, 180, 3, .35);
    const hexList = EGRID.query(e.x, e.y, e.hexR + 40, _EQ1);
    for(let hi = 0; hi < hexList.length; hi++){
      const o = hexList[hi];
      if(!o.alive || o === e) continue;
      const dx = o.x - e.x, dy = o.y - e.y;
      if(dx*dx + dy*dy <= e.hexR * e.hexR) dealDamage(o, e.hexDmg, e.hexColor || C.violet);
    }
  }
  if(e.isBoss){ shake(.6); flash(e.color, .35); AUDIO.explode(e.x, e.y); announce('ABYSS LORD SLAIN', 1.6); }
  else { shake(.04); AUDIO.hit(e.x); }
  // drops are handled by player.js (it imports the items table) via _onKill hook
  if(_onKillHook) _onKillHook(e);
  // boss UI cleanup + music swap
  if(e.isBoss && G.bossActive === e){
    G.bossActive = null;
    document.getElementById('boss-hp-wrap').style.display='none';
    document.getElementById('boss-name').style.display='none';
    AUDIO.setMode('main');
  }
}
// player.js installs a hook here so we can drop XP / items / split-spawns
// without entities.js needing to import items + spawn helpers transitively.
let _onKillHook = null;
export function setOnKillHook(fn){ _onKillHook = fn; }

export function pointSegDist(px,py, ax,ay, bx,by){
  const dx = bx-ax, dy = by-ay;
  const len = dx*dx + dy*dy;
  let t = ((px-ax)*dx + (py-ay)*dy) / (len||1);
  t = clamp(t, 0, 1);
  const cx = ax + dx*t, cy = ay + dy*t;
  return Math.hypot(px-cx, py-cy);
}
export function nearestEnemy(p, range=Infinity){
  let best=null, bd=range*range;
  if(range === Infinity || !isFinite(range)){
    const el = EGRID.enemies;
    for(let i = 0; i < el.length; i++){
      const e = el[i];
      if(!e.alive) continue;
      const d = (e.x-p.x)*(e.x-p.x)+(e.y-p.y)*(e.y-p.y);
      if(d < bd){ bd = d; best = e; }
    }
    return best;
  }
  const list = EGRID.query(p.x, p.y, range, _EQ1);
  for(let i = 0; i < list.length; i++){
    const e = list[i];
    if(!e.alive) continue;
    const d = (e.x-p.x)*(e.x-p.x)+(e.y-p.y)*(e.y-p.y);
    if(d < bd){ bd = d; best = e; }
  }
  return best;
}
export function nearestEnemyExcept(p, exclude, range){
  let best=null, bd=range*range;
  const list = EGRID.query(p.x, p.y, range, _EQ1);
  for(let i = 0; i < list.length; i++){
    const e = list[i];
    if(!e.alive || exclude.has(e)) continue;
    const d = (e.x-p.x)*(e.x-p.x)+(e.y-p.y)*(e.y-p.y);
    if(d < bd){ bd = d; best = e; }
  }
  return best;
}

/* ───────── PROJECTILE / ATTACK SPAWNERS ───────── */
export function fireProjectile(x,y,angle,speed,dmg,life,color,kind='bullet',extra={}){
  AUDIO.shoot(x);
  const p = makeEnt(Object.assign({
    type:'proj', subtype:kind, x, y,
    vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed,
    angle, speed, dmg, color, life, maxLife:life,
    r: extra.r != null ? extra.r : (kind==='shuriken' ? 14 : kind==='homing' ? 8 : kind==='prism' ? 9 : 6),
    pierce: extra.pierce!=null ? extra.pierce : 0,
    hits: new Set(),
    spin: extra.spin || 0,
    target: extra.target || null,
    turn: extra.turn || 0,
    splits: extra.splits || 0,
  }, extra));
  return p;
}
export function firePulse(x,y,r,dmg,kb,opts){
  AUDIO.explode(x, y);
  fxShockwave(x,y,opts?.color || C.cyan,r,.45);
  shake(.05);
  const list = EGRID.query(x, y, r + 40, _EQ1);
  for(let i = 0; i < list.length; i++){
    const e = list[i];
    if(!e.alive) continue;
    const dx = e.x - x, dy = e.y - y;
    const rr = r + e.r;
    if(dx*dx + dy*dy <= rr*rr){
      const a = Math.atan2(dy, dx);
      e.vx += Math.cos(a)*kb;
      e.vy += Math.sin(a)*kb;
      dealDamage(e, dmg, opts?.color || C.cyan);
      if(opts?.slow) applySlow(e, opts.slow, opts.slowDur || 1);
      if(opts?.burnDps) applyBurn(e, opts.burnDps, opts.burnDur || 1, opts.color || C.red);
      if(opts?.bleedDps) applyBleed(e, opts.bleedDps, opts.bleedDur || 1, opts.color || C.red);
      if(opts?.hexDmg) applyHex(e, opts.hexDmg, opts.hexR || r*.45, opts.hexDur || 2, opts.color || C.violet);
    }
  }
}
export function fireFanShock(x,y,angle,r,arc,dmg,opts){
  AUDIO.explode(x, y);
  const color = opts?.color || C.magenta;
  makeEnt({type:'fan', x,y,angle, r, arc, color, life:.35, maxLife:.35});
  shake(.06);
  const list = EGRID.query(x, y, r + 40, _EQ1);
  for(let i = 0; i < list.length; i++){
    const e = list[i];
    if(!e.alive) continue;
    const dx = e.x - x, dy = e.y - y;
    const rr = r + e.r;
    if(dx*dx + dy*dy > rr*rr) continue;
    const a = Math.atan2(dy, dx);
    let diff = ((a - angle) % TAU + Math.PI*3) % TAU - Math.PI;
    if(Math.abs(diff) <= arc/2){
      dealDamage(e, dmg, color);
      const k = 220;
      e.vx += Math.cos(a)*k;
      e.vy += Math.sin(a)*k;
      if(opts?.slow) applySlow(e, opts.slow, opts.slowDur || 1);
      if(opts?.burnDps) applyBurn(e, opts.burnDps, opts.burnDur || 1, color);
      if(opts?.bleedDps) applyBleed(e, opts.bleedDps, opts.bleedDur || 1, color);
      if(opts?.hexDmg) applyHex(e, opts.hexDmg, opts.hexR || r*.35, opts.hexDur || 2, color);
    }
  }
}
export function spawnBlackhole(x,y,r,life,pull,dmgPerSec,opts={}){
  const col = opts.color || C.violet;
  const bh = makeEnt({type:'blackhole', x, y, r, life, maxLife:life, pull, dmgPerSec, color:col, t:0});
  AUDIO.boss();
  fxRing(x,y,col,r,.6);
  return bh;
}

/* ───────── ENEMY / PICKUP SPAWNERS ───────── */
// ENEMIES + BOSSES tables live in data.js; we need them here for spawn.
// To keep entities.js below data.js in the dep order, data.js installs the
// definitions via setEnemyTables.
let ENEMIES_REF = null, BOSSES_REF = null, ELITE_AFFIXES_REF = null;
export function setEnemyTables(enemies, bosses, eliteAffixes){
  ENEMIES_REF = enemies; BOSSES_REF = bosses; ELITE_AFFIXES_REF = eliteAffixes || null;
}

function _rollEliteAffix(typeKey){
  if(!ELITE_AFFIXES_REF || G.t < 120 || typeKey === 'SWARM') return null;
  const min = G.t / 60;
  const chance = Math.min(.08, .025 + Math.max(0, min - 2) * .006);
  if(Math.random() > chance) return null;
  const pool = Object.values(ELITE_AFFIXES_REF);
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

export function spawnEnemy(typeKey, x, y){
  const def = ENEMIES_REF[typeKey];
  const tier = 1 + G.t/180;
  const affix = _rollEliteAffix(typeKey);
  const hpMul = affix ? affix.hpMul : 1;
  const dmgMul = affix ? affix.dmgMul : 1;
  const speedMul = affix ? affix.speedMul : 1;
  const rewardMul = affix ? affix.xpMul : 1;
  const goldMul = affix ? affix.goldMul : 1;
  const e = makeEnt({
    type:'enemy', kind:typeKey, def,
    x, y, vx:0, vy:0,
    sides:def.sides, color:affix ? affix.color : def.color, baseColor:def.color, r: affix ? def.r * 1.18 : def.r,
    hp: def.hp * tier * hpMul, maxHp: def.hp * tier * hpMul,
    speed: def.speed * speedMul,
    dmg: def.dmg * Math.sqrt(tier) * dmgMul,
    xp: Math.round(def.xp * rewardMul),
    gold: def.gold * goldMul,
    brain: def.brain,
    rot: Math.random()*TAU, rotSpeed:rand(-1,1),
    hitFlash:0,
    hitOrbit:{},
    isDiamond: def.isDiamond,
    state:0, timer:0,
    eliteAffix: affix ? affix.id : null,
    eliteName: affix ? `${affix.name} ${def.name || typeKey}` : (def.name || typeKey),
    eliteColor: affix ? affix.color : null,
  });
  if(affix){
    e.__elitePulse = rand(0, TAU);
    fxRing(e.x, e.y, affix.color, e.r * 3.2, .5);
  }
  return e;
}
export function spawnBoss(typeKey){
  const def = BOSSES_REF[typeKey];
  const a = Math.random()*TAU;
  const distSpawn = 380;
  const x = G.player.x + Math.cos(a)*distSpawn;
  const y = G.player.y + Math.sin(a)*distSpawn;
  // Gentler scaling: first boss at 110s ≈ 0.81x, was 0.84x with old curve.
  // Later bosses still grow, just less steeply.
  // BOSS_HP_MUL: bosses were getting one-shot through evolved/fusion builds —
  // 10× HP makes the encounter actually last and pattern phases land.
  const tier = .45 + G.t/360;
  const BOSS_HP_MUL = 10;
  const e = makeEnt({
    type:'enemy', kind:typeKey, def, isBoss:true,
    x, y, vx:0, vy:0,
    sides:def.sides, color:def.color, r:def.r,
    hp: def.hp * tier * BOSS_HP_MUL, maxHp: def.hp * tier * BOSS_HP_MUL,
    speed: def.speed,
    dmg: def.dmg * Math.sqrt(tier),
    xp: def.xp, gold: def.gold,
    brain: def.brain,
    rot:0, rotSpeed: .8,
    hitFlash:0,
    state:0, timer:0,
    name: def.name,
  });
  G.bossActive = e;
  G.bannerTimer = 1.4;
  document.getElementById('boss-banner').textContent = '▼ ' + def.name + ' ▼';
  document.getElementById('boss-banner').classList.add('show');
  document.getElementById('boss-name').textContent = '▼ ' + def.name + ' ▼';
  document.getElementById('boss-name').style.display = 'block';
  document.getElementById('boss-hp-wrap').style.display = 'block';
  setTimeout(()=> document.getElementById('boss-banner').classList.remove('show'), 1400);
  AUDIO.setMode('boss');
  AUDIO.boss();
  shake(.5);
  return e;
}
export function spawnXP(x,y,amount){
  let kind = 'sm';
  if(amount >= 12) kind = 'lg';
  else if(amount >= 5) kind = 'md';
  if(amount >= 50) kind = 'huge';
  const colorMap = {sm:C.cyan, md:C.lime, lg:C.gold, huge:C.magenta};
  makeEnt({type:'xp', x, y, vx:rand(-40,40), vy:rand(-40,40), amount, kind, color:colorMap[kind], r: kind==='sm'?5: kind==='md'?7: kind==='lg'?9:12, life:60, maxLife:60});
}
export function spawnCoin(x,y){
  makeEnt({type:'coin', x, y, vx:rand(-50,50), vy:rand(-50,50), r:6, color:C.gold, life:30, maxLife:30});
}
export function spawnHeart(x,y){
  makeEnt({type:'heart', x, y, vx:rand(-40,40), vy:rand(-40,40), r:8, color:C.red, life:30, maxLife:30});
}
export function spawnMagnet(x,y){
  makeEnt({type:'magnet', x, y, vx:rand(-40,40), vy:rand(-40,40), r:8, color:C.pink, life:30, maxLife:30});
}
export function spawnFreeze(x,y){
  makeEnt({type:'freeze', x, y, vx:rand(-30,30), vy:rand(-30,30), r:9, color:C.teal, life:30, maxLife:30});
}
export function spawnChest(x,y){
  makeEnt({type:'chest', x, y, r:14, color:C.gold, life:120, maxLife:120});
}
export function spawnShrine(x,y){
  // Mid-run coin sink. Long life so the player can finish the current cluster
  // before walking over. Color is violet to read distinct from chest gold.
  return makeEnt({type:'shrine', x, y, r:22, color:C.violet, life:90, maxLife:90});
}
