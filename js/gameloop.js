/* ===================================================================
   GAMELOOP — update + render + spawn director + entity-type updates.
   =================================================================== */
import {
  G, W, H, TAU, C, RUN_LENGTH_SEC, keys,
  rand, clamp, lerp, choice, hsl, pulse, angTo, fmtTime,
  meta, saveMeta, saveMetaLater,
  updateCamera, setBar, announce,
  app, world, hudC,
} from './core.js';
import { AUDIO } from './audio.js';
import { ANIM_PROFILES, BG, acquireGraphics } from './render.js';
import {
  EGRID, _EQ1, _EQ2,
  makeEnt, fxBurst, fxRing, fxText, fxShockwave, fxLine, shake, flash,
  spawnEnemy, spawnBoss, spawnCoin, spawnShrine,
  fireProjectile, dealDamage, nearestEnemy, nearestEnemyExcept,
  spawnZone, applySlow, applyBurn, applyBleed, applyHex,
  detachSprite,
} from './entities.js';
import {
  damagePlayer, applyItem, dropItem,
  weaponEvoReady, applyEvo, fusionsAvailable, applyFusion,
} from './player.js';
import {
  PASSIVES, SHRINE_TIMES,
} from './data.js';
import { WEAPONS } from './weapons.js';

// Wired by ui.js (avoids hard cycle):
let _doLevelUp = null, _endRun = null, _updateHUD = null, _openChestPick = null, _openShrinePick = null;
// Per-frame weapon-update error counter — bounds noisy console spam when one
// weapon's onUpdate throws repeatedly. Without this declaration the catch
// itself re-throws ReferenceError, breaking the entity loop on every frame.
let _wpnErrCount = 0;
export function setLoopHandlers({ doLevelUp, endRun, updateHUD, openChestPick, openShrinePick }){
  _doLevelUp = doLevelUp; _endRun = endRun; _updateHUD = updateHUD;
  _openChestPick = openChestPick; _openShrinePick = openShrinePick;
}

const _POSE = { ox:0, oy:0, rot:0, sx:1, sy:1, alpha:1, tint:0xffffff };
function _animSeed(o){
  if(o.__animSeed == null) o.__animSeed = Math.random() * TAU;
  return o.__animSeed;
}
function _profileForPlayer(p){
  return ANIM_PROFILES[p.spriteAsset?.animProfile || 'player'] || ANIM_PROFILES.player;
}
function _profileForEntity(e){
  const assetProfile = e.__spriteAsset?.animProfile;
  if(assetProfile && ANIM_PROFILES[assetProfile]) return ANIM_PROFILES[assetProfile];
  if(e.type === 'proj') return ANIM_PROFILES.projectile;
  if(e.isBoss) return ANIM_PROFILES.boss;
  if(e.type === 'enemy') return e.r >= 16 ? ANIM_PROFILES.heavyEnemy : ANIM_PROFILES.lightEnemy;
  return ANIM_PROFILES.pickup;
}
function _computeSpritePose(out, profile, vx, vy, t, seed, baseRot, hitFlash, alpha, tint){
  const ref = profile.speedRef || 1;
  const sx = vx || 0, sy = vy || 0;
  const speed = Math.min(1.35, Math.sqrt(sx*sx + sy*sy) / ref);
  const phase = t * (profile.bobHz || 0) * TAU + seed;
  const bob = (profile.bobAmp || 0) * Math.sin(phase);
  const sway = (profile.swayAmp || 0) * Math.sin(phase * .55 + seed * .37);
  const lean = -Math.max(-1, Math.min(1, sx / ref)) * (profile.leanK || 0);
  const squash = (profile.squashK || 0) * speed;
  const hit = hitFlash > 0 ? Math.min(1, hitFlash / .12) : 0;
  const jolt = (profile.hitJolt || 0) * hit;
  out.ox = 0;
  out.oy = bob - jolt * 5;
  out.rot = baseRot + sway + lean;
  out.sx = Math.max(.2, 1 - squash * .35 + jolt);
  out.sy = Math.max(.2, 1 + squash + jolt * .35);
  out.alpha = alpha == null ? 1 : alpha;
  out.tint = hit > 0 ? 0xffefe0 : (tint == null ? 0xffffff : tint);
}
function _applySpritePose(sprite, x, y, pose){
  const baseX = sprite.__assetScaleX == null ? 1 : sprite.__assetScaleX;
  const baseY = sprite.__assetScaleY == null ? 1 : sprite.__assetScaleY;
  sprite.position.set(x + pose.ox, y + pose.oy);
  sprite.rotation = pose.rot;
  sprite.scale.set(baseX * pose.sx, baseY * pose.sy);
  sprite.alpha = pose.alpha;
  sprite.tint = pose.tint;
}

/* ===================================================================
   UPDATE
   =================================================================== */
export function update(){
  AUDIO.tick();
  EGRID.build(G.ents);
  AUDIO.setCamera(G.cam.x + W/2, G.cam.y + H/2, W);
  {
    const p0 = G.player;
    if(p0){
      let enemyCnt = 0;
      for(let i = 0; i < EGRID.enemies.length; i++){ if(!EGRID.enemies[i].isBoss) enemyCnt++; }
      const hpFrac   = p0.hp / (p0.maxHp || 1);
      const bossBoost = G.bossActive ? 0.35 : 0;
      const intensity = Math.min(1, (enemyCnt / 40) * 0.55 + (1 - hpFrac) * 0.35 + bossBoost + Math.min(0.25, G.t/600));
      AUDIO.setIntensity(intensity);
    }
  }
  const p = G.player; if(!p) return;
  // input vector
  let dx = 0, dy = 0;
  if(keys['w']||keys['arrowup'])    dy -= 1;
  if(keys['s']||keys['arrowdown'])  dy += 1;
  if(keys['a']||keys['arrowleft'])  dx -= 1;
  if(keys['d']||keys['arrowright']) dx += 1;
  const len = Math.hypot(dx,dy);
  if(len>0){ dx/=len; dy/=len; }
  // Effective movement speed: includes BATTERY consumable boost, clamped so a
  // stack of buffs can't punt the player off-screen faster than camera can follow.
  // (Original code applied boost AFTER movement and immediately restored — so
  // speed boosts didn't actually affect player position. Fix: compute inline.)
  if(p._eliteSlowTimer > 0) p._eliteSlowTimer -= G.dt;
  const eliteSlowMul = p._eliteSlowTimer > 0 ? 0.72 : 1;
  const moveSpeed = Math.min(p.speed * (p._boostSpdMul || 1) * eliteSlowMul, 720);
  p.vx = dx * moveSpeed;
  p.vy = dy * moveSpeed;
  p.x += p.vx * G.dt;
  p.y += p.vy * G.dt;
  if(len>0) p.faceA = Math.atan2(dy,dx);
  p.rot += G.dt * 1.5;
  p.trail.push({x:p.x, y:p.y, t:G.realT});
  if(p.trail.length > 16) p.trail.shift();
  if(p.regen > 0 && p.hp < p.maxHp){ p.hp = Math.min(p.maxHp, p.hp + p.regen * G.dt); }
  if(p.invuln > 0) p.invuln -= G.dt;
  if(p._boostSpd > 0)    { p._boostSpd    -= G.dt; if(p._boostSpd <= 0) p._boostSpdMul = 1; }
  if(p._boostCdr > 0)    { p._boostCdr    -= G.dt; if(p._boostCdr <= 0) p._boostCdrMul = 1; }
  if(p._boostDmg > 0)    { p._boostDmg    -= G.dt; if(p._boostDmg <= 0) p._boostDmgMul = 1; }
  if(p._boostInvuln > 0) { p._boostInvuln -= G.dt; p.invuln = Math.max(p.invuln, .12); }
  if(p._streakActive > 0){ p._streakActive -= G.dt; if(p._streakActive <= 0) p._streakActive = 0; }
  // DASH CHIP: periodic auto-iframe burst.
  if(p._autoDashOn){
    p._autoDashTimer = (p._autoDashTimer == null ? p._autoDashCd : p._autoDashTimer) - G.dt;
    if(p._autoDashTimer <= 0){
      p.invuln = Math.max(p.invuln, .4);
      p._autoDashTimer = p._autoDashCd;
    }
  }
  const _origDmg = p.dmgMul, _origCd = p.cdMul;
  if(p._boostDmgMul && p._boostDmgMul !== 1) p.dmgMul = _origDmg * p._boostDmgMul;
  if(p._boostCdrMul && p._boostCdrMul !== 1) p.cdMul  = _origCd  * p._boostCdrMul;
  const _origSp = p.speed;
  if(p._boostSpdMul && p._boostSpdMul !== 1) p.speed  = _origSp  * p._boostSpdMul;
  // Per-weapon try/catch: a single bad weapon (commonly a fusion whose
  // delegated onUpdate reads a stat that's missing in the fused baseStats)
  // must not bubble out and skip the entity loop. That symptom = "player
  // moves but enemies freeze" — exactly what users were reporting.
  for(const w of p.weapons){
    try { w.def.onUpdate(p, w); }
    catch(err){
      if(_wpnErrCount < 30){
        _wpnErrCount++;
        console.warn('[wpn]', w.key, w.isFusion ? '(fusion)' : '', err?.message||err);
      }
    }
  }
  p.dmgMul = _origDmg; p.cdMul = _origCd; p.speed = _origSp;
  _autoEvoFuse(p);
  // entity update
  const ents = G.ents;
  const freezeMul = G.freezeTimer > 0 ? .15 : 1;
  if(G.freezeTimer > 0) G.freezeTimer -= G.dt;
  for(const e of ents){
    if(!e.alive) continue;
    e.t += G.dt;
    if(e.hitFlash > 0) e.hitFlash -= G.dt;
    if(e.type === 'enemy') updateEnemy(e, freezeMul);
    else if(e.type === 'proj') updateProjectile(e);
    else if(e.type === 'fx'){
      e.vx *= .92; e.vy *= .92;
      e.x += e.vx * G.dt; e.y += e.vy * G.dt;
      e.life -= G.dt; if(e.life<=0) e.alive=false;
    }
    else if(e.type === 'ring' || e.type === 'shock'){
      const k = 1 - e.life/e.maxLife;
      e.r = lerp(8, e.maxR, k);
      e.life -= G.dt; if(e.life<=0) e.alive=false;
    }
    else if(e.type === 'fan'){
      e.life -= G.dt; if(e.life<=0) e.alive=false;
    }
    else if(e.type === 'line'){
      e.life -= G.dt; if(e.life<=0) e.alive=false;
    }
    else if(e.type === 'zone'){
      updateZone(e);
    }
    else if(e.type === 'text'){
      e.y += e.vy * G.dt; e.vy *= .98;
      e.life -= G.dt; if(e.life<=0) e.alive=false;
    }
    else if(e.type === 'blackhole'){
      e.life -= G.dt;
      if(e.life<=0){
        const col = e.color || C.violet;
        fxShockwave(e.x,e.y,col,e.r*1.4,.6); AUDIO.explode(e.x,e.y); shake(.2);
        // SUPERNOVA implode: AOE detonation at expiry
        if(e.implodeBurst && e.implodeR){
          fxRing(e.x, e.y, C.gold, e.implodeR, .5);
          fxBurst(e.x, e.y, C.gold, 24, 280, 4, .5);
          flash(C.gold, .25);
          const burstList = EGRID.query(e.x, e.y, e.implodeR + 40, _EQ1);
          for(let bi = 0; bi < burstList.length; bi++){
            const en = burstList[bi];
            if(!en.alive) continue;
            const dx2 = en.x - e.x, dy2 = en.y - e.y;
            if(dx2*dx2 + dy2*dy2 <= e.implodeR * e.implodeR){
              dealDamage(en, e.implodeBurst, C.gold);
            }
          }
        }
        e.alive=false;
      }
      const elist = EGRID.query(e.x, e.y, e.r, _EQ1);
      const rSq = e.r * e.r;
      for(let bi = 0; bi < elist.length; bi++){
        const en = elist[bi];
        if(!en.alive) continue;
        const ddx = en.x - e.x, ddy = en.y - e.y;
        const d2 = ddx*ddx + ddy*ddy;
        if(d2 < rSq){
          const d = Math.sqrt(d2);
          const a = Math.atan2(-ddy, -ddx);
          const f = (1 - d/e.r) * e.pull;
          en.vx += Math.cos(a)*f*G.dt*60;
          en.vy += Math.sin(a)*f*G.dt*60;
          en._bhTimer = (en._bhTimer||0) + G.dt;
          if(en._bhTimer >= .25){ en._bhTimer = 0; dealDamage(en, e.dmgPerSec * .25, C.violet); }
        }
      }
      const pickR = e.r * 1.5, pickR2 = pickR * pickR;
      for(let pi = 0; pi < ents.length; pi++){
        const en = ents[pi];
        if(en.type !== 'xp' && en.type !== 'coin') continue;
        const ddx = en.x - e.x, ddy = en.y - e.y;
        if(ddx*ddx + ddy*ddy < pickR2){
          const a = Math.atan2(-ddy, -ddx);
          en.vx += Math.cos(a) * 200 * G.dt;
          en.vy += Math.sin(a) * 200 * G.dt;
        }
      }
    }
    else if(e.type === 'xp' || e.type === 'coin' || e.type === 'heart' || e.type === 'magnet' || e.type === 'freeze' || e.type === 'item'){
      e.vx *= .94; e.vy *= .94;
      e.x += e.vx * G.dt; e.y += e.vy * G.dt;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      const range = (e.type==='xp' ? p.magnet : e.type==='coin' ? p.magnet*1.2 : e.type==='item' ? 280 : 220) * G.pickupMagnetMul;
      if(G.superMagnetTimer > 0){
        // Super magnet — directly drive pickup velocity toward player at high speed.
        // Additive forces couldn't overcome dampening across the whole map; this
        // makes the buff feel like a true vacuum, not a nudge.
        const a = Math.atan2(p.y-e.y, p.x-e.x);
        e.vx = Math.cos(a) * 1200;
        e.vy = Math.sin(a) * 1200;
      } else if(d < range){
        const a = Math.atan2(p.y-e.y, p.x-e.x);
        const sp = 360 * (1 - d/range + .2);
        e.vx += Math.cos(a)*sp;
        e.vy += Math.sin(a)*sp;
      }
      if(d < p.r + e.r){
        if(e.type==='xp'){ const gained = Math.round(e.amount * (p.xpGainMul||1)); p.xp += gained; AUDIO.pickup(e.x); fxText(e.x,e.y,'+'+gained, e.color); }
        else if(e.type==='coin'){ const m = p.coinMul||1; const amt = Math.floor(m) + (Math.random() < (m - Math.floor(m)) ? 1 : 0) || 1; G.coinsRun += amt; meta.coins += amt; saveMetaLater(); AUDIO.pickup(e.x); fxText(e.x,e.y, amt>1?('◆×'+amt):'◆', C.gold); }
        else if(e.type==='heart'){ p.hp = Math.min(p.maxHp, p.hp + 25); AUDIO.heal(); fxText(e.x,e.y,'+25 HP', C.red); }
        else if(e.type==='magnet'){ G.superMagnetTimer = 8; AUDIO.pickup(); announce('MAGNET ACTIVE', 1); }
        else if(e.type==='freeze'){ G.freezeTimer = 5; AUDIO.freeze(); announce('TIME FREEZE', 1); }
        else if(e.type==='item'){ applyItem(p, e.item.id); }
        e.alive = false;
        if(p.xp >= p.xpNext){ if(_doLevelUp) _doLevelUp(); }
      }
      e.life -= G.dt; if(e.life <= 0) e.alive = false;
    }
    else if(e.type === 'chest'){
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if(d < p.r + e.r){
        e.alive = false;
        AUDIO.level();
        p.xp += 30;
        G.coinsRun += 5; meta.coins += 5; saveMetaLater();
        for(let i=0;i<10;i++){ const a = Math.random()*TAU; spawnCoin(e.x + Math.cos(a)*30, e.y + Math.sin(a)*30); }
        announce('▼ 보물 ▼', 1.4);
        // Chest now opens a 3-item pick screen instead of auto-applying a random one.
        if(_openChestPick) _openChestPick();
        else if(_doLevelUp) _doLevelUp(true);
      }
    }
    else if(e.type === 'shrine'){
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if(d < p.r + e.r){
        e.alive = false;
        AUDIO.level();
        announce('◈ 제단 활성화 ◈', 1.4);
        if(_openShrinePick) _openShrinePick();
      }
    }
    if(G.superMagnetTimer > 0) G.superMagnetTimer -= G.dt;
    _syncEntitySprite(e);
  }
  updateEnemyBullets();
  updateCamera();
  // player sprite sync (player is not in G.ents)
  if(p && p.sprite){
    const blink = p.invuln > 0 && (Math.floor(G.realT*16)%2===0);
    _computeSpritePose(_POSE, _profileForPlayer(p), p.vx, p.vy, G.realT, _animSeed(p), p.spriteAsset ? 0 : p.rot, 0, blink ? .35 : 1, 0xffffff);
    _applySpritePose(p.sprite, p.x, p.y, _POSE);
    if(p.dotSprite) p.dotSprite.position.set(p.x, p.y);
    if(p.dotSprite) p.dotSprite.alpha = p.spriteAsset ? 0 : (blink ? .35 : 1);
    if(p.dotSprite) p.dotSprite.visible = !p.spriteAsset;
    // Trail — fading line through trail points (each segment has its own alpha).
    if(p.trailGfx){
      p.trailGfx.clear();
      for(let i = 0; i < p.trail.length - 1; i++){
        const ta = p.trail[i], tb = p.trail[i+1];
        const k = i / p.trail.length;
        p.trailGfx.moveTo(ta.x, ta.y);
        p.trailGfx.lineTo(tb.x, tb.y);
        p.trailGfx.stroke({ color: p.color, alpha: k * .5, width: 1 + k*4 });
      }
    }
    // Beams + orbit nodes — per-frame redraw based on weapon state.
    // Match by def.kind so evolved BEAMs and fusion BEAMs (PRISM_HALO,
    // EVENT_LANCE, STAR_FORGE — kind:'BEAM') all render here. Same for ORBIT
    // fusions (VOID_PULSAR, RESONANT_RING — kind:'ORBIT').
    if(p.beamGfx){
      p.beamGfx.clear();
      for(const w of p.weapons){
        if(w.def && w.def.kind === 'BEAM' && w.beams && w.beams.length){
          const bw = w.stats.width || 3;
          const beamCol = w.color || '#ffd400';
          for(const b of w.beams){
            if(!b) continue;
            p.beamGfx.moveTo(b.x1, b.y1); p.beamGfx.lineTo(b.x2, b.y2);
            p.beamGfx.stroke({ color: 0x100604, alpha: .55, width: bw + 18 });
            p.beamGfx.moveTo(b.x1, b.y1); p.beamGfx.lineTo(b.x2, b.y2);
            p.beamGfx.stroke({ color: beamCol, alpha: .62, width: bw + 7 });
            p.beamGfx.moveTo(b.x1, b.y1); p.beamGfx.lineTo(b.x2, b.y2);
            p.beamGfx.stroke({ color: 0xfff4d0, alpha: .9, width: Math.max(2, bw*.45) });
          }
        }
        if(w.def && w.def.kind === 'ORBIT' && w.lastNodes){
          const nodeCol = w.color || '#9b5cff';
          const nr = w.stats.nodeR || 10;
          for(const n of w.lastNodes){
            if(!n) continue;
            p.beamGfx.circle(n.x, n.y, nr);
            p.beamGfx.fill({ color: 0x070504, alpha: .72 });
            p.beamGfx.circle(n.x, n.y, nr);
            p.beamGfx.stroke({ color: nodeCol, alpha: .9, width: 2.4 });
            p.beamGfx.circle(n.x, n.y, nr*.42);
            p.beamGfx.stroke({ color: 0xfff4d0, alpha: .5, width: 1.2 });
            p.beamGfx.moveTo(p.x, p.y); p.beamGfx.lineTo(n.x, n.y);
            p.beamGfx.stroke({ color: nodeCol, alpha: .18, width: 1.2 });
          }
        }
      }
    }
  }
  // cleanup — swap-and-pop, detach sprites for dying entities
  { const arr = G.ents; let wi = 0; for(let ri = 0; ri < arr.length; ri++){
      if(arr[ri].alive){ arr[wi++] = arr[ri]; }
      else { detachSprite(arr[ri]); }
    } arr.length = wi; }
  G.shake = Math.max(0, G.shake * Math.pow(.001, G.dt));
  G.flash = Math.max(0, G.flash - G.dt * .8);
  if(G.comboTimer > 0){ G.comboTimer -= G.dt; if(G.comboTimer <= 0) G.combo = 0; }
  spawnDirector();
  shrineDirector();
  // Pause boss interval timer during a fight — otherwise a long boss kill
  // burns the cooldown and the next boss spawns the instant the previous
  // one dies, giving zero breather. (Player feedback: "back-to-back bosses".)
  if(!G.bossActive) G.bossTimer += G.dt;
  // First boss at 110s, then every 120s of NON-fight time. Was 90s but felt
  // too dense at high levels — XP curve change pairs with longer breaks.
  const FIRST_BOSS_AT = 110, BOSS_INTERVAL = 120;
  const firstReady = G.t >= FIRST_BOSS_AT;
  const intervalReady = G.bossTimer >= BOSS_INTERVAL && G.t >= FIRST_BOSS_AT;
  if(!G.bossActive && firstReady && intervalReady){
    // Cycle by spawn count, not time, so each boss appears in order regardless
    // of how long previous fights took. RING_LORD → SPIKE_KING → HYDRA →
    // PRISMA → loop.
    const order = ['RING_LORD','SPIKE_KING','HYDRA','PRISMA'];
    G.bossCount = (G.bossCount || 0);
    spawnBoss(order[G.bossCount % order.length]);
    G.bossCount++;
    G.bossTimer = 0;
  } else if(!G.bossActive && !firstReady){
    // pre-first-boss: keep timer pegged so post-FIRST_BOSS_AT triggers immediately on next interval
    G.bossTimer = BOSS_INTERVAL;
  }
  if(G.t >= RUN_LENGTH_SEC){ if(_endRun) _endRun(true); }
  if(_updateHUD) _updateHUD();
}

function updateEnemy(e, freezeMul){
  const p = G.player;
  if(!updateStatusEffects(e)) return;
  if(e.brain === 'chase'){
    const a = Math.atan2(p.y - e.y, p.x - e.x);
    e.vx = lerp(e.vx, Math.cos(a) * e.speed, .14);
    e.vy = lerp(e.vy, Math.sin(a) * e.speed, .14);
  } else if(e.brain === 'shooter'){
    const d = Math.hypot(p.x - e.x, p.y - e.y);
    const targetD = 240;
    const a = Math.atan2(p.y - e.y, p.x - e.x);
    const move = d > targetD+30 ? 1 : (d < targetD-30 ? -.6 : 0);
    e.vx = lerp(e.vx, Math.cos(a) * e.speed * move, .12);
    e.vy = lerp(e.vy, Math.sin(a) * e.speed * move, .12);
    e.timer -= G.dt;
    if(e.timer <= 0){
      e.timer = 1.2;
      const angle = Math.atan2(p.y - e.y, p.x - e.x);
      makeEnt({type:'ebullet', x:e.x, y:e.y, vx:Math.cos(angle)*200, vy:Math.sin(angle)*200, color:C.gold, r:5, dmg:e.dmg, life:3, maxLife:3});
    }
  } else if(e.brain === 'dasher'){
    e.timer -= G.dt;
    if(e.state===0){
      const a = Math.atan2(p.y - e.y, p.x - e.x);
      e.vx = lerp(e.vx, Math.cos(a) * e.speed * .5, .12);
      e.vy = lerp(e.vy, Math.sin(a) * e.speed * .5, .12);
      if(e.timer <= 0){ e.timer = .35; e.state = 1; e.dashA = Math.atan2(p.y-e.y, p.x-e.x); }
    } else {
      e.vx = Math.cos(e.dashA) * e.speed * 2.6;
      e.vy = Math.sin(e.dashA) * e.speed * 2.6;
      if(e.timer <= 0){ e.timer = 1.6; e.state = 0; }
    }
  } else if(e.brain === 'healer'){
    const a = Math.atan2(p.y - e.y, p.x - e.x);
    e.vx = lerp(e.vx, Math.cos(a) * e.speed * .6, .1);
    e.vy = lerp(e.vy, Math.sin(a) * e.speed * .6, .1);
    e.timer -= G.dt;
    if(e.timer <= 0){
      e.timer = 1.5;
      const list = EGRID.query(e.x, e.y, 140, _EQ2);
      for(let li = 0; li < list.length; li++){
        const al = list[li];
        if(al === e || !al.alive) continue;
        const dxh = al.x - e.x, dyh = al.y - e.y;
        if(dxh*dxh + dyh*dyh < 140*140){
          al.hp = Math.min(al.maxHp, al.hp + 15);
          fxLine(e.x, e.y, al.x, al.y, C.teal, .3, 2);
        }
      }
    }
  } else if(e.brain === 'ringboss'){
    if(e.timer == null) e.timer = 2.8;
    e.timer -= G.dt;
    const a = Math.atan2(p.y - e.y, p.x - e.x) + Math.PI*.4;
    e.vx = lerp(e.vx, Math.cos(a) * e.speed, .07);
    e.vy = lerp(e.vy, Math.sin(a) * e.speed, .07);
    if(e.timer > 0 && e.timer < .6){
      e._ringTelegraph = 1;
      if(e._telegraphFlash == null || G.t - e._telegraphFlash > .15){
        e._telegraphFlash = G.t;
        fxRing(e.x, e.y, C.magenta, 60 + (1-e.timer/.6)*80, .25);
      }
    }
    if(e.timer <= 0){
      e.timer = 2.6;
      e._ringTelegraph = 0;
      const n = 14;
      const off = Math.random()*TAU;
      for(let i=0;i<n;i++){
        const ang = off + i*TAU/n;
        makeEnt({type:'ebullet', x:e.x, y:e.y, vx:Math.cos(ang)*150, vy:Math.sin(ang)*150, color:C.magenta, r:5, dmg:e.dmg*.6, life:3.4, maxLife:3.4});
      }
      AUDIO.boss();
    }
  } else if(e.brain === 'spikeboss'){
    const a = Math.atan2(p.y - e.y, p.x - e.x);
    e.vx = lerp(e.vx, Math.cos(a) * e.speed, .12);
    e.vy = lerp(e.vy, Math.sin(a) * e.speed, .12);
    e.timer -= G.dt;
    if(e.timer <= 0){
      e.timer = 2.4;
      const n = 12;
      for(let i=0;i<n;i++){
        const ang = i*TAU/n + Math.random()*.05;
        makeEnt({type:'ebullet', x:e.x, y:e.y, vx:Math.cos(ang)*240, vy:Math.sin(ang)*240, color:C.red, r:6, dmg:e.dmg*.8, life:2.2, maxLife:2.2});
      }
      shake(.2); AUDIO.boss();
    }
  } else if(e.brain === 'hydraboss'){
    const a = Math.atan2(p.y - e.y, p.x - e.x);
    e.vx = lerp(e.vx, Math.cos(a) * e.speed, .08);
    e.vy = lerp(e.vy, Math.sin(a) * e.speed, .08);
    e.timer -= G.dt;
    if(e.timer <= 0){
      e.timer = 2.0;
      for(let i=0;i<4;i++){
        const ang = i*TAU/4 + e.t;
        spawnEnemy('SWARM', e.x + Math.cos(ang)*40, e.y + Math.sin(ang)*40);
      }
      AUDIO.boss();
    }
  } else if(e.brain === 'prismaboss'){
    const a = Math.atan2(p.y - e.y, p.x - e.x) + Math.PI*.5;
    e.vx = lerp(e.vx, Math.cos(a) * e.speed, .06);
    e.vy = lerp(e.vy, Math.sin(a) * e.speed, .06);
    e.timer -= G.dt;
    if(e.timer <= 0){
      e.timer = 1.0;
      e.state = (e.state||0) ^ 1;
      if(e.state){
        const aa = Math.atan2(p.y-e.y, p.x-e.x);
        for(let i=-2;i<=2;i++){
          const ang = aa + i*.16;
          makeEnt({type:'ebullet', x:e.x, y:e.y, vx:Math.cos(ang)*260, vy:Math.sin(ang)*260, color:C.gold, r:6, dmg:e.dmg, life:2.5, maxLife:2.5});
        }
      } else {
        for(let i=0;i<10;i++){
          const ang = i*TAU/10 + e.t;
          makeEnt({type:'ebullet', x:e.x, y:e.y, vx:Math.cos(ang)*200, vy:Math.sin(ang)*200, color:C.gold, r:5, dmg:e.dmg*.7, life:3, maxLife:3});
        }
      }
      AUDIO.boss();
    }
  }
  if(e.eliteAffix){
    e._eliteFxT = (e._eliteFxT || 0) - G.dt;
    if(e._eliteFxT <= 0){
      e._eliteFxT = e.eliteAffix === 'frostbound' ? .45 : .75;
      fxRing(e.x, e.y, e.eliteColor || e.color, e.r * (e.eliteAffix === 'frostbound' ? 5.2 : 3.4), .28);
    }
    if(e.eliteAffix === 'frostbound'){
      const dxs = e.x - p.x, dys = e.y - p.y;
      const slowR = 170;
      if(dxs*dxs + dys*dys < slowR*slowR){
        p._eliteSlowTimer = Math.max(p._eliteSlowTimer || 0, .22);
      }
    }
  }
  e.vx *= .985; e.vy *= .985;
  // slow effect from evolved weapons (e.g. GLACIAL RING). Decays via slowTime.
  let mul = freezeMul;
  if(e.slowTime > 0){
    e.slowTime -= G.dt;
    if(e.slowTime <= 0){ e.slowMul = null; e.slowTime = 0; }
    else if(e.slowMul != null) mul *= e.slowMul;
  }
  e.x += e.vx * G.dt * mul;
  e.y += e.vy * G.dt * mul;
  e.rot += (e.rotSpeed||1) * G.dt * (e.brain==='dasher' && e.state===1 ? 6 : 1);
  {
    const cdx = e.x - p.x, cdy = e.y - p.y;
    const crr = p.r + e.r - 2;
    if(cdx*cdx + cdy*cdy < crr*crr){
      damagePlayer(e.dmg);
      const a = Math.atan2(cdy, cdx);
      e.vx += Math.cos(a)*120; e.vy += Math.sin(a)*120;
    }
  }
}
function updateStatusEffects(e){
  if(e.burnTime > 0){
    e.burnTime -= G.dt;
    e._burnTick = (e._burnTick || .35) - G.dt;
    if(e._burnTick <= 0){
      e._burnTick = .5;
      dealDamage(e, (e.burnDps || 0) * .5, e.burnColor || C.red);
      if(!e.alive) return false;
      fxBurst(e.x, e.y, e.burnColor || C.red, 2, 55, 1.8, .18);
    }
    if(e.burnTime <= 0){ e.burnDps = 0; e.burnTime = 0; }
  }
  if(e.bleedTime > 0){
    e.bleedTime -= G.dt;
    e._bleedTick = (e._bleedTick || .5) - G.dt;
    if(e._bleedTick <= 0){
      e._bleedTick = .55;
      dealDamage(e, (e.bleedDps || 0) * .55, e.bleedColor || C.red);
      if(!e.alive) return false;
    }
    if(e.bleedTime <= 0){ e.bleedDps = 0; e.bleedTime = 0; }
  }
  if(e.hexTime > 0){
    e.hexTime -= G.dt;
    if(e.hexTime <= 0){ e.hexDmg = 0; e.hexR = 0; e.hexTime = 0; }
  }
  return true;
}
function updateZone(e){
  e.life -= G.dt;
  if(e.life <= 0){ e.alive = false; return; }
  e.tick = (e.tick || 0) - G.dt;
  const tickRate = e.tickRate || .35;
  const shouldTick = e.tick <= 0;
  if(shouldTick) e.tick = tickRate;
  const list = EGRID.query(e.x, e.y, e.r + 40, _EQ1);
  const rSq = e.r * e.r;
  for(let zi = 0; zi < list.length; zi++){
    const en = list[zi];
    if(!en.alive) continue;
    const dx = en.x - e.x, dy = en.y - e.y;
    const d2 = dx*dx + dy*dy;
    if(d2 > rSq) continue;
    if(e.pull && !en.isBoss){
      const dist = Math.sqrt(d2) + .01;
      const f = (1 - dist/e.r) * e.pull * G.dt;
      en.vx += (-dx/dist) * f;
      en.vy += (-dy/dist) * f;
    }
    if(e.slow) applySlow(en, e.slow, e.slowDur || .5);
    if(shouldTick && e.dmgPerSec){
      dealDamage(en, e.dmgPerSec * tickRate, e.color);
      if(!en.alive) continue;
      if(e.burnDps) applyBurn(en, e.burnDps, e.burnDur || 1, e.color);
      if(e.bleedDps) applyBleed(en, e.bleedDps, e.bleedDur || 1, e.color);
    }
  }
}
function updateProjectile(pr){
  pr.life -= G.dt;
  if(pr.life <= 0){
    if(pr.expireZone) spawnZone(pr.x, pr.y, pr.expireZone.r, pr.expireZone.life, pr.expireZone.dmg, pr.color, pr.expireZone);
    pr.alive = false; return;
  }
  if(pr.returnToPlayer && !pr.returning && pr.life <= pr.maxLife * (pr.returnAt || .45)){
    pr.returning = true;
    pr.hits = new Set();
  }
  if(pr.returning && G.player){
    const a = angTo(pr, G.player);
    pr.vx = Math.cos(a) * pr.speed;
    pr.vy = Math.sin(a) * pr.speed;
    if(Math.hypot(pr.x - G.player.x, pr.y - G.player.y) < G.player.r + 6){
      pr.alive = false; return;
    }
  }
  if(pr.subtype === 'homing' && pr.target){
    if(!pr.target.alive){ pr.target = nearestEnemy(pr); }
    if(pr.target){
      const a = angTo(pr, pr.target);
      const cur = Math.atan2(pr.vy, pr.vx);
      let diff = ((a - cur) % TAU + Math.PI*3) % TAU - Math.PI;
      const turn = pr.turn * G.dt;
      const newA = cur + clamp(diff, -turn, turn);
      pr.vx = Math.cos(newA) * pr.speed;
      pr.vy = Math.sin(newA) * pr.speed;
    }
  }
  if(pr.trailZone){
    pr._trailT = (pr._trailT || 0) - G.dt;
    if(pr._trailT <= 0){
      pr._trailT = pr.trailZone.every || .16;
      spawnZone(pr.x, pr.y, pr.trailZone.r || 28, pr.trailZone.life || .9, pr.trailZone.dmg || 8, pr.color, pr.trailZone);
    }
  }
  pr.x += pr.vx * G.dt;
  pr.y += pr.vy * G.dt;
  pr.spin += G.dt * 8;
  const _pList = EGRID.query(pr.x, pr.y, pr.r + 40, _EQ1);
  for(let pi = 0; pi < _pList.length; pi++){
    const e = _pList[pi];
    if(!e.alive) continue;
    if(pr.hits.has(e)) continue;
    const dx = pr.x - e.x, dy = pr.y - e.y;
    const rr = pr.r + e.r;
    if(dx*dx + dy*dy < rr*rr){
      dealDamage(e, pr.dmg, pr.color);
      fxBurst(pr.x, pr.y, pr.color, 4, 100, 2, .2);
      if(pr.slow) applySlow(e, pr.slow, pr.slowDur || 1);
      if(pr.burnDps) applyBurn(e, pr.burnDps, pr.burnDur || 1, pr.color);
      if(pr.bleedDps) applyBleed(e, pr.bleedDps, pr.bleedDur || 1, pr.color);
      if(pr.hexDmg) applyHex(e, pr.hexDmg, pr.hexR || 90, pr.hexDur || 2, pr.color);
      if(pr.blastR && pr.blastDmg){
        fxRing(pr.x, pr.y, pr.color, pr.blastR, .28);
        const blast = EGRID.query(pr.x, pr.y, pr.blastR + 40, _EQ2);
        for(let bi = 0; bi < blast.length; bi++){
          const o = blast[bi];
          if(!o.alive || o === e) continue;
          const bdx = o.x - pr.x, bdy = o.y - pr.y;
          if(bdx*bdx + bdy*bdy <= pr.blastR * pr.blastR) dealDamage(o, pr.blastDmg, pr.color);
        }
      }
      if(pr.impactZone) spawnZone(pr.x, pr.y, pr.impactZone.r, pr.impactZone.life, pr.impactZone.dmg, pr.color, pr.impactZone);
      pr.hits.add(e);
      if(pr.subtype === 'prism' && pr.splits > 0){
        const n = pr.splits;
        const splitHits = new Set([e]);
        for(let i=0;i<n;i++){
          const tgt = nearestEnemyExcept(pr, splitHits, pr.splitRange || 360);
          const a = tgt ? angTo(pr, tgt) : Math.random()*TAU;
          if(tgt) splitHits.add(tgt);
          fireProjectile(pr.x, pr.y, a, pr.speed*.92, pr.dmg*.58, Math.max(.45, pr.life*.75), pr.color, pr.splitKind || 'bullet', {
            target:tgt || null,
            turn:pr.homingSplit ? (pr.turn || 4) : 0,
            splits:pr.subSplit || 0,
            subSplit:0,
            r:5,
          });
        }
        fxRing(pr.x, pr.y, pr.color, 46, .25);
        pr.alive = false; return;
      }
      if(pr.pierce > 0){ pr.pierce--; }
      else { pr.alive = false; return; }
    }
  }
}
/* ───────── AUTO-EVO / AUTO-FUSE ─────────
   Polls every 0.5s. Once a weapon hits maxLv + required passive at maxLv, the
   evolution fires automatically with the dramatic FX baked into applyEvo (no
   extra "EVOLVE" card on the next level-up). Fusions trigger when both
   source weapons are evolved + maxLv. A short hitstop frames the moment so
   it doesn't feel like a silent stat swap. */
function _autoEvoFuse(p){
  if(p._autoEvoT == null) p._autoEvoT = 0;
  p._autoEvoT -= G.dt;
  if(p._autoEvoT > 0) return;
  p._autoEvoT = 0.5;
  // Fusion first — it consumes source weapons, so do it before re-checking evo.
  const fuses = fusionsAvailable(p);
  if(fuses.length){
    applyFusion(p, fuses[0]);
    G.hitstop = Math.max(G.hitstop, 0.35);
    return;
  }
  for(const w of p.weapons){
    if(w.evolved || w.level < w.def.maxLv) continue;
    const ready = weaponEvoReady(p, w);
    if(ready.length){
      applyEvo(p, w.key, ready[0].id);
      G.hitstop = Math.max(G.hitstop, 0.3);
      return;
    }
  }
}

function updateEnemyBullets(){
  const p = G.player;
  const ents = G.ents;
  // ORBIT defensive role: pre-collect active orbit-kind weapon nodes so ebullets
  // can be blocked on contact. Covers base ORBIT, evolved variants (VOID_HALO /
  // SOLAR_CORONA / LIFE_BLOOM) and fusions with kind:'ORBIT' (VOID_PULSAR,
  // RESONANT_RING). All set w.lastNodes in their onUpdate.
  const orbitNodes = [];
  if(p && p.weapons){
    for(const w of p.weapons){
      if((w.def && w.def.kind === 'ORBIT') && w.lastNodes){
        const nr = (w.stats && w.stats.nodeR) || 12;
        for(const n of w.lastNodes){ if(n) orbitNodes.push(n.x, n.y, nr); }
      }
    }
  }
  const orbN = orbitNodes.length;
  for(let i = 0; i < ents.length; i++){
    const b = ents[i];
    if(b.type !== 'ebullet' || !b.alive) continue;
    b.life -= G.dt; if(b.life<=0){ b.alive=false; continue; }
    b.x += b.vx * G.dt; b.y += b.vy * G.dt;
    // ORBIT shield: block + spark on contact. Triplet stride (x,y,r).
    let blocked = false;
    for(let k = 0; k < orbN; k += 3){
      const ddx = b.x - orbitNodes[k], ddy = b.y - orbitNodes[k+1];
      const rr = orbitNodes[k+2] + b.r;
      if(ddx*ddx + ddy*ddy < rr*rr){
        fxBurst(b.x, b.y, b.color, 6, 110, 2, .22);
        fxRing(b.x, b.y, C.violet, 22, .22);
        b.alive = false;
        blocked = true;
        break;
      }
    }
    if(blocked) continue;
    if(p){
      const dxb = b.x - p.x, dyb = b.y - p.y;
      const rr = p.r + b.r;
      if(dxb*dxb + dyb*dyb < rr*rr){
        damagePlayer(b.dmg);
        fxBurst(b.x, b.y, b.color, 6, 120, 2, .25);
        b.alive = false;
      }
    }
    if(b.alive && b.sprite) b.sprite.position.set(b.x, b.y);
  }
}

/* ───────── SPRITE SYNC ─────────
   Called once per frame per alive entity at the end of the update loop.
   Position mirrors e.x/e.y; rotation and texture-swap (hitFlash) are
   type-specific. Types not yet migrated to sprites (fx/ring/shock/etc.)
   have no e.sprite and fall through. */
function _syncEntitySprite(e){
  const sp = e.sprite;
  if(!sp) return;
  if(e.type === 'ebullet') return; // synced inside updateEnemyBullets after position update

  // Static-sprite types: position follows e.x,e.y. Graphics-redraw types use e.x,e.y inside draw.
  const gfxType = e.type === 'ring' || e.type === 'shock' || e.type === 'fan' || e.type === 'line' || e.type === 'blackhole' || e.type === 'zone';
  if(!gfxType && e.type !== 'enemy' && e.type !== 'proj') sp.position.set(e.x, e.y);

  if(e.type === 'enemy'){
    const visualPulse = e.__spriteAsset && e.eliteAffix
      ? 1 + Math.sin(G.realT * 5 + (e.__elitePulse || 0)) * .04
      : 1;
    if(e.__spriteAsset){
      _computeSpritePose(_POSE, _profileForEntity(e), e.vx, e.vy, G.realT, _animSeed(e), (e.rot || 0) * .08, e.hitFlash, 1, 0xffffff);
      _POSE.sx *= visualPulse;
      _POSE.sy *= visualPulse;
      _applySpritePose(sp, e.x, e.y, _POSE);
    } else {
      const wantFlash = e.hitFlash > 0;
      if(wantFlash && e.__flashTex && sp.texture !== e.__flashTex.texture) sp.texture = e.__flashTex.texture;
      else if(!wantFlash && e.__normTex && sp.texture !== e.__normTex.texture) sp.texture = e.__normTex.texture;
      _computeSpritePose(_POSE, _profileForEntity(e), e.vx, e.vy, G.realT, _animSeed(e), e.rot || 0, e.hitFlash, 1, 0xffffff);
      _applySpritePose(sp, e.x, e.y, _POSE);
    }
    if(e.auraSprite){
      e.auraSprite.position.set(e.x, e.y);
      e.auraSprite.alpha = .35 + Math.sin(G.realT*3) * .12;  // breathing pulse
    }
  } else if(e.type === 'proj'){
    const baseRot = e.subtype === 'shuriken' ? e.spin : Math.atan2(e.vy, e.vx);
    const drift = e.__spriteAsset ? (e.__spriteAsset.spinRate || 0) * G.realT : 0;
    const assetRot = e.__spriteAsset ? (e.__spriteAsset.rotationOffset || 0) : 0;
    _computeSpritePose(_POSE, _profileForEntity(e), e.vx, e.vy, G.realT, _animSeed(e), baseRot + assetRot + drift, 0, 1, 0xffffff);
    _applySpritePose(sp, e.x, e.y, _POSE);
  } else if(e.type === 'xp')     sp.rotation = G.realT * 3;
  else   if(e.type === 'coin')   sp.rotation = G.realT * 4;
  else   if(e.type === 'magnet') sp.rotation = G.realT * 2;
  else   if(e.type === 'freeze') sp.rotation = G.realT;
  else   if(e.type === 'chest')  sp.rotation = G.realT * 1.2;
  else   if(e.type === 'item'){
    sp.rotation = G.realT * 0.72;
    const pulseV = 1 + Math.sin(G.realT*4)*.12;
    sp.scale.set(pulseV);
  }
  else if(e.type === 'fx'){
    // particle: alpha + size fade with life
    const a = e.life / e.maxLife;
    sp.alpha = a;
    sp.scale.set(Math.max(0.05, (e.size * a) / 16));
  }
  else if(e.type === 'text'){
    sp.alpha = e.life / e.maxLife;
  }
  else if(e.type === 'ring'){
    const a = e.life / e.maxLife;
    const w = 2 + (1-a)*4;
    sp.clear();
    sp.circle(e.x, e.y, e.r);
    sp.stroke({ color: e.color, alpha: a * .35, width: w + 6 });
    sp.circle(e.x, e.y, e.r);
    sp.stroke({ color: e.color, alpha: a * .8, width: w });
  }
  else if(e.type === 'shock'){
    const k = 1 - e.life/e.maxLife;
    const w = 4 + k*10;
    sp.clear();
    sp.circle(e.x, e.y, e.r);
    sp.stroke({ color: e.color, alpha: (1-k) * .35, width: w + 8 });
    sp.circle(e.x, e.y, e.r);
    sp.stroke({ color: e.color, alpha: (1-k) * .9, width: w });
  }
  else if(e.type === 'fan'){
    const a = e.life / e.maxLife;
    sp.clear();
    sp.moveTo(e.x, e.y);
    sp.arc(e.x, e.y, e.r, e.angle - e.arc/2, e.angle + e.arc/2);
    sp.lineTo(e.x, e.y);
    sp.fill({ color: e.color, alpha: a * .34 });
    sp.arc(e.x, e.y, e.r, e.angle - e.arc/2, e.angle + e.arc/2);
    sp.stroke({ color: e.color, alpha: a * .85, width: 3 + (1-a)*5 });
    for(let i = -2; i <= 2; i++){
      const aa = e.angle + i * e.arc / 5;
      sp.moveTo(e.x + Math.cos(aa)*18, e.y + Math.sin(aa)*18);
      sp.lineTo(e.x + Math.cos(aa)*e.r, e.y + Math.sin(aa)*e.r);
      sp.stroke({ color: 0xffe7c0, alpha: a * .22, width: 1 });
    }
  }
  else if(e.type === 'line'){
    const a = e.life / e.maxLife;
    sp.clear();
    sp.moveTo(e.x1, e.y1);
    const segs = 6;
    for(let i=1;i<segs;i++){
      const t = i/segs;
      const mx = lerp(e.x1, e.x2, t) + (Math.random()-.5)*16;
      const my = lerp(e.y1, e.y2, t) + (Math.random()-.5)*16;
      sp.lineTo(mx, my);
    }
    sp.lineTo(e.x2, e.y2);
    sp.stroke({ color: e.color, alpha: a * .35, width: (e.width || 2) + 6 });
    sp.moveTo(e.x1, e.y1);
    for(let i=1;i<segs;i++){
      const t = i/segs;
      const mx = lerp(e.x1, e.x2, t) + (Math.random()-.5)*8;
      const my = lerp(e.y1, e.y2, t) + (Math.random()-.5)*8;
      sp.lineTo(mx, my);
    }
    sp.lineTo(e.x2, e.y2);
    sp.stroke({ color: e.color, alpha: a, width: e.width || 2 });
  }
  else if(e.type === 'blackhole'){
    sp.clear();
    // Single dark core (no inner purple ring — flat one-color disk).
    sp.circle(e.x, e.y, e.r);
    sp.fill({ color: 0x000000, alpha: .9 });
    // 5 violet event-horizon spirals on top
    const t = e.t;
    const col = e.color || 0x9b5cff;
    for(let i = 0; i < 5; i++){
      const ang0 = t*4 + i*TAU/5;
      const r1 = e.r * (.4 + i*.12);
      sp.moveTo(e.x + Math.cos(ang0)*r1, e.y + Math.sin(ang0)*r1);
      for(let s = 1; s < 24; s++){
        const aa = ang0 + s*.18;
        const rr = r1 - s*1.2;
        if(rr <= 0) break;
        sp.lineTo(e.x + Math.cos(aa)*rr, e.y + Math.sin(aa)*rr);
      }
      sp.stroke({ color: col, alpha: Math.max(.05, .7 - i*.12), width: 1.5 });
    }
    sp.circle(e.x, e.y, e.r);
    sp.stroke({ color: col, alpha: .45, width: 2 });
  }
  else if(e.type === 'zone'){
    const a = e.life / e.maxLife;
    const k = 1 - a;
    const col = e.color || 0xd6a84f;
    sp.clear();
    if(e.kind === 'hellfire'){
      sp.circle(e.x, e.y, e.r);
      sp.fill({ color: 0x2a0503, alpha: .09 + a*.05 });
      for(let m = 0; m < 3; m++){
        const aa = e.seed + m*TAU/3 + Math.sin(G.realT*2 + m)*.04;
        const nx = -Math.sin(aa), ny = Math.cos(aa);
        const steps = 5;
        sp.moveTo(e.x - Math.cos(aa)*e.r*.92, e.y - Math.sin(aa)*e.r*.92);
        for(let j = 1; j <= steps; j++){
          const t = j / steps;
          const along = -e.r*.92 + t * e.r*1.84;
          const jag = Math.sin(e.seed*17 + m*3 + j*2.1) * e.r*.12;
          sp.lineTo(e.x + Math.cos(aa)*along + nx*jag, e.y + Math.sin(aa)*along + ny*jag);
        }
        sp.stroke({ color: col, alpha: (.28 + m*.06)*a, width: 2.2 + k*2 });
      }
      sp.circle(e.x, e.y, Math.max(3, e.r*.18));
      sp.fill({ color: 0xffb15e, alpha: .16*a });
      return;
    }
    sp.circle(e.x, e.y, e.r);
    sp.fill({ color: col, alpha: .07 + a*.05 });
    sp.circle(e.x, e.y, e.r * (.82 + Math.sin(G.realT*3 + e.seed)*.03));
    sp.stroke({ color: col, alpha: .48*a, width: 2.5 + k*3 });
    sp.circle(e.x, e.y, e.r * .48);
    sp.stroke({ color: 0xfff1c8, alpha: .18*a, width: 1.2 });
    const n = e.kind === 'hellfire' ? 8 : 6;
    for(let i = 0; i < n; i++){
      const aa = e.seed + G.realT*.18 + i*TAU/n;
      const r0 = e.r * .34;
      const r1 = e.r * (e.kind === 'hellfire' ? .95 : .72);
      sp.moveTo(e.x + Math.cos(aa)*r0, e.y + Math.sin(aa)*r0);
      sp.lineTo(e.x + Math.cos(aa)*r1, e.y + Math.sin(aa)*r1);
      sp.stroke({ color: col, alpha: (e.kind === 'hellfire' ? .18 : .13)*a, width: e.kind === 'hellfire' ? 2 : 1.2 });
    }
  }
}

/* ===================================================================
   SPAWN DIRECTOR
   =================================================================== */
// Active-enemy cap, ramped by run time so late game (10min+) actually feels
// dense. Was a flat 250 — that saturated at 4min and made minutes 10-30 feel
// strangely safe (per balance audit). 250→400 ramp over 0~10min.
function _enemyCap(t){
  const r = Math.min(1, t / 600);
  return Math.round(250 + 150 * r);
}
// SHRINE director — spawns a single shrine at each SHRINE_TIMES checkpoint.
// G._shrinesSpawned is a Set of seconds-of-trigger so a checkpoint never
// double-spawns. Shrine appears just off-screen so the player walks toward it
// rather than being startled by a sudden mid-screen pickup.
function shrineDirector(){
  if(!G.player || G.bossActive) return;
  if(!G._shrinesSpawned) G._shrinesSpawned = new Set();
  for(const t of SHRINE_TIMES){
    if(G.t >= t && !G._shrinesSpawned.has(t)){
      G._shrinesSpawned.add(t);
      const a = Math.random() * TAU;
      const r = 360;
      const x = G.player.x + Math.cos(a) * r;
      const y = G.player.y + Math.sin(a) * r;
      spawnShrine(x, y);
      // Make sure player notices.
      try {
        const minStr = Math.floor(t/60) + '분';
        // announce already imported elsewhere — use direct DOM if not.
        const el = document.getElementById('announce');
        if(el){ el.textContent = '◈ CURSED ALTAR 등장 (' + minStr + ') ◈'; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'), 2500); }
      } catch(e){}
    }
  }
}
function spawnDirector(){
  G.spawnTimer -= G.dt;
  if(G.spawnTimer > 0) return;
  const t = G.t;
  // Base cadence + count. During a boss fight, slow spawns by 2x and halve count
  // so the boss is the focus instead of a wall of adds.
  // Floor 0.18→0.10 lets late-game pressure scale further (was saturating at
  // 6min; now stays climbing through ~9min when it caps).
  const bossSlow = G.bossActive ? 2.0 : 1.0;
  G.spawnTimer = Math.max(.10, 1.6 - t*.0040) * bossSlow;
  // Hard cap — at the cap, skip the entire tick. Late-game pressure comes
  // from elite mix + boss patterns, not raw population.
  const room = _enemyCap(t) - EGRID.enemies.length;
  if(room <= 0) return;
  let n = clamp(Math.round(1 + t*.045), 1, 14);
  if(G.bossActive) n = Math.max(1, Math.floor(n * 0.5));
  n = Math.min(n, room);
  const min = t/60;
  const pool = ['TRI'];
  if(min > .3) pool.push('TRI');
  if(min > 1) pool.push('SQR');
  if(min > 1.5) pool.push('DIA');
  if(min > 2.5) pool.push('PEN');
  if(min > 3.5) pool.push('HEX');
  if(min > 5) pool.push('OCT');
  if(min > 6) pool.push('SQR','HEX');
  if(min > 8) pool.push('DIA','PEN');
  if(min > 10) pool.push('SWARM','SWARM','HEX');
  for(let i=0;i<n;i++){
    const a = Math.random()*TAU;
    const r = rand(420, 560);
    const x = G.player.x + Math.cos(a)*r;
    const y = G.player.y + Math.sin(a)*r;
    spawnEnemy(choice(pool), x, y);
  }
  // Swarm bursts also respect the cap.
  if(min > 4 && Math.random() < .15){
    const burstRoom = Math.max(0, _enemyCap(G.t) - EGRID.enemies.length);
    const burstN = Math.min(22, burstRoom);
    for(let i=0;i<burstN;i++){
      const a = Math.random()*TAU;
      const r = rand(440, 620);
      spawnEnemy('SWARM', G.player.x + Math.cos(a)*r, G.player.y + Math.sin(a)*r);
    }
  }
}

/* ===================================================================
   RENDER
   - BG.tick (parallax/grid/glow position updates)
   - camera + shake → world container position
   - flash overlay (full-screen color rect on hudC, alpha = G.flash)
   =================================================================== */
let _flashGfx = null;
function _ensureFlashGfx(){
  if(_flashGfx) return _flashGfx;
  _flashGfx = acquireGraphics();
  hudC.addChild(_flashGfx);
  return _flashGfx;
}
export function render(){
  BG.tick();
  const sh = G.shake * 14;
  world.position.set(
    -G.cam.x + (Math.random()-.5)*sh,
    -G.cam.y + (Math.random()-.5)*sh
  );
  const flashGfx = _ensureFlashGfx();
  flashGfx.clear();
  if(G.flash > 0){
    flashGfx.rect(0, 0, W, H);
    flashGfx.fill({ color: G.flashColor || '#ffffff', alpha: G.flash });
  }
  if(app.renderer) app.renderer.render(app.stage);
}
