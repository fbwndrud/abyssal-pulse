/* ===================================================================
   WEAPONS + EVOLUTIONS
   This is the file to extend for evolution paths and (future) fusion trees.
   =================================================================== */
import { G, TAU, C, rand, angTo } from './core.js';
import { AUDIO } from './audio.js';
import { drawCircle, drawDiamond, drawPolygon, drawStar } from './render.js';
import {
  EGRID, _EQ1,
  firePulse, fireProjectile, fireFanShock, spawnBlackhole,
  fxBurst, fxLine, fxRing,
  dealDamage, applySlow, nearestEnemy, nearestEnemyExcept, pointSegDist,
} from './entities.js';

export const WEAPONS = {
  PULSE: {
    name:'PULSE WAVE', color:C.cyan, kind:'AOE',
    desc:'주기적 충격파로 주변 적 타격.',
    maxLv:6,
    baseStats:{ cd:1.6, dmg:24, radius:130, kb:120 },
    icon(ctx,x,y,s){ for(let i=0;i<3;i++){ ctx.beginPath(); ctx.arc(x,y, s*.18 + i*s*.18, 0, TAU); ctx.strokeStyle=C.cyan; ctx.lineWidth=1.6; ctx.shadowBlur=8; ctx.shadowColor=C.cyan; ctx.globalAlpha=1-i*.25; ctx.stroke(); ctx.globalAlpha=1; } },
    onUpdate(p,w){
      w.timer = (w.timer||0) - G.dt;
      const ex = w.extra || {};
      const opts = { color: w.color || C.cyan, slow: ex.slow, slowDur: ex.slowDur };
      // Inline scheduling for double/triple — avoids cross-frame setTimeout
      // chains that backlog during pause/level-up and dump bursts on resume.
      // We tick a small queue of pending pulses each frame.
      if(!w.pendingPulses) w.pendingPulses = [];
      for(let i = w.pendingPulses.length - 1; i >= 0; i--){
        w.pendingPulses[i].t -= G.dt;
        if(w.pendingPulses[i].t <= 0){
          const s2 = w.stats;
          firePulse(p.x, p.y, s2.radius, s2.dmg, s2.kb, opts);
          w.pendingPulses.splice(i, 1);
        }
      }
      if(w.timer <= 0){
        const s = w.stats;
        firePulse(p.x, p.y, s.radius, s.dmg, s.kb, opts);
        const extraPulses = ex.triple ? 2 : (ex.double ? 1 : 0);
        const delay = ex.ringDelay || .12;
        for(let i = 1; i <= extraPulses; i++){
          w.pendingPulses.push({ t: delay * i });
        }
        w.timer = s.cd / p.cdMul;
      }
    },
    levelUp(w,lv){ w.stats.cd *= .92; w.stats.dmg += 8; w.stats.radius += 16; },
  },
  BEAM: {
    name:'BEAM', color:C.gold, kind:'BEAM',
    desc:'회전하는 레이저 빔.',
    maxLv:6,
    baseStats:{ rotSpeed:1.4, dmg:42, length:520, width:6, count:1, tick:.12 },
    icon(ctx,x,y,s){ ctx.save(); ctx.strokeStyle=C.gold; ctx.shadowBlur=10; ctx.shadowColor=C.gold; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x-s*.4,y-s*.4); ctx.lineTo(x+s*.4,y+s*.4); ctx.stroke(); ctx.restore(); },
    onUpdate(p,w){
      w.angle = (w.angle||0) + w.stats.rotSpeed * G.dt;
      w.tickT = (w.tickT||0) - G.dt;
      const s = w.stats;
      const tickEvery = s.tick / p.cdMul;
      const damageThisFrame = w.tickT <= 0;
      if(damageThisFrame) w.tickT = tickEvery;
      const exFlags = w.extra || {};
      // Track every enemy that overlapped *any* beam since the last damage tick.
      // Without this, fast/dashing enemies that crossed the beam between ticks
      // could escape entirely — the user-visible "beam misses" bug.
      if(!w._tickHits) w._tickHits = new Set();
      const beamColor = w.color || '#ffd400';
      // Trim beams to current count — handles evolutions that REDUCE count
      // (e.g., VOID LANCE 3→1) so stale higher-index beams aren't rendered
      // at frozen positions.
      if(!w.beams) w.beams = [];
      if(w.beams.length !== s.count) w.beams.length = s.count;
      for(let b=0;b<s.count;b++){
        let a = w.angle + (b * TAU/s.count);
        // PRISM RAY: each beam wobbles randomly
        if(exFlags.randomAim) a += (Math.random()-.5) * 1.4;
        const ex = p.x + Math.cos(a)*s.length;
        const ey = p.y + Math.sin(a)*s.length;
        w.beams[b] = {x1:p.x,y1:p.y,x2:ex,y2:ey,life:G.dt};
        const list = EGRID.queryLine(p.x, p.y, ex, ey, s.width + 40, _EQ1);
        for(let li = 0; li < list.length; li++){
          const e = list[li];
          if(!e.alive) continue;
          const d = pointSegDist(e.x,e.y, p.x,p.y, ex,ey);
          if(d <= e.r + s.width) w._tickHits.add(e);
        }
      }
      if(damageThisFrame){
        for(const e of w._tickHits){
          if(!e.alive) continue;
          dealDamage(e, s.dmg * p.dmgMul, beamColor);
          fxBurst(e.x, e.y, beamColor, 3, 90, 2, .18);
        }
        w._tickHits.clear();
      }
    },
    levelUp(w,lv){
      if(lv===3) w.stats.count = 2;
      if(lv===5) w.stats.count = 3;
      w.stats.dmg += 12; w.stats.length += 38; w.stats.width += .8;
    },
  },
  ORBIT: {
    name:'ORBIT NODES', color:C.violet, kind:'ORBIT',
    desc:'주변을 도는 발광 노드.',
    maxLv:6,
    baseStats:{ count:1, radius:90, rotSpeed:2.2, dmg:18, nodeR:12 },
    icon(ctx,x,y,s){ drawCircle(x,y,s*.2,C.violet,8); for(let i=0;i<3;i++){ const a=(i/3)*TAU; drawCircle(x+Math.cos(a)*s*.3, y+Math.sin(a)*s*.3, s*.08, C.violet, 6, C.violet); } },
    onUpdate(p,w){
      const s = w.stats;
      w.angle = (w.angle||0) + s.rotSpeed * G.dt * p.cdMul;
      for(let i=0;i<s.count;i++){
        const a = w.angle + (i*TAU/s.count);
        const nx = p.x + Math.cos(a)*s.radius * p.areaMul;
        const ny = p.y + Math.sin(a)*s.radius * p.areaMul;
        const list = EGRID.query(nx, ny, s.nodeR + 40, _EQ1);
        for(let li = 0; li < list.length; li++){
          const e = list[li];
          if(!e.alive) continue;
          const dd = (e.x-nx)*(e.x-nx) + (e.y-ny)*(e.y-ny);
          const rr = (e.r + s.nodeR);
          if(dd < rr*rr){
            const tag = 'orb_'+w.id+'_'+i;
            if(!e.hitOrbit) e.hitOrbit = {};
            if((e.hitOrbit[tag]||0) <= 0){
              dealDamage(e, s.dmg * p.dmgMul, C.violet);
              e.hitOrbit[tag] = .35;
            }
          }
        }
        if(!w.lastNodes) w.lastNodes = [];
        w.lastNodes[i] = {x:nx, y:ny};
      }
      const el = EGRID.enemies;
      for(let ei = 0; ei < el.length; ei++){
        const e = el[ei];
        if(e.hitOrbit){ for(const k in e.hitOrbit) e.hitOrbit[k] -= G.dt; }
      }
    },
    levelUp(w,lv){
      if(lv===2||lv===4||lv===6) w.stats.count++;
      w.stats.dmg += 8; w.stats.radius += 8;
    },
  },
  HOMING: {
    name:'HOMING SHARDS', color:C.teal, kind:'HOMING',
    desc:'추적하는 다이아몬드 파편.',
    maxLv:6,
    baseStats:{ cd:1.0, dmg:28, count:1, speed:340, life:1.6 },
    icon(ctx,x,y,s){ drawDiamond(x,y,s*.25,0,C.teal,10,C.teal); },
    onUpdate(p,w){
      w.timer = (w.timer||0) - G.dt;
      if(w.timer<=0){
        const s = w.stats;
        for(let i=0;i<s.count;i++){
          const target = nearestEnemy(p);
          const a = target ? angTo(p, target) : Math.random()*TAU;
          const ang = a + (i - (s.count-1)/2) * .25;
          fireProjectile(p.x, p.y, ang, s.speed, s.dmg * p.dmgMul, s.life * p.areaMul, C.teal, 'homing', {target, turn:7});
        }
        w.timer = s.cd / p.cdMul;
      }
    },
    levelUp(w,lv){
      if(lv===2||lv===4||lv===6) w.stats.count++;
      w.stats.dmg += 12; w.stats.cd *= .94;
    },
  },
  CROSS: {
    name:'CROSS FIRE', color:C.pink, kind:'BULLET',
    desc:'4방향 십자 발사.',
    maxLv:6,
    baseStats:{ cd:.7, dmg:18, speed:420, life:1.0, count:4 },
    icon(ctx,x,y,s){ ctx.save(); ctx.strokeStyle=C.pink; ctx.shadowBlur=8; ctx.shadowColor=C.pink; ctx.lineWidth=2.4; ctx.beginPath(); ctx.moveTo(x-s*.35,y); ctx.lineTo(x+s*.35,y); ctx.moveTo(x,y-s*.35); ctx.lineTo(x,y+s*.35); ctx.stroke(); ctx.restore(); },
    onUpdate(p,w){
      w.timer = (w.timer||0) - G.dt;
      if(w.timer<=0){
        const s = w.stats;
        for(let i=0;i<s.count;i++){
          const a = (i / s.count) * TAU + (w.spin||0);
          fireProjectile(p.x, p.y, a, s.speed, s.dmg * p.dmgMul, s.life, C.pink, 'bullet');
        }
        w.spin = (w.spin||0) + .2;
        w.timer = s.cd / p.cdMul;
      }
    },
    levelUp(w,lv){
      if(lv===3||lv===5) w.stats.count += 2;
      w.stats.dmg += 8; w.stats.cd *= .93;
    },
  },
  SHOCK: {
    name:'SHOCKWAVE', color:C.magenta, kind:'AOE',
    desc:'전방 부채꼴 충격파.',
    maxLv:6,
    baseStats:{ cd:1.4, dmg:38, radius:200, arc:Math.PI*.7 },
    icon(ctx,x,y,s){ ctx.save(); ctx.strokeStyle=C.magenta; ctx.shadowBlur=10; ctx.shadowColor=C.magenta; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(x-s*.15,y, s*.4, -1.0, 1.0); ctx.stroke(); ctx.restore(); },
    onUpdate(p,w){
      w.timer = (w.timer||0) - G.dt;
      if(w.timer<=0){
        const s = w.stats;
        const aim = nearestEnemy(p);
        const a = aim ? angTo(p, aim) : (p.faceA||0);
        const ex = w.extra || {};
        fireFanShock(p.x, p.y, a, s.radius * p.areaMul, s.arc, s.dmg * p.dmgMul, { color: w.color, slow: ex.slow, slowDur: ex.slowDur });
        w.timer = s.cd / p.cdMul;
      }
    },
    levelUp(w,lv){ w.stats.dmg += 14; w.stats.radius += 30; if(lv===4||lv===6) w.stats.arc += .4; },
  },
  CHAIN: {
    name:'CHAIN BOLT', color:C.lime, kind:'CHAIN',
    desc:'적을 잇는 번개 사슬.',
    maxLv:6,
    baseStats:{ cd:1.0, dmg:32, jumps:3, range:280 },
    icon(ctx,x,y,s){ ctx.save(); ctx.strokeStyle=C.lime; ctx.shadowBlur=10; ctx.shadowColor=C.lime; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x-s*.35,y-s*.3); ctx.lineTo(x-s*.05,y); ctx.lineTo(x+s*.1,y-s*.1); ctx.lineTo(x+s*.35,y+s*.3); ctx.stroke(); ctx.restore(); },
    onUpdate(p,w){
      w.timer = (w.timer||0) - G.dt;
      if(w.timer<=0){
        const s = w.stats;
        const ex = w.extra || {};
        const col = w.color || C.lime;
        const forkN = ex.fork || 0;
        let from = p, hit = new Set();
        let hitCount = 0;
        for(let i=0;i<s.jumps;i++){
          const tgt = nearestEnemyExcept(from, hit, s.range);
          if(!tgt) break;
          // Beefed-up bolt: thicker line, longer flash, brighter particle burst.
          fxLine(from.x, from.y, tgt.x, tgt.y, col, .35, 4.5);
          dealDamage(tgt, s.dmg * p.dmgMul * (1 - i*.1), col);
          fxBurst(tgt.x, tgt.y, col, 10, 170, 2.5, .3);
          fxRing(tgt.x, tgt.y, col, 22, .25);
          hit.add(tgt); hitCount++;
          for(let f = 0; f < forkN; f++){
            const ftgt = nearestEnemyExcept(tgt, hit, s.range * .7);
            if(!ftgt) break;
            fxLine(tgt.x, tgt.y, ftgt.x, ftgt.y, col, .25, 3);
            dealDamage(ftgt, s.dmg * p.dmgMul * .55, col);
            fxBurst(ftgt.x, ftgt.y, col, 6, 120, 2, .25);
            hit.add(ftgt);
          }
          from = tgt;
        }
        // Player-side spark feedback so the weapon "feels alive" even when no
        // chains land (range whiff). Small flicker, cheap on the budget.
        fxBurst(p.x, p.y, col, hitCount > 0 ? 6 : 3, 90, 1.5, .2);
        AUDIO.laser(from ? from.x : p.x);
        w.timer = s.cd / p.cdMul;
      }
    },
    levelUp(w,lv){ if(lv===3||lv===5) w.stats.jumps++; w.stats.dmg += 12; w.stats.range += 36; },
  },
  BLADE: {
    name:'SHURIKEN', color:C.cyan, kind:'BULLET',
    desc:'관통하는 회전 칼날.',
    maxLv:6,
    baseStats:{ cd:1.0, dmg:30, speed:330, life:1.2, count:1, pierce:3 },
    icon(ctx,x,y,s){ drawStar(x,y,4,s*.4,s*.18,Math.PI/4,C.cyan,10,C.cyan,1.6); },
    onUpdate(p,w){
      w.timer = (w.timer||0) - G.dt;
      if(w.timer<=0){
        const s = w.stats;
        // Aim at the nearest enemy; if multiple shuriken, fan them out around the aim.
        const target = nearestEnemy(p);
        const aimA = target ? angTo(p, target) : Math.random()*TAU;
        for(let i=0;i<s.count;i++){
          const spread = (i - (s.count-1)/2) * .22;
          const a = aimA + spread;
          fireProjectile(p.x, p.y, a, s.speed, s.dmg * p.dmgMul, s.life, C.cyan, 'shuriken', {pierce:s.pierce, spin:Math.random()*TAU});
        }
        w.timer = s.cd / p.cdMul;
      }
    },
    levelUp(w,lv){ if(lv===3||lv===5) w.stats.count++; if(lv===4||lv===6) w.stats.pierce++; w.stats.dmg += 10; },
  },
  BLACKHOLE: {
    name:'SINGULARITY', color:C.violet, kind:'BLACKHOLE',
    desc:'블랙홀로 적을 빨아들임.',
    maxLv:6,
    baseStats:{ cd:7, dmg:8, radius:180, life:3, pull:160 },
    icon(ctx,x,y,s){ ctx.save(); for(let i=0;i<3;i++){ ctx.strokeStyle=C.violet; ctx.shadowBlur=10; ctx.shadowColor=C.violet; ctx.lineWidth=1.4; ctx.globalAlpha=1-i*.3; ctx.beginPath(); ctx.arc(x,y, s*.1+i*s*.13, 0, TAU); ctx.stroke(); } ctx.restore(); },
    onUpdate(p,w){
      w.timer = (w.timer||0) - G.dt;
      if(w.timer<=0){
        const s = w.stats;
        const ex = w.extra || {};
        const count = ex.multi || 1;
        const scatter = ex.scatter || 0;
        for(let i = 0; i < count; i++){
          const aim = nearestEnemy(p);
          let tx = aim ? aim.x : p.x + rand(-200,200);
          let ty = aim ? aim.y : p.y + rand(-200,200);
          if(count > 1){ tx += rand(-scatter, scatter); ty += rand(-scatter, scatter); }
          const bh = spawnBlackhole(tx, ty, s.radius * p.areaMul, s.life * p.areaMul, s.pull, s.dmg * p.dmgMul);
          // SUPERNOVA: stash burst params on the blackhole; gameloop's blackhole
          // expiry path checks `bh.implodeBurst` to fire a final detonation.
          if(ex.implode && bh){
            bh.implodeBurst = (s.dmg * p.dmgMul) * (ex.burstMul || 3);
            bh.implodeR = s.radius * p.areaMul * 1.4;
          }
        }
        w.timer = s.cd / p.cdMul;
      }
    },
    levelUp(w,lv){ w.stats.radius += 22; w.stats.dmg += 4; w.stats.life += .5; },
  },
  PRISM: {
    name:'PRISM SPLIT', color:C.gold, kind:'BULLET',
    desc:'명중 시 분열하는 빛 화살.',
    maxLv:6,
    baseStats:{ cd:1.4, dmg:26, speed:380, life:1.2, splits:3 },
    icon(ctx,x,y,s){ drawPolygon(x,y,3,s*.3,Math.PI,C.gold,10); drawCircle(x,y,s*.08,'#fff',6,'#fff'); },
    onUpdate(p,w){
      w.timer = (w.timer||0) - G.dt;
      if(w.timer<=0){
        const s = w.stats;
        const target = nearestEnemy(p);
        const a = target ? angTo(p, target) : Math.random()*TAU;
        fireProjectile(p.x, p.y, a, s.speed, s.dmg * p.dmgMul, s.life, C.gold, 'prism', {splits:s.splits});
        w.timer = s.cd / p.cdMul;
      }
    },
    levelUp(w,lv){ if(lv===3||lv===6) w.stats.splits++; w.stats.dmg += 8; w.stats.cd *= .94; },
  },
};

/* ===================================================================
   EVOLUTIONS — each weapon now has 3 paths gated by different passives.
   Player can replay with different passive builds to unlock different evos.

   Schema: EVOLUTIONS[WEAPON_KEY] = [ {id, name, color, req, desc, apply}, ... ]

   `extra` flags introduced (status):
   - {double:true}            ✓ wired (PULSE 2nd pulse)
   - {triple:true, ringDelay} ✓ wired (3-tap pulse)
   - {subSplit:N}             ✓ wired (PRISM split-of-split)
   - {slow:f, slowDur:s}      ✓ wired (enemy slow on hit, applied via dealDamage path)
   - {chill:s, slow:f}        ✓ wired (alias for slow)
   - {fork:N}                 ✓ wired (CHAIN extra arcs from each jump)
   - {multi:N, scatter:px}    ✓ wired (BLACKHOLE multi-spawn)
   - {implode:true, burstMul} ✓ wired (BLACKHOLE death burst)
   - {randomAim:true}         ✓ wired (BEAM each beam random angle offset)
   - {regenBoost, lifesteal}  ◌ partial (regen applied at evo apply time)
   - others (burn/blast/return/spiral/...)  ◌ stat-only (no behavior wired yet)
   =================================================================== */
export const EVOLUTIONS = {
  PULSE: [
    {
      id:'EVO_PULSE_SUN', name:'SUN PULSE', color:C.gold, req:['POWER'],
      desc:'2중 폭발 거대 광파 — 쿨감 + 초대형 반경',
      apply: w => { w.stats.cd*=.55; w.stats.dmg*=1.9; w.stats.radius*=1.7; w.stats.kb*=1.6; w.evolved=true; w.color=C.gold; w.extra={double:true}; }
    },
    {
      id:'EVO_PULSE_STORM', name:'STORM PULSE', color:C.violet, req:['CADENCE'],
      desc:'초고속 연쇄 폭발 — 작지만 끊임없이 터진다',
      apply: w => { w.stats.cd*=.32; w.stats.dmg*=.85; w.stats.radius*=.9; w.stats.kb*=.7; w.evolved=true; w.color=C.violet; w.extra={triple:true, ringDelay:.12}; }
    },
    {
      id:'EVO_PULSE_GLACIAL', name:'GLACIAL RING', color:C.teal, req:['REACH'],
      desc:'거대 빙결 파동 — 적 둔화 + 강력한 넉백',
      apply: w => { w.stats.cd*=.9; w.stats.dmg*=1.3; w.stats.radius*=2.1; w.stats.kb*=2.4; w.evolved=true; w.color=C.teal; w.extra={slow:.45, slowDur:1.2}; }
    },
  ],

  BEAM: [
    {
      id:'EVO_BEAM_SOLAR', name:'SOLAR CROWN', color:C.gold, req:['REACH'],
      desc:'6갈래 회전 태양관 — 사거리 폭증',
      apply: w => { w.stats.count=6; w.stats.length*=1.5; w.stats.dmg*=1.8; w.stats.width+=3; w.stats.tick*=.6; w.stats.rotSpeed*=1.2; w.evolved=true; w.color=C.gold; }
    },
    {
      id:'EVO_BEAM_VOID', name:'VOID LANCE', color:C.magenta, req:['POWER'],
      desc:'초고밀도 단일 빔 — 보스 관통형 단발',
      apply: w => { w.stats.count=1; w.stats.length*=1.8; w.stats.dmg*=2.6; w.stats.width+=8; w.stats.rotSpeed*=.55; w.stats.tick*=.5; w.evolved=true; w.color=C.magenta; w.extra={pierceAll:true}; }
    },
    {
      id:'EVO_BEAM_PRISM', name:'PRISM RAY', color:C.pink, req:['LUCK'],
      desc:'무작위 분기 광선 — 3갈래 굴절 조준',
      apply: w => { w.stats.count=3; w.stats.length*=1.3; w.stats.dmg*=1.5; w.stats.width+=2; w.stats.rotSpeed*=1.6; w.stats.tick*=.7; w.evolved=true; w.color=C.pink; w.extra={randomAim:true, dropBoost:.25}; }
    },
  ],

  ORBIT: [
    {
      id:'EVO_ORBIT_VOID', name:'VOID HALO', color:C.violet, req:['CADENCE'],
      desc:'8노드 고속 공전 — 중거리 면제압',
      apply: w => { w.stats.count=8; w.stats.dmg*=1.7; w.stats.radius*=1.35; w.stats.rotSpeed*=1.4; w.stats.nodeR*=1.25; w.evolved=true; w.color=C.violet; }
    },
    {
      id:'EVO_ORBIT_SOLAR', name:'SOLAR CORONA', color:C.gold, req:['POWER'],
      desc:'거대 3노드 — 접촉 시 폭발하는 태양',
      apply: w => { w.stats.count=3; w.stats.dmg*=2.2; w.stats.radius*=1.9; w.stats.rotSpeed*=.75; w.stats.nodeR*=2.4; w.evolved=true; w.color=C.gold; w.extra={burst:true, burstR:90, burstDmg:.6}; }
    },
    {
      id:'EVO_ORBIT_LIFE', name:'LIFE BLOOM', color:C.lime, req:['SOUL'],
      desc:'생명의 고리 — 노드 적중 시 체력 회복',
      apply: w => { w.stats.count=5; w.stats.dmg*=1.5; w.stats.radius*=1.2; w.stats.rotSpeed*=1.15; w.stats.nodeR*=1.4; w.evolved=true; w.color=C.lime; w.extra={lifesteal:.04, regenBoost:.6}; }
    },
  ],

  HOMING: [
    {
      id:'EVO_HOMING_MISSILE', name:'MISSILE SWARM', color:C.teal, req:['POWER'],
      desc:'8발 연속 추적 — 끈질긴 추격',
      apply: w => { w.stats.count=8; w.stats.dmg*=1.6; w.stats.cd*=.45; w.stats.speed*=1.35; w.stats.life*=1.3; w.evolved=true; w.color=C.teal; }
    },
    {
      id:'EVO_HOMING_VOID', name:'VOID HARPOON', color:C.violet, req:['POWER'],
      desc:'단일 거대 탄 — 관통하며 폭발',
      apply: w => { w.stats.count=1; w.stats.dmg*=2.6; w.stats.cd*=1.15; w.stats.speed*=1.5; w.stats.life*=1.6; w.stats.pierce=6; w.evolved=true; w.color=C.violet; w.extra={blast:80}; }
    },
    {
      id:'EVO_HOMING_SOLAR', name:'SOLAR FLARE', color:C.gold, req:['CADENCE'],
      desc:'쾌속 연사 — 적중 시 화염 잔류',
      apply: w => { w.stats.count=3; w.stats.dmg*=1.25; w.stats.cd*=.3; w.stats.speed*=1.2; w.stats.life*=.9; w.evolved=true; w.color=C.gold; w.extra={burn:true, burnDmg:6, burnDur:1.2}; }
    },
  ],

  CROSS: [
    {
      id:'EVO_CROSS_STAR', name:'STAR CROSS', color:C.pink, req:['CADENCE'],
      desc:'12방향 별빛 난사 — 빈틈없는 포위',
      apply: w => { w.stats.count=12; w.stats.dmg*=1.5; w.stats.cd*=.55; w.stats.life*=1.2; w.evolved=true; w.color=C.pink; }
    },
    {
      id:'EVO_CROSS_TEMPEST', name:'TEMPEST SPIRAL', color:C.cyan, req:['HASTE'],
      desc:'8갈래 나선 회전탄 — 휘몰아치는 폭풍',
      apply: w => { w.stats.count=8; w.stats.dmg*=1.4; w.stats.cd*=.7; w.stats.speed*=1.15; w.stats.life*=1.5; w.evolved=true; w.color=C.cyan; w.extra={spiral:true, curl:1.8}; }
    },
    {
      id:'EVO_CROSS_GLACIAL', name:'GLACIAL WAVE', color:C.teal, req:['POWER'],
      desc:'4방향 빙결 파동 — 적중 시 둔화',
      apply: w => { w.stats.count=4; w.stats.dmg*=2.0; w.stats.cd*=.85; w.stats.speed*=.85; w.stats.life*=1.8; w.evolved=true; w.color=C.teal; w.extra={slow:.5, slowDur:1.5, wide:2.2}; }
    },
  ],

  BLADE: [
    {
      id:'EVO_BLADE_GHOST', name:'GHOST BLADES', color:C.white, req:['POWER'],
      desc:'6장 유령 칼날 — 무한 관통의 잔상',
      apply: w => { w.stats.count=6; w.stats.pierce=9; w.stats.dmg*=1.55; w.stats.speed*=1.25; w.stats.life*=1.2; w.evolved=true; w.color=C.white; }
    },
    {
      id:'EVO_BLADE_BOOMERANG', name:'BOOMERANG FANG', color:C.lime, req:['MAGNET'],
      desc:'2장 회귀 칼날 — 두 번 베고 돌아온다',
      apply: w => { w.stats.count=2; w.stats.pierce=6; w.stats.dmg*=1.7; w.stats.cd*=.9; w.stats.life*=1.6; w.evolved=true; w.color=C.lime; w.extra={returns:true, magnetPull:true}; }
    },
    {
      id:'EVO_BLADE_CHAOS', name:'CHAOS RIPPER', color:C.magenta, req:['POWER'],
      desc:'관통 시 폭발 — 카오스 파편 비산',
      apply: w => { w.stats.count=3; w.stats.pierce=4; w.stats.dmg*=1.6; w.stats.cd*=.85; w.stats.speed*=1.1; w.evolved=true; w.color=C.magenta; w.extra={blastOnPierce:true, blastR:70, blastDmg:14}; }
    },
  ],

  PRISM: [
    {
      id:'EVO_PRISM_RAINBOW', name:'RAINBOW LANCE', color:C.gold, req:['LUCK'],
      desc:'분열의 분열 — 무지개로 흩어지는 빛',
      apply: w => { w.stats.splits=6; w.stats.dmg*=1.8; w.stats.cd*=.7; w.stats.speed*=1.2; w.evolved=true; w.color=C.gold; w.extra={subSplit:2}; }
    },
    {
      id:'EVO_PRISM_SHADOW', name:'SHADOW REFRACT', color:C.violet, req:['CADENCE'],
      desc:'분열마다 추적 호밍 — 그림자가 적을 찾는다',
      apply: w => { w.stats.splits=4; w.stats.count=2; w.stats.dmg*=1.5; w.stats.cd*=.6; w.stats.life*=1.4; w.evolved=true; w.color=C.violet; w.extra={homingSplit:true, turn:3.5}; }
    },
    {
      id:'EVO_PRISM_LIFE', name:'AURORA BLOOM', color:C.lime, req:['SOUL'],
      desc:'분열 시 광역 폭발 — 생명의 개화',
      apply: w => { w.stats.splits=3; w.stats.dmg*=2.0; w.stats.cd*=.9; w.evolved=true; w.color=C.lime; w.extra={bloomBlast:true, bloomR:90, bloomDmg:20}; }
    },
  ],

  SHOCK: [
    {
      id:'EVO_SHOCK_CATACLYSM', name:'CATACLYSM', color:C.magenta, req:['REACH'],
      desc:'360° 대격변 — 전방위 충격파',
      apply: w => { w.stats.arc=TAU; w.stats.radius*=1.6; w.stats.dmg*=1.9; w.stats.cd*=.75; w.evolved=true; w.color=C.magenta; }
    },
    {
      id:'EVO_SHOCK_RAIL', name:'RAILGUN', color:C.cyan, req:['POWER'],
      desc:'초장거리 관통 저격 — 좁고 깊게',
      apply: w => { w.stats.arc=Math.PI*.12; w.stats.radius*=2.6; w.stats.dmg*=2.4; w.stats.cd*=.9; w.evolved=true; w.color=C.cyan; w.extra={pierceAll:true}; }
    },
    {
      id:'EVO_SHOCK_GLACIER', name:'GLACIER BURST', color:C.teal, req:['CADENCE'],
      desc:'빙결 연발 — 적중 시 둔화',
      apply: w => { w.stats.cd*=.45; w.stats.dmg*=1.25; w.stats.radius*=1.15; w.evolved=true; w.color=C.teal; w.extra={slow:.55, slowDur:.6}; }
    },
  ],

  CHAIN: [
    {
      id:'EVO_CHAIN_THUNDER', name:'THUNDER GOD', color:C.gold, req:['POWER'],
      desc:'뇌신 — 점프 +5, 사거리 +30%',
      apply: w => { w.stats.jumps+=5; w.stats.dmg*=1.7; w.stats.range*=1.3; w.stats.cd*=.65; w.evolved=true; w.color=C.gold; }
    },
    {
      id:'EVO_CHAIN_TEMPEST', name:'TEMPEST COIL', color:C.violet, req:['CADENCE'],
      desc:'근거리 폭풍 — 짧지만 끊임없이 난타',
      apply: w => { w.stats.cd*=.3; w.stats.range*=.55; w.stats.jumps+=2; w.stats.dmg*=.85; w.evolved=true; w.color=C.violet; w.extra={storm:true}; }
    },
    {
      id:'EVO_CHAIN_FORKED', name:'FORKED DOOM', color:C.lime, req:['LUCK'],
      desc:'분기 낙뢰 — 각 점프마다 2갈래 분열',
      apply: w => { w.stats.dmg*=1.4; w.stats.jumps+=1; w.stats.range*=1.15; w.stats.cd*=.85; w.evolved=true; w.color=C.lime; w.extra={fork:2}; }
    },
  ],

  BLACKHOLE: [
    {
      id:'EVO_BH_GRAVITY', name:'GRAVITY KING', color:C.violet, req:['REACH'],
      desc:'중력왕 — 거대 블랙홀, 강한 흡인',
      apply: w => { w.stats.radius*=1.7; w.stats.dmg*=2.1; w.stats.pull*=1.4; w.stats.cd*=.55; w.stats.life*=1.5; w.evolved=true; w.color=C.violet; }
    },
    {
      id:'EVO_BH_SUPERNOVA', name:'SUPERNOVA', color:C.gold, req:['POWER'],
      desc:'초신성 — 소멸 시 거대 폭발',
      apply: w => { w.stats.life*=.7; w.stats.dmg*=1.5; w.stats.radius*=1.2; w.stats.cd*=.7; w.evolved=true; w.color=C.gold; w.extra={implode:true, burstMul:3.2}; }
    },
    {
      id:'EVO_BH_SWARM', name:'VOID SWARM', color:C.pink, req:['CADENCE'],
      desc:'소형 특이점 산개 — 동시 3개 생성',
      apply: w => { w.stats.radius*=.6; w.stats.dmg*=.7; w.stats.pull*=.8; w.stats.life*=.85; w.stats.cd*=.5; w.evolved=true; w.color=C.pink; w.extra={multi:3, scatter:140}; }
    },
  ],
};

/* ===================================================================
   FUSIONS — combine two evolved weapons into a new one at Lv 1.
   Fusion offered as a card when BOTH weapons are at maxLv AND BOTH evolved,
   appended as an EXTRA slot (does not displace base build-progress cards).
   Picking removes both source weapons and adds the fused weapon at Lv 1.

   Each fusion defines its own onUpdate so the resulting weapon expresses
   both source identities — Lv 1 is balanced to feel stronger than the two
   source maxLv evolutions combined (justify the trade), then scales via
   its own levelUp curve.
   =================================================================== */
export const FUSIONS = {
  'BEAM+PRISM': {
    id:'FUSE_PRISM_HALO', name:'PRISM HALO', color:C.gold, kind:'BEAM',
    desc:'무지개 회전 빔 — 적중 시 분열탄 비산',
    sourceA:'BEAM', sourceB:'PRISM',
    baseStats:{ rotSpeed:2.0, dmg:60, length:600, width:9, count:4, tick:.10, splits:2 },
    maxLv:6,
    levelUp:(w,lv)=>{ w.stats.dmg+=14; w.stats.length+=30; if(lv===2||lv===4) w.stats.count++; if(lv===3||lv===5) w.stats.splits++; },
    extra:{splitOnTick:true},
    onUpdate(p,w){
      w.angle = (w.angle||0) + w.stats.rotSpeed * G.dt;
      w.tickT = (w.tickT||0) - G.dt;
      const s = w.stats;
      const tickEvery = s.tick / p.cdMul;
      const damageThisFrame = w.tickT <= 0;
      if(damageThisFrame) w.tickT = tickEvery;
      if(!w.beams) w.beams = [];
      if(w.beams.length !== s.count) w.beams.length = s.count;
      const col = w.color || C.gold;
      // Same hit-tracking pattern as base BEAM — capture all enemies that
      // overlap any beam frame so fast crossers aren't missed.
      if(!w._tickHits) w._tickHits = new Map(); // enemy → angle (for shard direction)
      for(let b=0;b<s.count;b++){
        const a = w.angle + (b * TAU/s.count);
        const ex = p.x + Math.cos(a)*s.length;
        const ey = p.y + Math.sin(a)*s.length;
        w.beams[b] = {x1:p.x,y1:p.y,x2:ex,y2:ey,life:G.dt};
        const list = EGRID.queryLine(p.x, p.y, ex, ey, s.width + 40, _EQ1);
        for(let li = 0; li < list.length; li++){
          const e = list[li];
          if(!e.alive) continue;
          const d = pointSegDist(e.x,e.y, p.x,p.y, ex,ey);
          if(d <= e.r + s.width && !w._tickHits.has(e)) w._tickHits.set(e, a);
        }
      }
      if(damageThisFrame){
        for(const [e, a] of w._tickHits){
          if(!e.alive) continue;
          dealDamage(e, s.dmg * p.dmgMul, col);
          fxBurst(e.x, e.y, col, 4, 120, 2.2, .22);
          const shardA = a + (Math.random()-.5) * .8;
          fireProjectile(e.x, e.y, shardA, 280, s.dmg * p.dmgMul * .35, .9, col, 'prism', {splits:s.splits});
        }
        w._tickHits.clear();
      }
    },
  },
  'BLACKHOLE+ORBIT': {
    id:'FUSE_VOID_PULSAR', name:'VOID PULSAR', color:C.violet, kind:'ORBIT',
    desc:'궤도 노드 각각이 중력장을 끌며 회전',
    sourceA:'BLACKHOLE', sourceB:'ORBIT',
    baseStats:{ count:3, radius:120, rotSpeed:2.0, dmg:30, nodeR:18, pull:90, pullR:90 },
    maxLv:6,
    levelUp:(w,lv)=>{ w.stats.dmg+=8; w.stats.radius+=8; if(lv===2||lv===4) w.stats.count++; if(lv===3||lv===5) w.stats.pull+=30; },
    extra:{nodesPullEnemies:true},
    onUpdate(p,w){
      const s = w.stats;
      w.angle = (w.angle||0) + s.rotSpeed * G.dt * p.cdMul;
      if(!w.lastNodes) w.lastNodes = [];
      const col = w.color || C.violet;
      // Single query at the larger of pull/nodeR — distance below splits roles.
      const pullR40 = s.pullR + 40;
      for(let i=0;i<s.count;i++){
        const a = w.angle + (i*TAU/s.count);
        const nx = p.x + Math.cos(a)*s.radius * p.areaMul;
        const ny = p.y + Math.sin(a)*s.radius * p.areaMul;
        const list = EGRID.query(nx, ny, pullR40, _EQ1);
        for(let li = 0; li < list.length; li++){
          const e = list[li];
          if(!e.alive) continue;
          const dx = nx-e.x, dy = ny-e.y;
          const d2 = dx*dx + dy*dy;
          if(!e.isBoss && d2 < pullR40*pullR40){
            const dist = Math.sqrt(d2) + .01;
            const force = s.pull * (1 - dist/pullR40) * G.dt;
            e.vx += (dx/dist) * force;
            e.vy += (dy/dist) * force;
          }
          const rr = e.r + s.nodeR;
          if(d2 < rr*rr){
            const tag = 'vp_'+w.id+'_'+i;
            if(!e.hitOrbit) e.hitOrbit = {};
            if((e.hitOrbit[tag]||0) <= 0){
              dealDamage(e, s.dmg * p.dmgMul, col);
              fxBurst(e.x,e.y,col,8,160,2.4,.25);
              e.hitOrbit[tag] = .35;
            }
          }
        }
        w.lastNodes[i] = {x:nx, y:ny};
      }
      const el = EGRID.enemies;
      for(let ei = 0; ei < el.length; ei++){
        const e = el[ei];
        if(e.hitOrbit){ for(const k in e.hitOrbit) e.hitOrbit[k] -= G.dt; }
      }
    },
  },
  'PULSE+SHOCK': {
    id:'FUSE_SEISMIC_BLOOM', name:'SEISMIC BLOOM', color:C.red, kind:'AOE',
    desc:'전방위 충격 + 후속 잔진의 연쇄',
    sourceA:'PULSE', sourceB:'SHOCK',
    baseStats:{ cd:1.4, dmg:60, radius:230, kb:200, aftershockR:140, aftershockDmg:30, aftershockDelay:.35 },
    maxLv:6,
    levelUp:(w,lv)=>{ w.stats.dmg+=14; w.stats.radius+=16; w.stats.aftershockR+=12; if(lv===3||lv===5) w.stats.aftershockDmg+=12; },
    extra:{doublePulse:true},
    onUpdate(p,w){
      w.timer = (w.timer||0) - G.dt;
      if(!w.pendingPulses) w.pendingPulses = [];
      for(let i = w.pendingPulses.length - 1; i >= 0; i--){
        const pp = w.pendingPulses[i];
        pp.t -= G.dt;
        if(pp.t <= 0){
          firePulse(pp.x, pp.y, pp.r, pp.dmg, pp.kb, {color: pp.col});
          fxRing(pp.x, pp.y, pp.col, pp.r * .7, .35);
          w.pendingPulses.splice(i, 1);
        }
      }
      if(w.timer <= 0){
        const s = w.stats;
        const col = w.color || C.red;
        firePulse(p.x, p.y, s.radius * p.areaMul, s.dmg * p.dmgMul, s.kb, {color: col});
        fxRing(p.x, p.y, col, s.radius * p.areaMul, .55);
        // Aftershock waves spreading outward
        w.pendingPulses.push({
          x: p.x, y: p.y, t: s.aftershockDelay,
          r: s.aftershockR * p.areaMul,
          dmg: s.aftershockDmg * p.dmgMul, kb: s.kb * .5, col,
        });
        w.pendingPulses.push({
          x: p.x, y: p.y, t: s.aftershockDelay * 2,
          r: s.aftershockR * p.areaMul * 1.4,
          dmg: s.aftershockDmg * p.dmgMul * .7, kb: s.kb * .35, col,
        });
        w.timer = s.cd / p.cdMul;
      }
    },
  },
  'CHAIN+HOMING': {
    id:'FUSE_TESLA_SWARM', name:'TESLA SWARM', color:C.cyan, kind:'HOMING',
    desc:'추적 전구체 — 발사 직후 연쇄 방전',
    sourceA:'CHAIN', sourceB:'HOMING',
    baseStats:{ cd:.85, dmg:42, count:2, speed:360, life:1.8, jumps:3, jumpRange:200, jumpDmg:.7 },
    maxLv:6,
    levelUp:(w,lv)=>{ w.stats.dmg+=10; if(lv===2||lv===4) w.stats.count++; if(lv===3||lv===5) w.stats.jumps++; w.stats.jumpRange+=12; },
    extra:{onHitChain:true},
    onUpdate(p,w){
      w.timer = (w.timer||0) - G.dt;
      if(w.timer<=0){
        const s = w.stats;
        const col = w.color || C.cyan;
        const target = nearestEnemy(p);
        for(let i=0;i<s.count;i++){
          const a = target ? angTo(p, target) : Math.random()*TAU;
          const ang = a + (i - (s.count-1)/2) * .25;
          fireProjectile(p.x, p.y, ang, s.speed, s.dmg * p.dmgMul, s.life * p.areaMul, col, 'homing', {target, turn:7});
        }
        // Companion chain bolt arcs from the player into the swarm.
        if(target){
          let from = p; const hit = new Set();
          for(let j=0;j<s.jumps;j++){
            const tgt = nearestEnemyExcept(from, hit, s.jumpRange);
            if(!tgt) break;
            fxLine(from.x, from.y, tgt.x, tgt.y, col, .3, 3.5);
            dealDamage(tgt, s.dmg * p.dmgMul * s.jumpDmg * (1 - j*.1), col);
            fxBurst(tgt.x, tgt.y, col, 6, 130, 2, .22);
            hit.add(tgt); from = tgt;
          }
          AUDIO.laser(target.x);
        }
        w.timer = s.cd / p.cdMul;
      }
    },
  },
  'BEAM+BLACKHOLE': {
    id:'FUSE_EVENT_LANCE', name:'EVENT LANCE', color:C.magenta, kind:'BEAM',
    desc:'특이점 빔 — 끝점에서 적을 흡인하며 폭발',
    sourceA:'BEAM', sourceB:'BLACKHOLE',
    baseStats:{ rotSpeed:1.0, dmg:70, length:560, width:10, count:1, tick:.10, tipPull:200, tipR:80, tipDmg:14 },
    maxLv:6,
    levelUp:(w,lv)=>{ w.stats.dmg+=16; w.stats.length+=28; w.stats.tipR+=8; if(lv===3||lv===5) w.stats.count++; },
    extra:{tipSingularity:true},
    onUpdate(p,w){
      w.angle = (w.angle||0) + w.stats.rotSpeed * G.dt;
      w.tickT = (w.tickT||0) - G.dt;
      const s = w.stats;
      const tickEvery = s.tick / p.cdMul;
      const damageThisFrame = w.tickT <= 0;
      if(damageThisFrame) w.tickT = tickEvery;
      if(!w.beams) w.beams = [];
      if(w.beams.length !== s.count) w.beams.length = s.count;
      const col = w.color || C.magenta;
      // Same hit-tracking as base BEAM: beam-line and tip-area hits accumulate
      // every frame so fast crossers aren't missed; flushed on each tick.
      if(!w._beamHits) w._beamHits = new Set();
      if(!w._tipHits)  w._tipHits  = new Set();
      for(let b=0;b<s.count;b++){
        const a = w.angle + (b * TAU/s.count);
        const ex = p.x + Math.cos(a)*s.length;
        const ey = p.y + Math.sin(a)*s.length;
        w.beams[b] = {x1:p.x,y1:p.y,x2:ex,y2:ey,life:G.dt};
        // Tip pull (every frame)
        const tipR = s.tipR * p.areaMul;
        const tipList = EGRID.query(ex, ey, tipR + 40, _EQ1);
        for(let li = 0; li < tipList.length; li++){
          const e = tipList[li];
          if(!e.alive || e.isBoss) continue;
          const dx = ex-e.x, dy = ey-e.y;
          const dist = Math.sqrt(dx*dx + dy*dy) + .01;
          if(dist < tipR + 40){
            const force = s.tipPull * (1 - dist/(tipR+40)) * G.dt;
            e.vx += (dx/dist) * force;
            e.vy += (dy/dist) * force;
          }
        }
        // Beam-line hit accumulation
        const lineList = EGRID.queryLine(p.x, p.y, ex, ey, s.width + 40, _EQ1);
        for(let li = 0; li < lineList.length; li++){
          const e = lineList[li];
          if(!e.alive) continue;
          const d = pointSegDist(e.x,e.y, p.x,p.y, ex,ey);
          if(d <= e.r + s.width) w._beamHits.add(e);
        }
        // Tip-area hit accumulation
        for(let li = 0; li < tipList.length; li++){
          const e = tipList[li];
          if(!e.alive) continue;
          const dd = (e.x-ex)*(e.x-ex) + (e.y-ey)*(e.y-ey);
          if(dd < (e.r + tipR)*(e.r + tipR)) w._tipHits.add(e);
        }
        if(damageThisFrame){
          fxRing(ex, ey, col, tipR, .18);
        }
      }
      if(damageThisFrame){
        for(const e of w._beamHits){
          if(!e.alive) continue;
          dealDamage(e, s.dmg * p.dmgMul, col);
          fxBurst(e.x, e.y, col, 4, 110, 2.2, .2);
        }
        for(const e of w._tipHits){
          if(!e.alive) continue;
          dealDamage(e, s.tipDmg * p.dmgMul, col);
        }
        w._beamHits.clear();
        w._tipHits.clear();
      }
    },
  },
  'BLADE+CROSS': {
    id:'FUSE_SHURIKEN_CROSS', name:'SHURIKEN CROSS', color:C.lime, kind:'BULLET',
    desc:'십자 패턴 관통 수리검 — 회전하며 적을 가른다',
    sourceA:'BLADE', sourceB:'CROSS',
    baseStats:{ cd:.65, dmg:38, count:4, speed:380, life:1.4, pierce:4 },
    maxLv:6,
    levelUp:(w,lv)=>{ w.stats.dmg+=9; if(lv===2||lv===4) w.stats.count+=2; if(lv===3||lv===5) w.stats.pierce++; w.stats.speed+=12; },
    extra:{boomerang:true, crossPattern:true},
    onUpdate(p,w){
      w.timer = (w.timer||0) - G.dt;
      if(w.timer<=0){
        const s = w.stats;
        const col = w.color || C.lime;
        const target = nearestEnemy(p);
        const aimA = target ? angTo(p, target) : (w.spin||0);
        // Cross pattern: shuriken evenly distributed in TAU around aim.
        for(let i=0;i<s.count;i++){
          const a = aimA + (i / s.count) * TAU;
          fireProjectile(p.x, p.y, a, s.speed, s.dmg * p.dmgMul, s.life, col, 'shuriken', {pierce:s.pierce, spin:Math.random()*TAU});
        }
        w.spin = (w.spin||0) + .3;
        w.timer = s.cd / p.cdMul;
      }
    },
  },
  'HOMING+PRISM': {
    id:'FUSE_SPECTRAL_SHARDS', name:'SPECTRAL SHARDS', color:C.pink, kind:'HOMING',
    desc:'추적 파편 — 명중 시 더 작은 추적탄으로 분열',
    sourceA:'HOMING', sourceB:'PRISM',
    baseStats:{ cd:.9, dmg:40, count:2, speed:360, life:1.6, splits:3 },
    maxLv:6,
    levelUp:(w,lv)=>{ w.stats.dmg+=10; if(lv===2||lv===4) w.stats.count++; if(lv===3||lv===5) w.stats.splits++; },
    extra:{splitsAlsoHome:true},
    onUpdate(p,w){
      w.timer = (w.timer||0) - G.dt;
      if(w.timer<=0){
        const s = w.stats;
        const col = w.color || C.pink;
        for(let i=0;i<s.count;i++){
          const target = nearestEnemy(p);
          const a = target ? angTo(p, target) : Math.random()*TAU;
          const ang = a + (i - (s.count-1)/2) * .2;
          // Prism kind splits on death — combined with target hint behaves as homing+split.
          fireProjectile(p.x, p.y, ang, s.speed, s.dmg * p.dmgMul, s.life * p.areaMul, col, 'prism', {splits:s.splits, target, turn:5});
        }
        w.timer = s.cd / p.cdMul;
      }
    },
  },
  'ORBIT+PULSE': {
    id:'FUSE_RESONANT_RING', name:'RESONANT RING', color:C.teal, kind:'ORBIT',
    desc:'궤도 노드 주기적 펄스 방출',
    sourceA:'ORBIT', sourceB:'PULSE',
    baseStats:{ count:2, radius:100, rotSpeed:2.4, dmg:28, nodeR:14, pulseCd:1.6, pulseR:90, pulseDmg:30 },
    maxLv:6,
    levelUp:(w,lv)=>{ w.stats.dmg+=8; w.stats.pulseDmg+=10; w.stats.pulseR+=8; if(lv===2||lv===4) w.stats.count++; },
    extra:{nodesEmitPulse:true},
    onUpdate(p,w){
      const s = w.stats;
      w.angle = (w.angle||0) + s.rotSpeed * G.dt * p.cdMul;
      w.pulseT = (w.pulseT||0) - G.dt;
      const doPulseTick = w.pulseT <= 0;
      if(doPulseTick) w.pulseT = s.pulseCd / p.cdMul;
      if(!w.lastNodes) w.lastNodes = [];
      const col = w.color || C.teal;
      for(let i=0;i<s.count;i++){
        const a = w.angle + (i*TAU/s.count);
        const nx = p.x + Math.cos(a)*s.radius * p.areaMul;
        const ny = p.y + Math.sin(a)*s.radius * p.areaMul;
        const list = EGRID.query(nx, ny, s.nodeR + 40, _EQ1);
        for(let li = 0; li < list.length; li++){
          const e = list[li];
          if(!e.alive) continue;
          const dd = (e.x-nx)*(e.x-nx) + (e.y-ny)*(e.y-ny);
          const rr = (e.r + s.nodeR);
          if(dd < rr*rr){
            const tag = 'rr_'+w.id+'_'+i;
            if(!e.hitOrbit) e.hitOrbit = {};
            if((e.hitOrbit[tag]||0) <= 0){
              dealDamage(e, s.dmg * p.dmgMul, col);
              fxBurst(e.x,e.y,col,6,140,2.2,.22);
              e.hitOrbit[tag] = .35;
            }
          }
        }
        if(doPulseTick){
          firePulse(nx, ny, s.pulseR * p.areaMul, s.pulseDmg * p.dmgMul, 80, {color: col});
          fxRing(nx, ny, col, s.pulseR * p.areaMul * .7, .35);
        }
        w.lastNodes[i] = {x:nx, y:ny};
      }
      const el = EGRID.enemies;
      for(let ei = 0; ei < el.length; ei++){
        const e = el[ei];
        if(e.hitOrbit){ for(const k in e.hitOrbit) e.hitOrbit[k] -= G.dt; }
      }
    },
  },
  'CHAIN+SHOCK': {
    id:'FUSE_THUNDER_ARC', name:'THUNDER ARC', color:C.cyan, kind:'SHOCK',
    desc:'전방 부채꼴 낙뢰 — 적중 적에서 연쇄',
    sourceA:'CHAIN', sourceB:'SHOCK',
    baseStats:{ cd:1.2, dmg:60, radius:230, arc:Math.PI*.8, jumps:3, jumpRange:220, jumpDmg:.6 },
    maxLv:6,
    levelUp:(w,lv)=>{ w.stats.dmg+=14; w.stats.radius+=14; if(lv===3||lv===5) w.stats.jumps++; w.stats.jumpRange+=12; },
    extra:{fanThenChain:true},
    onUpdate(p,w){
      w.timer = (w.timer||0) - G.dt;
      if(w.timer<=0){
        const s = w.stats;
        const col = w.color || C.cyan;
        const aim = nearestEnemy(p);
        const a = aim ? angTo(p, aim) : (p.faceA||0);
        // Fan shock first — uses native cone hit logic.
        fireFanShock(p.x, p.y, a, s.radius * p.areaMul, s.arc, s.dmg * p.dmgMul, {color: col});
        // Then seed chain jumps from up to 3 enemies in the cone.
        const list = EGRID.query(p.x, p.y, s.radius * p.areaMul + 40, _EQ1);
        const seeds = [];
        for(let li = 0; li < list.length && seeds.length < 3; li++){
          const e = list[li];
          if(!e.alive) continue;
          const dx = e.x - p.x, dy = e.y - p.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          if(dist > s.radius * p.areaMul + e.r) continue;
          let da = Math.atan2(dy, dx) - a;
          while(da > Math.PI) da -= TAU;
          while(da < -Math.PI) da += TAU;
          if(Math.abs(da) <= s.arc/2 + .1) seeds.push(e);
        }
        for(const seed of seeds){
          let from = seed;
          const hit = new Set([seed]);
          for(let j=0;j<s.jumps;j++){
            const tgt = nearestEnemyExcept(from, hit, s.jumpRange);
            if(!tgt) break;
            fxLine(from.x, from.y, tgt.x, tgt.y, col, .3, 3);
            dealDamage(tgt, s.dmg * p.dmgMul * s.jumpDmg * (1 - j*.1), col);
            fxBurst(tgt.x, tgt.y, col, 6, 130, 2, .22);
            hit.add(tgt); from = tgt;
          }
        }
        w.timer = s.cd / p.cdMul;
      }
    },
  },
  'BLADE+HOMING': {
    id:'FUSE_PHANTOM_EDGE', name:'PHANTOM EDGE', color:C.white, kind:'BULLET',
    desc:'유도 곡선 수리검 — 적을 휘감으며 관통',
    sourceA:'BLADE', sourceB:'HOMING',
    baseStats:{ cd:.85, dmg:44, count:2, speed:340, life:1.8, pierce:5, turn:3.0 },
    maxLv:6,
    levelUp:(w,lv)=>{ w.stats.dmg+=10; if(lv===2||lv===4) w.stats.count++; if(lv===3||lv===5) w.stats.pierce++; w.stats.turn+=.3; },
    extra:{curveTrack:true},
    onUpdate(p,w){
      w.timer = (w.timer||0) - G.dt;
      if(w.timer<=0){
        const s = w.stats;
        const col = w.color || C.white;
        const target = nearestEnemy(p);
        const aimA = target ? angTo(p, target) : Math.random()*TAU;
        for(let i=0;i<s.count;i++){
          const spread = (i - (s.count-1)/2) * .35;
          const a = aimA + spread;
          fireProjectile(p.x, p.y, a, s.speed, s.dmg * p.dmgMul, s.life, col, 'shuriken', {pierce:s.pierce, spin:Math.random()*TAU, target, turn:s.turn});
        }
        w.timer = s.cd / p.cdMul;
      }
    },
  },
  'BEAM+CROSS': {
    id:'FUSE_STAR_FORGE', name:'STAR FORGE', color:C.gold, kind:'BEAM',
    desc:'십자 고정 빔 — 4방향 영구 광선',
    sourceA:'BEAM', sourceB:'CROSS',
    baseStats:{ rotSpeed:0.6, dmg:48, length:480, width:7, count:4, tick:.12 },
    maxLv:6,
    levelUp:(w,lv)=>{ w.stats.dmg+=11; w.stats.length+=28; w.stats.width+=1; if(lv===3||lv===5) w.stats.count+=2; },
    extra:{fixedCross:true},
    onUpdate(p,w){
      // Slow rotation gives the cross a subtle drift while keeping the
      // "fixed cardinal axes" feel of CROSS.
      w.angle = (w.angle||0) + w.stats.rotSpeed * G.dt;
      w.tickT = (w.tickT||0) - G.dt;
      const s = w.stats;
      const tickEvery = s.tick / p.cdMul;
      const damageThisFrame = w.tickT <= 0;
      if(damageThisFrame) w.tickT = tickEvery;
      if(!w.beams) w.beams = [];
      if(w.beams.length !== s.count) w.beams.length = s.count;
      const col = w.color || C.gold;
      // Cross-frame hit tracking — see base BEAM for rationale.
      if(!w._tickHits) w._tickHits = new Set();
      for(let b=0;b<s.count;b++){
        const a = w.angle + (b * TAU/s.count);
        const ex = p.x + Math.cos(a)*s.length;
        const ey = p.y + Math.sin(a)*s.length;
        w.beams[b] = {x1:p.x,y1:p.y,x2:ex,y2:ey,life:G.dt};
        const list = EGRID.queryLine(p.x, p.y, ex, ey, s.width + 40, _EQ1);
        for(let li = 0; li < list.length; li++){
          const e = list[li];
          if(!e.alive) continue;
          const d = pointSegDist(e.x,e.y, p.x,p.y, ex,ey);
          if(d <= e.r + s.width) w._tickHits.add(e);
        }
      }
      if(damageThisFrame){
        for(const e of w._tickHits){
          if(!e.alive) continue;
          dealDamage(e, s.dmg * p.dmgMul, col);
          fxBurst(e.x, e.y, col, 4, 110, 2.2, .2);
        }
        w._tickHits.clear();
      }
    },
  },
  'BLACKHOLE+PRISM': {
    id:'FUSE_KALEIDO_VOID', name:'KALEIDO VOID', color:C.violet, kind:'BLACKHOLE',
    desc:'중력장 — 소멸 시 분열탄 폭사',
    sourceA:'BLACKHOLE', sourceB:'PRISM',
    baseStats:{ cd:6, dmg:14, radius:200, life:3.2, pull:200, burstCount:12, burstDmg:24, burstSpeed:300, burstSplits:2 },
    maxLv:6,
    levelUp:(w,lv)=>{ w.stats.dmg+=4; w.stats.radius+=12; w.stats.burstDmg+=8; if(lv===2||lv===4) w.stats.burstCount+=4; if(lv===5) w.stats.burstSplits++; },
    extra:{collapseBurst:true},
    onUpdate(p,w){
      w.timer = (w.timer||0) - G.dt;
      // Self-tracked collapse bursts fire just after each blackhole's lifetime.
      if(!w.pendingBursts) w.pendingBursts = [];
      for(let i = w.pendingBursts.length - 1; i >= 0; i--){
        const pb = w.pendingBursts[i];
        pb.t -= G.dt;
        if(pb.t <= 0){
          for(let j = 0; j < pb.count; j++){
            const a = (j / pb.count) * TAU + Math.random()*.18;
            fireProjectile(pb.x, pb.y, a, pb.speed, pb.dmg, 1.4, pb.color, 'prism', {splits: pb.splits});
          }
          fxRing(pb.x, pb.y, pb.color, 90, .55);
          fxBurst(pb.x, pb.y, pb.color, 30, 240, 4, .55);
          w.pendingBursts.splice(i, 1);
        }
      }
      if(w.timer<=0){
        const s = w.stats;
        const col = w.color || C.violet;
        const aim = nearestEnemy(p);
        const tx = aim ? aim.x : p.x + rand(-200,200);
        const ty = aim ? aim.y : p.y + rand(-200,200);
        spawnBlackhole(tx, ty, s.radius * p.areaMul, s.life * p.areaMul, s.pull, s.dmg * p.dmgMul);
        w.pendingBursts.push({
          x: tx, y: ty,
          t: s.life * p.areaMul + .05,
          count: s.burstCount, dmg: s.burstDmg * p.dmgMul,
          speed: s.burstSpeed, splits: s.burstSplits, color: col,
        });
        w.timer = s.cd / p.cdMul;
      }
    },
  },
  'CROSS+SHOCK': {
    id:'FUSE_QUAD_BLAST', name:'QUAD BLAST', color:C.red, kind:'SHOCK',
    desc:'사방향 부채꼴 충격파 동시 발사',
    sourceA:'CROSS', sourceB:'SHOCK',
    baseStats:{ cd:1.5, dmg:42, radius:180, arc:Math.PI*.5, dirs:4 },
    maxLv:6,
    levelUp:(w,lv)=>{ w.stats.dmg+=11; w.stats.radius+=14; w.stats.arc+=.08; if(lv===5) w.stats.dirs+=4; },
    extra:{quadCone:true},
    onUpdate(p,w){
      w.timer = (w.timer||0) - G.dt;
      if(w.timer<=0){
        const s = w.stats;
        const col = w.color || C.red;
        const baseA = w.spin || 0;
        for(let i=0;i<s.dirs;i++){
          const a = baseA + (i / s.dirs) * TAU;
          fireFanShock(p.x, p.y, a, s.radius * p.areaMul, s.arc, s.dmg * p.dmgMul, {color: col});
        }
        w.spin = (w.spin||0) + .3;
        w.timer = s.cd / p.cdMul;
      }
    },
  },
  'CHAIN+ORBIT': {
    id:'FUSE_COIL_HALO', name:'COIL HALO', color:C.teal, kind:'ORBIT',
    desc:'궤도 노드 사이 항시 전류 — 노드에서 체인 방전',
    sourceA:'CHAIN', sourceB:'ORBIT',
    baseStats:{ count:3, radius:110, rotSpeed:2.2, dmg:22, nodeR:12, arcDmg:18, arcTick:.18, jumps:2, jumpRange:180 },
    maxLv:6,
    levelUp:(w,lv)=>{ w.stats.dmg+=6; w.stats.arcDmg+=8; if(lv===2||lv===4) w.stats.count++; if(lv===3||lv===5) w.stats.jumps++; },
    extra:{interNodeArc:true, jumpFromNodes:true},
    onUpdate(p,w){
      const s = w.stats;
      w.angle = (w.angle||0) + s.rotSpeed * G.dt * p.cdMul;
      w.arcT = (w.arcT||0) - G.dt;
      const doArc = w.arcT <= 0;
      if(doArc) w.arcT = s.arcTick / p.cdMul;
      if(!w.lastNodes) w.lastNodes = [];
      const col = w.color || C.teal;
      const nodes = [];
      for(let i=0;i<s.count;i++){
        const a = w.angle + (i*TAU/s.count);
        const nx = p.x + Math.cos(a)*s.radius * p.areaMul;
        const ny = p.y + Math.sin(a)*s.radius * p.areaMul;
        nodes.push({x: nx, y: ny});
        const list = EGRID.query(nx, ny, s.nodeR + 40, _EQ1);
        for(let li = 0; li < list.length; li++){
          const e = list[li];
          if(!e.alive) continue;
          const dd = (e.x-nx)*(e.x-nx) + (e.y-ny)*(e.y-ny);
          const rr = (e.r + s.nodeR);
          if(dd < rr*rr){
            const tag = 'ch_'+w.id+'_'+i;
            if(!e.hitOrbit) e.hitOrbit = {};
            if((e.hitOrbit[tag]||0) <= 0){
              dealDamage(e, s.dmg * p.dmgMul, col);
              e.hitOrbit[tag] = .35;
            }
          }
        }
        w.lastNodes[i] = {x:nx, y:ny};
      }
      // Inter-node arcs (visual every frame, damage on tick).
      for(let i = 0; i < nodes.length; i++){
        const a = nodes[i], b = nodes[(i+1) % nodes.length];
        fxLine(a.x, a.y, b.x, b.y, col, .12, 2);
        if(doArc){
          const list = EGRID.queryLine(a.x, a.y, b.x, b.y, 30, _EQ1);
          for(let li = 0; li < list.length; li++){
            const e = list[li];
            if(!e.alive) continue;
            const d = pointSegDist(e.x,e.y, a.x,a.y, b.x,b.y);
            if(d <= e.r + 18){
              dealDamage(e, s.arcDmg * p.dmgMul * .5, col);
            }
          }
        }
      }
      // Chain jumps from each node into the field.
      if(doArc){
        for(let i = 0; i < nodes.length; i++){
          const start = nodes[i];
          const seed = nearestEnemyExcept({x:start.x, y:start.y}, new Set(), s.jumpRange * .7);
          if(!seed) continue;
          let from = seed;
          const hit = new Set([seed]);
          fxLine(start.x, start.y, from.x, from.y, col, .25, 2.2);
          dealDamage(from, s.arcDmg * p.dmgMul * .5, col);
          for(let j = 0; j < s.jumps; j++){
            const tgt = nearestEnemyExcept(from, hit, s.jumpRange);
            if(!tgt) break;
            fxLine(from.x, from.y, tgt.x, tgt.y, col, .25, 2);
            dealDamage(tgt, s.arcDmg * p.dmgMul * .4, col);
            hit.add(tgt); from = tgt;
          }
        }
      }
      const el = EGRID.enemies;
      for(let ei = 0; ei < el.length; ei++){
        const e = el[ei];
        if(e.hitOrbit){ for(const k in e.hitOrbit) e.hitOrbit[k] -= G.dt; }
      }
    },
  },
};

// Helper: lookup fusion by unordered weapon pair
export function findFusion(keyA, keyB){
  const k1 = keyA < keyB ? `${keyA}+${keyB}` : `${keyB}+${keyA}`;
  return FUSIONS[k1] || null;
}
