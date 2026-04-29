/* ===================================================================
   GAMELOOP — update + render + spawn director + entity-type updates.
   =================================================================== */
import {
  G, W, H, TAU, C, RUN_LENGTH_SEC, ctx, keys,
  rand, clamp, lerp, choice, hsl, pulse, angTo, fmtTime,
  meta, saveMeta, saveMetaLater,
  updateCamera, setBar, announce,
} from './core.js';
import { AUDIO } from './audio.js';
import {
  drawCircle, drawDiamond, drawPolygon, drawStar, withDrawCtx, BG,
} from './render.js';
import {
  EGRID, _EQ1, _EQ2,
  makeEnt, fxBurst, fxRing, fxText, fxShockwave, fxLine, shake, flash,
  spawnEnemy, spawnBoss, spawnCoin,
  fireProjectile, dealDamage, nearestEnemy,
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
      if(G.superMagnetTimer > 0 || d < range){
        const a = Math.atan2(p.y-e.y, p.x-e.x);
        const sp = G.superMagnetTimer>0 ? 720 : 360 * (1 - d/range + .2);
        e.vx += Math.cos(a)*sp;
        e.vy += Math.sin(a)*sp;
      }
      if(d < p.r + e.r){
        if(e.type==='xp'){ const gained = Math.round(e.amount * (p.xpGainMul||1)); p.xp += gained; AUDIO.pickup(e.x); fxText(e.x,e.y,'+'+gained, e.color); }
        else if(e.type==='coin'){ G.coinsRun++; meta.coins++; saveMetaLater(); AUDIO.pickup(e.x); fxText(e.x,e.y,'◆',C.gold); }
        else if(e.type==='heart'){ p.hp = Math.min(p.maxHp, p.hp + 25); AUDIO.heal(); fxText(e.x,e.y,'+25 HP', C.red); }
        else if(e.type==='magnet'){ G.superMagnetTimer = 4; AUDIO.pickup(); announce('MAGNET ACTIVE', 1); }
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
  }
  updateEnemyBullets();
  updateCamera();
  // cleanup — swap-and-pop
  { const arr = G.ents; let wi = 0; for(let ri = 0; ri < arr.length; ri++){ if(arr[ri].alive) arr[wi++] = arr[ri]; } arr.length = wi; }
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
  for(let i = 0; i < ents.length; i++){
    const b = ents[i];
    if(b.type !== 'ebullet' || !b.alive) continue;
    b.life -= G.dt; if(b.life<=0){ b.alive=false; continue; }
    b.x += b.vx * G.dt; b.y += b.vy * G.dt;
    if(p){
      const dxb = b.x - p.x, dyb = b.y - p.y;
      const rr = p.r + b.r;
      if(dxb*dxb + dyb*dyb < rr*rr){
        damagePlayer(b.dmg);
        fxBurst(b.x, b.y, b.color, 6, 120, 2, .25);
        b.alive = false;
      }
    }
  }
}

/* ===================================================================
   SPAWN DIRECTOR
   =================================================================== */
function spawnDirector(){
  G.spawnTimer -= G.dt;
  if(G.spawnTimer > 0) return;
  const t = G.t;
  // Base cadence + count. During a boss fight, slow spawns by 2x and halve count
  // so the boss is the focus instead of a wall of adds.
  const bossSlow = G.bossActive ? 2.0 : 1.0;
  G.spawnTimer = Math.max(.18, 1.6 - t*.0040) * bossSlow;
  let n = clamp(Math.round(1 + t*.045), 1, 14);
  if(G.bossActive) n = Math.max(1, Math.floor(n * 0.5));
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
  if(min > 4 && Math.random() < .15){
    for(let i=0;i<22;i++){
      const a = Math.random()*TAU;
      const r = rand(440, 620);
      spawnEnemy('SWARM', G.player.x + Math.cos(a)*r, G.player.y + Math.sin(a)*r);
    }
  }
}

/* ===================================================================
   RENDER
   =================================================================== */
// Detect ctx state leaks: count save/restore per frame via a Proxy-like wrapper.
// If the depth at frame end isn't 0, log once so we can find the culprit.
let _ctxDepth = 0, _ctxLeakLogged = false;
const _origSave = ctx.save.bind(ctx);
const _origRestore = ctx.restore.bind(ctx);
ctx.save = function(){ _ctxDepth++; return _origSave(); };
ctx.restore = function(){ if(_ctxDepth > 0) _ctxDepth--; return _origRestore(); };

export function render(){
  // DEFENSIVE: pop any leaked ctx.save() from prior frames. restore() on an
  // empty stack is a no-op in canvas, so this is safe.
  // (We DON'T reset the transform matrix here — that's the resize handler's
  //  job. Re-setting transform every frame caused misalignment when DPR
  //  changed without a resize event firing — e.g. opening devtools, picking
  //  up an item that triggered a brief layout shift, etc.)
  while(_ctxDepth > 0) ctx.restore();

  const _depthAtFrameStart = _ctxDepth; // should be 0
  ctx.save();
  const sh = G.shake * 14;
  ctx.translate((Math.random()-.5)*sh, (Math.random()-.5)*sh);
  BG.draw();
  if(G.mode === 'play' || G.mode === 'pause' || G.mode === 'levelup' || G.mode === 'end'){
    drawWorld();
  }
  if(G.flash > 0){
    ctx.fillStyle = G.flashColor; ctx.globalAlpha = G.flash;
    ctx.fillRect(0,0,W,H); ctx.globalAlpha = 1;
  }
  ctx.restore();

  // Diagnostic: report leak once so we know which function leaked
  if(_ctxDepth !== _depthAtFrameStart && !_ctxLeakLogged){
    _ctxLeakLogged = true;
    console.warn('[ctx-leak] depth grew from', _depthAtFrameStart, 'to', _ctxDepth, '— some draw fn called save() without restore()');
  }
}

function drawWorld(){
  ctx.save();
  ctx.translate(-G.cam.x, -G.cam.y);

  // Off-screen culling — radius-aware, 200px margin. Bypassed on bad camera coords.
  const camOk = Number.isFinite(G.cam.x) && Number.isFinite(G.cam.y);
  const cx0 = G.cam.x - 200, cx1 = G.cam.x + W + 200;
  const cy0 = G.cam.y - 200, cy1 = G.cam.y + H + 200;
  const vis = camOk
    ? (e)=> { const r = e.r || 30; return (e.x + r) >= cx0 && (e.x - r) <= cx1 && (e.y + r) >= cy0 && (e.y - r) <= cy1; }
    : ()=> true;

  // Loop-level try/catch (faster than per-entity wrap). Each pass is independent —
  // if one pass throws, others still run. Logs first 20 distinct draw failures.
  const passes = [
    ()=> { for(const e of G.ents) if(e.type==='blackhole' && e.alive && vis(e)) drawBlackhole(e); },
    ()=> { for(const e of G.ents) if((e.type==='xp'||e.type==='coin'||e.type==='heart'||e.type==='magnet'||e.type==='freeze'||e.type==='chest'||e.type==='item') && vis(e)) drawPickup(e); },
    ()=> { const el = EGRID.enemies; for(let i=0;i<el.length;i++){ const e = el[i]; if(vis(e)) drawEnemy(e); } },
    ()=> { if(G.player) drawPlayer(G.player); },
    ()=> { for(const e of G.ents) if(e.type==='proj' && e.alive && vis(e)) drawProjectile(e); },
    ()=> { for(const e of G.ents) if(e.type==='ebullet' && e.alive && vis(e)) drawEnemyBullet(e); },
    ()=> { if(G.player) drawBeams(G.player); },
    ()=> { if(G.player) drawOrbits(G.player); },
    ()=> {
      for(const e of G.ents){
        if(!vis(e)) continue;
        if(e.type==='fx') drawFxParticle(e);
        else if(e.type==='ring') drawFxRing(e);
        else if(e.type==='shock') drawFxShock(e);
        else if(e.type==='line') drawFxLine(e);
        else if(e.type==='fan') drawFan(e);
      }
    },
    ()=> { for(const e of G.ents) if(e.type==='text' && vis(e)) drawText(e); },
  ];
  for(let pi = 0; pi < passes.length; pi++){
    try { passes[pi](); }
    catch(err){ if(_drawErrCount < 20){ _drawErrCount++; console.warn('[drawWorld pass'+pi+']', err?.message||err); } }
  }

  ctx.restore();
}
let _drawErrCount = 0;
let _wpnErrCount = 0;

function drawPlayer(p){
  ctx.save();
  ctx.strokeStyle = p.color;
  ctx.shadowBlur = 4; ctx.shadowColor = p.color;
  ctx.lineCap = 'round';
  for(let i=0;i<p.trail.length-1;i++){
    const a = p.trail[i], b = p.trail[i+1];
    const t = i / p.trail.length;
    ctx.globalAlpha = t * .5;
    ctx.lineWidth = 1 + t*4;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
  const halo = pulse(G.realT, 4) * .4 + .6;
  ctx.save();
  const hg = ctx.createRadialGradient(p.x, p.y, p.r, p.x, p.y, p.r*4);
  hg.addColorStop(0, p.color); hg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = .25 * halo;
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r*4, 0, TAU); ctx.fill();
  ctx.restore();
  if(p.sides === 0){
    drawCircle(p.x, p.y, p.r, p.color, 22, hsl(180,80,8,.6), 2.6);
    drawCircle(p.x, p.y, p.r*.45, '#fff', 18, p.color, 1.4);
  } else {
    drawPolygon(p.x, p.y, p.sides, p.r, p.rot, p.color, 20, 'rgba(0,0,0,.4)', 2.4);
    drawCircle(p.x, p.y, p.r*.35, '#fff', 12, p.color, 1.2);
  }
  if(p.invuln > 0 && (Math.floor(G.realT*16)%2===0)){
    drawCircle(p.x, p.y, p.r+4, '#fff', 18, 'rgba(0,0,0,0)', 1.5);
  }
}

function drawEnemy(e){
  const flashOn = e.hitFlash > 0;
  const col = flashOn ? '#fff' : e.color;
  const fillCol = flashOn ? 'rgba(255,255,255,.6)' : 'rgba(8,14,30,.55)';
  const r = e.r;
  if(e.isBoss){
    const rg = ctx.createRadialGradient(e.x,e.y,r*.4, e.x,e.y, r*3);
    rg.addColorStop(0, e.color); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.globalAlpha = .25 + pulse(G.realT,3)*.15;
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(e.x,e.y, r*3, 0, TAU); ctx.fill(); ctx.restore();
  }
  if(e.isDiamond){
    drawDiamond(e.x, e.y, r, e.rot, col, 6, fillCol);
  } else if(e.sides === 0){
    drawCircle(e.x, e.y, r, col, 6, fillCol, 2);
  } else {
    drawPolygon(e.x, e.y, e.sides, r, e.rot, col, e.isBoss ? 14 : 6, fillCol, e.isBoss ? 3 : 2);
  }
  if(!e.isBoss && e.hp < e.maxHp){
    const w = r*1.8, x = e.x - w/2, y = e.y + r + 5;
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(x,y,w,2);
    ctx.fillStyle = e.color; ctx.shadowBlur = 0;
    ctx.fillRect(x,y, w*(e.hp/e.maxHp), 2);
    ctx.shadowBlur = 0;
  }
}

function drawProjectile(pr){
  if(pr.subtype === 'shuriken'){
    drawStar(pr.x, pr.y, 4, 14, 6, pr.spin, pr.color, 8, pr.color, 1.6);
  } else if(pr.subtype === 'homing'){
    drawDiamond(pr.x, pr.y, 8, Math.atan2(pr.vy,pr.vx), pr.color, 6, pr.color);
  } else if(pr.subtype === 'prism'){
    drawPolygon(pr.x, pr.y, 3, 8, Math.atan2(pr.vy,pr.vx)+Math.PI/2, pr.color, 6, pr.color, 1.6);
  } else {
    drawCircle(pr.x, pr.y, 4, pr.color, 6, pr.color, 1);
  }
}
function drawEnemyBullet(b){
  drawCircle(b.x, b.y, b.r, b.color, 6, b.color, 1.4);
}

function drawBeams(p){
  for(const w of p.weapons){
    if(w.key !== 'BEAM' || !w.beams) continue;
    for(const b of w.beams){
      if(!b) continue;
      ctx.save();
      const g = ctx.createLinearGradient(b.x1, b.y1, b.x2, b.y2);
      g.addColorStop(0, 'rgba(255,212,0,.0)');
      g.addColorStop(.5, 'rgba(255,212,0,.85)');
      g.addColorStop(1, 'rgba(255,212,0,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = w.stats.width + 6;
      ctx.lineCap = 'round';
      ctx.shadowBlur = 12; ctx.shadowColor = C.gold;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = w.stats.width;
      ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      ctx.restore();
    }
  }
}
function drawOrbits(p){
  for(const w of p.weapons){
    if(w.key !== 'ORBIT' || !w.lastNodes) continue;
    for(const n of w.lastNodes){
      if(!n) continue;
      drawCircle(n.x, n.y, w.stats.nodeR, C.violet, 8, hsl(280,80,15,.5), 2);
      ctx.save();
      ctx.strokeStyle = 'rgba(155,92,255,.25)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(n.x, n.y); ctx.stroke();
      ctx.restore();
    }
  }
}
function drawBlackhole(e){
  ctx.save();
  const t = e.t;
  const rg = ctx.createRadialGradient(e.x,e.y, 0, e.x,e.y, e.r);
  rg.addColorStop(0, 'rgba(0,0,0,.95)');
  rg.addColorStop(.5, 'rgba(40,8,80,.9)');
  rg.addColorStop(1, 'rgba(155,92,255,0)');
  ctx.fillStyle = rg;
  ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, TAU); ctx.fill();
  for(let i=0;i<5;i++){
    const a = t*4 + i*TAU/5;
    const r1 = e.r * (.4 + i*.12);
    ctx.strokeStyle = `hsla(280 80% 70% / ${.7 - i*.12})`;
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 6; ctx.shadowColor = C.violet;
    ctx.beginPath();
    for(let s=0;s<24;s++){
      const aa = a + s*.18;
      const rr = r1 - s*1.2;
      const x = e.x + Math.cos(aa)*rr;
      const y = e.y + Math.sin(aa)*rr;
      if(s===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
function drawPickup(e){
  if(e.type==='xp'){
    drawDiamond(e.x, e.y, e.r, G.realT*3, e.color, 6, e.color);
  } else if(e.type==='coin'){
    ctx.save();
    ctx.translate(e.x, e.y); ctx.rotate(G.realT*4);
    drawDiamond(0,0,e.r, 0, C.gold, 8, C.gold);
    ctx.restore();
  } else if(e.type==='heart'){
    ctx.save();
    ctx.fillStyle = C.red; ctx.shadowColor = C.red; ctx.shadowBlur = 8;
    const s = e.r;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y - s*.2);
    ctx.bezierCurveTo(e.x-s*1.5, e.y-s*1.5, e.x-s*2, e.y+s*.4, e.x, e.y+s*1.4);
    ctx.bezierCurveTo(e.x+s*2, e.y+s*.4, e.x+s*1.5, e.y-s*1.5, e.x, e.y-s*.2);
    ctx.fill();
    ctx.restore();
  } else if(e.type==='magnet'){
    drawStar(e.x, e.y, 4, e.r, e.r*.4, G.realT*2, C.pink, 8, C.pink, 1.6);
  } else if(e.type==='freeze'){
    drawStar(e.x, e.y, 6, e.r, e.r*.5, G.realT, C.teal, 8, C.teal, 1.6);
  } else if(e.type==='chest'){
    drawStar(e.x, e.y, 5, e.r*1.4, e.r*.6, G.realT*1.2, C.gold, 10, hsl(50,90,20,.7), 2);
  } else if(e.type==='item'){
    const col = e.color || C.gold;
    const glow = e.glow || 18;
    const rot = G.realT * 1.8;
    const pulseV = 1 + Math.sin(G.realT*4)*.12;
    const r = e.r * pulseV;
    // Outer breathing glow
    ctx.save();
    ctx.globalAlpha = .35 + Math.sin(G.realT*5)*.2;
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.shadowColor = col; ctx.shadowBlur = glow;
    ctx.beginPath(); ctx.arc(e.x, e.y, r*1.7, 0, TAU); ctx.stroke();
    ctx.restore();
    // Tier shell — hexagon (relic) or diamond (consumable). Identifies category at a glance.
    const isRelic = e.item && e.item.kind === 'relic';
    if(isRelic){
      drawPolygon(e.x, e.y, 6, r*1.25, rot*.4, col, glow*.5, 'rgba(0,0,0,.35)', 1.6);
    } else {
      drawDiamond(e.x, e.y, r*1.2, rot*.4, col, glow*.5, 'rgba(0,0,0,.35)');
    }
    // Per-item glyph icon
    if(e.item && e.item.icon){
      e.item.icon(ctx, e.x, e.y, r * 2.0);
    } else {
      drawCircle(e.x, e.y, r*.4, '#fff', 8, col);
    }
  }
}
function drawFxParticle(e){
  // shadowBlur removed — particles are tiny and brief, glow not perceptible
  // and the per-particle blur cost dominates draw time in late-run frames.
  const a = e.life / e.maxLife;
  ctx.globalAlpha = a;
  ctx.fillStyle = e.color;
  ctx.beginPath(); ctx.arc(e.x, e.y, e.size * a, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
}
function drawFxRing(e){
  const a = e.life / e.maxLife;
  ctx.save();
  ctx.globalAlpha = a * .8;
  ctx.strokeStyle = e.color; ctx.lineWidth = 2 + (1-a)*4;
  ctx.shadowBlur = 8; ctx.shadowColor = e.color;
  ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, TAU); ctx.stroke();
  ctx.restore();
}
function drawFxShock(e){
  const k = 1 - e.life/e.maxLife;
  ctx.save();
  ctx.globalAlpha = (1 - k) * .9;
  ctx.strokeStyle = e.color; ctx.lineWidth = 4 + k*10;
  ctx.shadowBlur = 10; ctx.shadowColor = e.color;
  ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, TAU); ctx.stroke();
  ctx.restore();
}
function drawFxLine(e){
  const a = e.life / e.maxLife;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.strokeStyle = e.color; ctx.lineWidth = e.width;
  ctx.shadowBlur = 6; ctx.shadowColor = e.color;
  ctx.beginPath(); ctx.moveTo(e.x1,e.y1);
  const segs = 6;
  for(let i=1;i<segs;i++){
    const t = i/segs;
    const mx = lerp(e.x1, e.x2, t) + (Math.random()-.5)*16;
    const my = lerp(e.y1, e.y2, t) + (Math.random()-.5)*16;
    ctx.lineTo(mx,my);
  }
  ctx.lineTo(e.x2,e.y2); ctx.stroke();
  ctx.restore();
}
function drawFan(e){
  const a = e.life / e.maxLife;
  ctx.save();
  ctx.globalAlpha = a * .7;
  ctx.fillStyle = e.color;
  ctx.shadowBlur = 10; ctx.shadowColor = e.color;
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.arc(e.x, e.y, e.r, e.angle - e.arc/2, e.angle + e.arc/2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
function drawText(e){
  // shadowBlur removed for perf — damage numbers are short-lived and dense
  // during boss fights / mass kills. Plain bright text reads fine on dark bg.
  const a = e.life / e.maxLife;
  ctx.globalAlpha = a;
  ctx.font = (e.big ? '700 18px ' : '700 14px ') + "'JetBrains Mono', monospace";
  ctx.fillStyle = e.color;
  ctx.textAlign = 'center';
  ctx.fillText(e.text, e.x, e.y);
  ctx.globalAlpha = 1;
}
