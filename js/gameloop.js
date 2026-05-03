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
import { BG, acquireGraphics } from './render.js';
import {
  EGRID, _EQ1, _EQ2,
  makeEnt, fxBurst, fxRing, fxText, fxShockwave, fxLine, shake, flash,
  spawnEnemy, spawnBoss, spawnCoin,
  fireProjectile, dealDamage, nearestEnemy,
  detachSprite,
} from './entities.js';
import {
  damagePlayer, applyItem, dropItem,
} from './player.js';
import {
  PASSIVES,
} from './data.js';
import { WEAPONS } from './weapons.js';

// Wired by ui.js (avoids hard cycle):
let _doLevelUp = null, _endRun = null, _updateHUD = null, _openChestPick = null;
export function setLoopHandlers({ doLevelUp, endRun, updateHUD, openChestPick }){
  _doLevelUp = doLevelUp; _endRun = endRun; _updateHUD = updateHUD; _openChestPick = openChestPick;
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
  const moveSpeed = Math.min(p.speed * (p._boostSpdMul || 1), 720);
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
    else if(e.type === 'text'){
      e.y += e.vy * G.dt; e.vy *= .98;
      e.life -= G.dt; if(e.life<=0) e.alive=false;
    }
    else if(e.type === 'blackhole'){
      e.life -= G.dt;
      if(e.life<=0){
        fxShockwave(e.x,e.y,C.violet,e.r*1.4,.6); AUDIO.explode(e.x,e.y); shake(.2);
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
        else if(e.type==='coin'){ G.coinsRun++; meta.coins++; saveMetaLater(); AUDIO.pickup(e.x); fxText(e.x,e.y,'◆',C.gold); }
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
    if(G.superMagnetTimer > 0) G.superMagnetTimer -= G.dt;
    _syncEntitySprite(e);
  }
  updateEnemyBullets();
  updateCamera();
  // player sprite sync (player is not in G.ents)
  if(p && p.sprite){
    p.sprite.position.set(p.x, p.y);
    p.sprite.rotation = p.rot;
    p.dotSprite.position.set(p.x, p.y);
    if(p.invuln > 0 && (Math.floor(G.realT*16)%2===0)){
      p.sprite.alpha = 0.35; p.dotSprite.alpha = 0.35;
    } else {
      p.sprite.alpha = 1; p.dotSprite.alpha = 1;
    }
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
    if(p.beamGfx){
      p.beamGfx.clear();
      for(const w of p.weapons){
        if((w.key === 'BEAM' || w.key === 'EVENT_LANCE') && w.beams){
          for(const b of w.beams){
            if(!b) continue;
            p.beamGfx.moveTo(b.x1, b.y1); p.beamGfx.lineTo(b.x2, b.y2);
            p.beamGfx.stroke({ color: 0xffd400, alpha: .55, width: (w.stats.width||3) + 12 });
            p.beamGfx.moveTo(b.x1, b.y1); p.beamGfx.lineTo(b.x2, b.y2);
            p.beamGfx.stroke({ color: 0xffffff, alpha: .95, width: w.stats.width||3 });
          }
        }
        if(w.key === 'ORBIT' && w.lastNodes){
          for(const n of w.lastNodes){
            if(!n) continue;
            p.beamGfx.circle(n.x, n.y, w.stats.nodeR || 10);
            p.beamGfx.fill({ color: 0x9b5cff, alpha: .35 });
            p.beamGfx.circle(n.x, n.y, w.stats.nodeR || 10);
            p.beamGfx.stroke({ color: 0x9b5cff, alpha: .9, width: 2 });
            p.beamGfx.moveTo(p.x, p.y); p.beamGfx.lineTo(n.x, n.y);
            p.beamGfx.stroke({ color: 0x9b5cff, alpha: .25, width: 1.2 });
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
  G.bossTimer += G.dt;
  // First boss at 110s, then every 90s after. Gives more build time before the wall.
  const FIRST_BOSS_AT = 110, BOSS_INTERVAL = 90;
  const firstReady = G.t >= FIRST_BOSS_AT;
  const intervalReady = G.bossTimer >= BOSS_INTERVAL && G.t >= FIRST_BOSS_AT;
  if(!G.bossActive && firstReady && intervalReady){
    const order = ['RING_LORD','SPIKE_KING','HYDRA','PRISMA'];
    const idx = Math.min(order.length-1, Math.floor((G.t - FIRST_BOSS_AT) / BOSS_INTERVAL));
    if(idx >= 0) spawnBoss(order[idx]);
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
function updateProjectile(pr){
  pr.life -= G.dt;
  if(pr.life <= 0){ pr.alive = false; return; }
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
      pr.hits.add(e);
      if(pr.subtype === 'prism' && pr.splits > 0){
        const n = pr.splits;
        for(let i=0;i<n;i++){
          const a = Math.random()*TAU;
          fireProjectile(pr.x, pr.y, a, pr.speed*.9, pr.dmg*.6, pr.life*.7, pr.color, 'bullet');
        }
        pr.alive = false; return;
      }
      if(pr.pierce > 0){ pr.pierce--; }
      else { pr.alive = false; return; }
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
  const gfxType = e.type === 'ring' || e.type === 'shock' || e.type === 'fan' || e.type === 'line' || e.type === 'blackhole';
  if(!gfxType) sp.position.set(e.x, e.y);

  if(e.type === 'enemy'){
    sp.rotation = e.rot;
    const wantFlash = e.hitFlash > 0;
    if(wantFlash && e.__flashTex && sp.texture !== e.__flashTex.texture) sp.texture = e.__flashTex.texture;
    else if(!wantFlash && e.__normTex && sp.texture !== e.__normTex.texture) sp.texture = e.__normTex.texture;
  } else if(e.type === 'proj'){
    sp.rotation = e.subtype === 'shuriken' ? e.spin : Math.atan2(e.vy, e.vx);
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
    sp.fill({ color: e.color, alpha: a * .7 });
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
      sp.stroke({ color: 0x9b5cff, alpha: Math.max(.05, .7 - i*.12), width: 1.5 });
    }
  }
}

/* ===================================================================
   SPAWN DIRECTOR
   =================================================================== */
// Active-enemy cap. Horde density comes from close pressure, not unbounded
// population growth. 250 is well below the PixiJS or Canvas frame budget and
// keeps fusion-weapon onUpdate cost (which scans EGRID per node) bounded.
const ENEMY_CAP = 250;
function spawnDirector(){
  G.spawnTimer -= G.dt;
  if(G.spawnTimer > 0) return;
  const t = G.t;
  // Base cadence + count. During a boss fight, slow spawns by 2x and halve count
  // so the boss is the focus instead of a wall of adds.
  const bossSlow = G.bossActive ? 2.0 : 1.0;
  G.spawnTimer = Math.max(.18, 1.6 - t*.0040) * bossSlow;
  // Hard cap — at the cap, skip the entire tick. Late-game pressure comes
  // from elite mix + boss patterns, not raw population.
  const room = ENEMY_CAP - EGRID.enemies.length;
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
    const burstRoom = Math.max(0, ENEMY_CAP - EGRID.enemies.length);
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

