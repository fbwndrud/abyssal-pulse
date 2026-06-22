/* ===================================================================
   DATA TABLES — pure-ish data definitions.
   Some apply() callbacks reach into entities.js (fx, dealDamage), so we
   import only what those callbacks need.
   =================================================================== */
import { G, TAU, C } from './core.js';
import {
  dealDamage, fxBurst, fxRing, fxShockwave, fxText, shake, flash, setEnemyTables,
} from './entities.js';

/* ───────── CLASSES ───────── */
export const CLASSES = {
  CIRCLE:   { name:'RIFT WARDEN',   color:C.cyan,    sides:0,  r:14, hp:120, speed:240, startWeap:'PULSE',    desc:'균형형 추방자. 신성한 노바로 균열을 정화합니다.', unlock:0 },
  TRIANGLE: { name:'BLOOD SEER',    color:C.gold,    sides:3,  r:15, hp:90,  speed:265, startWeap:'BEAM',     desc:'민첩한 예언자. 천상의 창이 몸 주위를 돕니다.', unlock:0 },
  HEXAGON:  { name:'GRAVE BULWARK', color:C.violet,  sides:6,  r:15, hp:150, speed:225, startWeap:'ORBIT',    desc:'묘지의 수호자. 룬 방벽으로 적을 갈아냅니다.', unlock:200 },
  SQUARE:   { name:'IRON EXILE',    color:C.magenta, sides:4,  r:15, hp:170, speed:215, startWeap:'SHOCK',    desc:'중장 추방자. 묘지 가르기로 전방을 지웁니다.', unlock:400 },
  STAR:     { name:'HEX WITCH',     color:C.lime,    sides:5,  r:15, hp:100, speed:255, startWeap:'CHAIN',    desc:'저주 사술사. 사슬 번개로 악마를 잇습니다.', unlock:800 }
};

/* ───────── PASSIVES ─────────
   Compressed maxLv 5 → 3. Each level now grants a small actual stat boost
   (so Lv 1-2 picks aren't dead picks), AND Lv 3 unlocks the evolution gate.
   13-pick evolution slog → ~7-9 picks. Items still carry primary stat scaling.
   =================================================================== */
// maxLv compressed 3→2 (per balance audit) so evolution gates open faster — a
// run now reliably hits 2~3 evolutions instead of 1. Per-level magnitudes were
// scaled up to keep the total stat gain comparable (POWER 8%→12%/Lv etc), so
// fully maxed passives still feel meaningful, just reached sooner.
export const PASSIVES = {
  POWER:   { name:'WRATH',   color:C.red,    desc:'분노 — 데미지 +12%/Lv. Lv.2 시 분노 룬 각성 해금', maxLv:2,
             apply:(p,lv)=>{ p.dmgMul *= (1 + .12*lv); },
             lv3Reward: p => { p._boostDmg = 8; p._boostDmgMul = 1.5; } },
  HASTE:   { name:'FLEET',   color:C.cyan,   desc:'기민 — 이동 +9%/Lv. Lv.2 시 기민 룬 각성 해금', maxLv:2,
             apply:(p,lv)=>{ p.speed *= (1 + .09*lv); },
             lv3Reward: p => { p._boostSpd = 8; p._boostSpdMul = 1.4; } },
  CADENCE: { name:'ZEAL',    color:C.gold,   desc:'열의 — 쿨감 +9%/Lv. Lv.2 시 열의 룬 각성 해금', maxLv:2,
             apply:(p,lv)=>{ p.cdMul *= (1 + .09*lv); },
             lv3Reward: p => { p._boostCdr = 8; p._boostCdrMul = 1.3; } },
  REACH:   { name:'DOMINION',color:C.violet, desc:'지배 — 효과 범위 +12%/Lv. Lv.2 시 지배 룬 각성 해금', maxLv:2,
             apply:(p,lv)=>{ p.areaMul *= (1 + .12*lv); },
             lv3Reward: p => { p.hp = p.maxHp; } },
  ARMOR:   { name:'IRON SKIN', color:C.teal, desc:'철피 — 피해 감소 +6%/Lv. Lv.2 시 철피 룬 각성 해금', maxLv:2,
             apply:(p,lv)=>{ p.dr += .06*lv; },
             lv3Reward: p => { p._boostInvuln = 4; } },
  SOUL:    { name:'VITALITY', color:C.lime,  desc:'활력 — 최대HP +18, 재생 +0.4/Lv. Lv.2 시 활력 룬 각성 해금', maxLv:2,
             apply:(p,lv)=>{ p.maxHp += 18*lv; p.hp += 18*lv; p.regen += .4*lv; },
             lv3Reward: p => { p.hp = p.maxHp; } },
  MAGNET:  { name:'GREED',   color:C.pink,   desc:'탐욕 — 픽업 범위 +30%/Lv. Lv.2 시 탐욕 룬 각성 해금', maxLv:2,
             apply:(p,lv)=>{ p.magnet *= (1 + .30*lv); },
             lv3Reward: ()=> { G.superMagnetTimer = 10; } },
  LUCK:    { name:'FORTUNE', color:C.magenta,desc:'운명 — 드랍/희귀 +9%/Lv. Lv.2 시 운명 룬 각성 해금', maxLv:2,
             apply:(p,lv)=>{ p.luck += .09*lv; },
             lv3Reward: p => { p._boostDmg = 8; p._boostDmgMul = 1.3; } },
};

/* ───────── ENEMIES ───────── */
export const ENEMIES = {
  TRI:   { name:'HOLLOW IMP',      sides:3, color:C.cyan,    r:11, hp:14,  speed:120, dmg:6,  xp:1, gold:.06, brain:'chase' },
  SQR:   { name:'GRAVE BRUTE',     sides:4, color:C.violet,  r:14, hp:50,  speed:85,  dmg:12, xp:3, gold:.14, brain:'chase' },
  HEX:   { name:'BONE SPLITTER',   sides:6, color:C.lime,    r:18, hp:80,  speed:95,  dmg:12, xp:5, gold:.22, brain:'chase', onDeath:'split' },
  PEN:   { name:'CINDER ACOLYTE',  sides:5, color:C.gold,    r:14, hp:42,  speed:65,  dmg:10, xp:4, gold:.20, brain:'shooter' },
  DIA:   { name:'BLOOD WRAITH',    sides:4, color:C.pink,    r:13, hp:30,  speed:160, dmg:16, xp:3, gold:.14, brain:'dasher', isDiamond:true },
  OCT:   { name:'PLAGUE DEACON',   sides:8, color:C.teal,    r:15, hp:120, speed:70,  dmg:8,  xp:6, gold:.28, brain:'healer' },
  SWARM: { name:'RIFT VERMIN',     sides:3, color:C.magenta, r:8,  hp:6,   speed:185, dmg:5,  xp:1, gold:.04, brain:'chase' },
};

/* ───────── BOSSES ───────── */
export const BOSSES = {
  RING_LORD: { name:'THE BELL PRIOR',      color:C.magenta, r:42, sides:0, hp:600, speed:50, dmg:14, xp:60, gold:10, brain:'ringboss' },
  SPIKE_KING:{ name:'ASHEN BUTCHER',       color:C.red,     r:46, sides:8, hp:1050, speed:78, dmg:20, xp:80, gold:12, brain:'spikeboss' },
  HYDRA:     { name:'BONE HYDRA MATRON',   color:C.lime,    r:50, sides:6, hp:1600, speed:52, dmg:22, xp:110, gold:16, brain:'hydraboss' },
  PRISMA:    { name:'VOID SERAPH',         color:C.gold,    r:55, sides:5, hp:2400, speed:66, dmg:26, xp:160, gold:22, brain:'prismaboss' },
};

/* ───────── ELITE AFFIXES ───────── */
export const ELITE_AFFIXES = {
  molten: {
    id:'molten', name:'MOLTEN', color:C.red,
    desc:'사망 시 지옥불 폭발',
    hpMul:2.7, dmgMul:1.15, speedMul:.92, xpMul:4, goldMul:4,
  },
  frostbound: {
    id:'frostbound', name:'FROSTBOUND', color:C.cyan,
    desc:'근처 추방자를 둔화',
    hpMul:2.4, dmgMul:1.05, speedMul:.85, xpMul:4, goldMul:4,
  },
  voidTouched: {
    id:'voidTouched', name:'VOID-TOUCHED', color:C.violet,
    desc:'사망 시 작은 심연장을 남김',
    hpMul:3.1, dmgMul:1.2, speedMul:.9, xpMul:5, goldMul:5,
  },
};

// Register with entities.js so spawnEnemy / spawnBoss can find them.
setEnemyTables(ENEMIES, BOSSES, ELITE_AFFIXES);

/* ───────── UPGRADE TIERS (level-up card rarity) ───────── */
export const UPGRADE_TIERS = {
  common: { key:'common', label:'COMMON', color:'#b0bccc', glow:'rgba(176,188,204,.5)', weight:60, minMult:0.90, maxMult:1.10 },
  rare:   { key:'rare',   label:'RARE',   color:C.cyan,    glow:'rgba(0,240,255,.8)',   weight:28, minMult:1.10, maxMult:1.45 },
  epic:   { key:'epic',   label:'EPIC',   color:C.violet,  glow:'rgba(155,92,255,.9)',  weight:10, minMult:1.45, maxMult:1.85 },
  legend: { key:'legend', label:'LEGEND', color:C.gold,    glow:'rgba(255,212,0,1)',    weight:4,  minMult:1.80, maxMult:2.40 },
};
export function rollUpgradeTier(luck){
  const L = Math.max(0, (luck||0));
  const bias = { common:-L*35, rare:L*14, epic:L*14, legend:L*14 };
  const keys = ['common','rare','epic','legend'];
  let total = 0; const weights = {};
  for(const k of keys){ const w = Math.max(2, UPGRADE_TIERS[k].weight + bias[k]); weights[k] = w; total += w; }
  let r = Math.random()*total;
  for(const k of keys){ r -= weights[k]; if(r<=0) return UPGRADE_TIERS[k]; }
  return UPGRADE_TIERS.common;
}
export function rollTierMult(tier){
  if(!tier) return 1;
  return tier.minMult + Math.random()*(tier.maxMult - tier.minMult);
}

/* ───────── ITEMS ───────── */
export const ITEM_TIERS = {
  common:    { key:'common',    color:'#b0bccc', glow:'rgba(176,188,204,.6)' },
  rare:      { key:'rare',      color:C.cyan,    glow:'rgba(0,240,255,.8)' },
  epic:      { key:'epic',      color:C.violet,  glow:'rgba(127,77,216,.95)' },
  legendary: { key:'legendary', color:C.gold,    glow:'rgba(255,212,0,1)' },
};
// Per-item glyph icons drawn inside the world tier-shell. Each takes (cx, x, y, s)
// and uses ctx primitives. Kept compact — neon outline + glow.
const I = {
  heart(cx,x,y,s,col){ cx.save(); cx.fillStyle=col; cx.shadowColor=col; cx.shadowBlur=10; const r=s*.32;
    cx.beginPath(); cx.moveTo(x,y-r*.3);
    cx.bezierCurveTo(x-r*1.5,y-r*1.5,x-r*2,y+r*.4,x,y+r*1.4);
    cx.bezierCurveTo(x+r*2,y+r*.4,x+r*1.5,y-r*1.5,x,y-r*.3);
    cx.fill(); cx.restore(); },
  bolt(cx,x,y,s,col){ cx.save(); cx.fillStyle=col; cx.shadowColor=col; cx.shadowBlur=12; const r=s*.32;
    cx.beginPath();
    cx.moveTo(x-r*.4,y-r); cx.lineTo(x+r*.3,y-r*.15); cx.lineTo(x-r*.05,y-r*.15);
    cx.lineTo(x+r*.4,y+r); cx.lineTo(x-r*.3,y+r*.15); cx.lineTo(x+r*.05,y+r*.15);
    cx.closePath(); cx.fill(); cx.restore(); },
  clock(cx,x,y,s,col){ cx.save(); cx.strokeStyle=col; cx.shadowColor=col; cx.shadowBlur=10; cx.lineWidth=2;
    cx.beginPath(); cx.arc(x,y,s*.32,0,TAU); cx.stroke();
    cx.beginPath(); cx.moveTo(x,y); cx.lineTo(x,y-s*.22); cx.stroke();
    cx.beginPath(); cx.moveTo(x,y); cx.lineTo(x+s*.16,y); cx.stroke(); cx.restore(); },
  atom(cx,x,y,s,col){ cx.save(); cx.strokeStyle=col; cx.shadowColor=col; cx.shadowBlur=12; cx.lineWidth=1.6;
    for(let i=0;i<3;i++){ cx.save(); cx.translate(x,y); cx.rotate(i*Math.PI/3);
      cx.beginPath(); cx.ellipse(0,0,s*.36,s*.13,0,0,TAU); cx.stroke(); cx.restore(); }
    cx.fillStyle=col; cx.beginPath(); cx.arc(x,y,s*.07,0,TAU); cx.fill(); cx.restore(); },
  shield(cx,x,y,s,col){ cx.save(); cx.fillStyle=`rgba(0,240,255,.18)`; cx.strokeStyle=col;
    cx.shadowColor=col; cx.shadowBlur=10; cx.lineWidth=2; const r=s*.32;
    cx.beginPath(); cx.moveTo(x,y-r);
    cx.bezierCurveTo(x+r,y-r*.7,x+r,y,x,y+r);
    cx.bezierCurveTo(x-r,y,x-r,y-r*.7,x,y-r);
    cx.fill(); cx.stroke(); cx.restore(); },
  burst(cx,x,y,s,col){ cx.save(); cx.fillStyle=col; cx.shadowColor=col; cx.shadowBlur=14;
    const r=s*.36; cx.beginPath();
    for(let i=0;i<10;i++){ const a=i*TAU/10-Math.PI/2; const rr=i%2===0?r:r*.4;
      const px=x+Math.cos(a)*rr, py=y+Math.sin(a)*rr;
      if(i===0) cx.moveTo(px,py); else cx.lineTo(px,py); }
    cx.closePath(); cx.fill(); cx.restore(); },
  upArrow(cx,x,y,s,col){ cx.save(); cx.fillStyle=col; cx.shadowColor=col; cx.shadowBlur=12;
    const r=s*.32; cx.beginPath();
    cx.moveTo(x,y-r); cx.lineTo(x+r*.7,y); cx.lineTo(x+r*.3,y);
    cx.lineTo(x+r*.3,y+r*.6); cx.lineTo(x-r*.3,y+r*.6);
    cx.lineTo(x-r*.3,y); cx.lineTo(x-r*.7,y); cx.closePath(); cx.fill(); cx.restore(); },
  gear(cx,x,y,s,col){ cx.save(); cx.strokeStyle=col; cx.shadowColor=col; cx.shadowBlur=10; cx.lineWidth=2;
    const r=s*.26; cx.beginPath();
    for(let i=0;i<10;i++){ const a=i*TAU/10; const rr=i%2===0?r:r*1.35;
      const px=x+Math.cos(a)*rr, py=y+Math.sin(a)*rr;
      if(i===0) cx.moveTo(px,py); else cx.lineTo(px,py); }
    cx.closePath(); cx.stroke();
    cx.beginPath(); cx.arc(x,y,r*.45,0,TAU); cx.stroke(); cx.restore(); },
  plate(cx,x,y,s,col){ cx.save(); cx.strokeStyle=col; cx.shadowColor=col; cx.shadowBlur=8; cx.lineWidth=2;
    cx.fillStyle=`rgba(176,188,204,.15)`; const w=s*.55,h=s*.4;
    cx.beginPath();
    if(cx.roundRect) cx.roundRect(x-w/2,y-h/2,w,h,4);
    else cx.rect(x-w/2,y-h/2,w,h);
    cx.fill(); cx.stroke();
    cx.beginPath(); cx.moveTo(x-w/2+5,y); cx.lineTo(x+w/2-5,y); cx.stroke(); cx.restore(); },
  magnet(cx,x,y,s,col){ cx.save(); cx.strokeStyle=col; cx.shadowColor=col; cx.shadowBlur=10;
    cx.lineWidth=4; cx.lineCap='round'; const r=s*.3;
    cx.beginPath(); cx.arc(x,y+r*.1,r,Math.PI*.15,Math.PI*.85,false); cx.stroke();
    cx.strokeStyle='#fff';
    cx.beginPath(); cx.moveTo(x-r*.95,y+r*.3); cx.lineTo(x-r*.95,y-r*.1); cx.stroke();
    cx.beginPath(); cx.moveTo(x+r*.95,y+r*.3); cx.lineTo(x+r*.95,y-r*.1); cx.stroke(); cx.restore(); },
  drop(cx,x,y,s,col){ cx.save(); cx.fillStyle=col; cx.shadowColor=col; cx.shadowBlur=10; const r=s*.3;
    cx.beginPath(); cx.moveTo(x,y-r*1.2);
    cx.bezierCurveTo(x+r,y-r*.4,x+r,y+r*.6,x,y+r*.9);
    cx.bezierCurveTo(x-r,y+r*.6,x-r,y-r*.4,x,y-r*1.2);
    cx.fill(); cx.restore(); },
  signal(cx,x,y,s,col){ cx.save(); cx.strokeStyle=col; cx.shadowColor=col; cx.shadowBlur=10; cx.lineWidth=2;
    for(let i=1;i<=3;i++){ cx.beginPath();
      cx.arc(x-s*.18,y,s*.1*i,-Math.PI*.4,Math.PI*.4); cx.stroke(); }
    cx.fillStyle=col; cx.beginPath(); cx.arc(x-s*.22,y,s*.06,0,TAU); cx.fill(); cx.restore(); },
  flywheel(cx,x,y,s,col){ cx.save(); cx.strokeStyle=col; cx.shadowColor=col; cx.shadowBlur=10; cx.lineWidth=2;
    const r=s*.3;
    cx.beginPath(); cx.arc(x,y,r,0,TAU); cx.stroke();
    for(let i=0;i<4;i++){ const a=i*Math.PI/2;
      cx.beginPath(); cx.moveTo(x+Math.cos(a)*r*.3,y+Math.sin(a)*r*.3);
      cx.lineTo(x+Math.cos(a)*r,y+Math.sin(a)*r); cx.stroke(); }
    cx.restore(); },
  triangle(cx,x,y,s,col){ cx.save(); cx.strokeStyle=col; cx.shadowColor=col; cx.shadowBlur=10; cx.lineWidth=2;
    cx.fillStyle=`rgba(0,240,255,.1)`; const r=s*.32;
    cx.beginPath();
    cx.moveTo(x,y-r); cx.lineTo(x+r*.866,y+r*.5); cx.lineTo(x-r*.866,y+r*.5);
    cx.closePath(); cx.fill(); cx.stroke(); cx.restore(); },
  hexShield(cx,x,y,s,col){ cx.save(); cx.fillStyle=`rgba(255,212,0,.15)`; cx.strokeStyle=col;
    cx.shadowColor=col; cx.shadowBlur=12; cx.lineWidth=2.4; const r=s*.34;
    cx.beginPath();
    for(let i=0;i<6;i++){ const a=i*TAU/6-Math.PI/2;
      const px=x+Math.cos(a)*r, py=y+Math.sin(a)*r;
      if(i===0) cx.moveTo(px,py); else cx.lineTo(px,py); }
    cx.closePath(); cx.fill(); cx.stroke();
    cx.lineWidth=2;
    cx.beginPath(); cx.moveTo(x,y-r*.4); cx.lineTo(x,y+r*.4); cx.stroke();
    cx.beginPath(); cx.moveTo(x-r*.4,y); cx.lineTo(x+r*.4,y); cx.stroke(); cx.restore(); },
  concentric(cx,x,y,s,col){ cx.save(); cx.shadowColor=C.violet; cx.shadowBlur=10; cx.lineWidth=2;
    for(let i=0;i<3;i++){
      cx.strokeStyle=`hsla(280 80% ${65-i*18}% / ${.95-i*.22})`;
      cx.beginPath(); cx.arc(x,y,s*.1+i*s*.09,0,TAU); cx.stroke(); }
    cx.fillStyle='#000'; cx.beginPath(); cx.arc(x,y,s*.07,0,TAU); cx.fill(); cx.restore(); },
  clover(cx,x,y,s,col){ cx.save(); cx.fillStyle=col; cx.shadowColor=col; cx.shadowBlur=10;
    const r=s*.18;
    for(let i=0;i<4;i++){ const a=i*Math.PI/2+Math.PI/4;
      cx.beginPath();
      cx.arc(x+Math.cos(a)*r*.7, y+Math.sin(a)*r*.7, r*.7, 0, TAU); cx.fill(); }
    cx.fillStyle='#fff'; cx.beginPath(); cx.arc(x,y,r*.25,0,TAU); cx.fill(); cx.restore(); },
};
export const ITEMS = {
  // ── CONSUMABLE ──
  repair:    { id:'repair',    name:'BLOOD VIAL',   kind:'consumable', tier:'common',    desc:'HP +30',
               apply: p => { p.hp = Math.min(p.maxHp, p.hp + 30); fxText(p.x, p.y-30, '+30 HP', C.red); },
               icon:(cx,x,y,s)=>I.heart(cx,x,y,s,C.red) },
  battery:   { id:'battery',   name:'QUICKSILVER DRAUGHT', kind:'consumable', tier:'common', desc:'10초 이동+30%',
               apply: p => { p._boostSpd = Math.max(p._boostSpd||0, 10); p._boostSpdMul = 1.30; },
               icon:(cx,x,y,s)=>I.bolt(cx,x,y,s,C.cyan) },
  overclock: { id:'overclock', name:'ZEAL INCENSE', kind:'consumable', tier:'rare',      desc:'10초 쿨-20%',
               apply: p => { p._boostCdr = Math.max(p._boostCdr||0, 10); p._boostCdrMul = 1.25; },
               icon:(cx,x,y,s)=>I.clock(cx,x,y,s,C.cyan) },
  fission:   { id:'fission',   name:'WRATH EMBER',  kind:'consumable', tier:'rare',      desc:'10초 피해 +30%',
               apply: p => { p._boostDmg = Math.max(p._boostDmg||0, 10); p._boostDmgMul = 1.30; },
               icon:(cx,x,y,s)=>I.atom(cx,x,y,s,C.gold) },
  shieldPack:{ id:'shieldPack',name:'AEGIS PRAYER', kind:'consumable', tier:'rare',      desc:'6초 무적',
               apply: p => { p._boostInvuln = Math.max(p._boostInvuln||0, 6); },
               icon:(cx,x,y,s)=>I.shield(cx,x,y,s,C.cyan) },
  abyssDraught:{ id:'abyssDraught', name:'ABYSS DRAUGHT', kind:'consumable', tier:'epic', desc:'12초 피해 +25%, 쿨 -15%',
               apply: p => {
                 p._boostDmg = Math.max(p._boostDmg||0, 12); p._boostDmgMul = 1.25;
                 p._boostCdr = Math.max(p._boostCdr||0, 12); p._boostCdrMul = 1.15;
               },
               icon:(cx,x,y,s)=>I.concentric(cx,x,y,s,C.violet) },
  novaBomb:  { id:'novaBomb',  name:'JUDGMENT SEAL', kind:'consumable', tier:'legendary', desc:'화면 내 적 피해 대폭',
               apply: p => {
                 for(const e of G.ents){
                   if(e.type!=='enemy' || !e.alive) continue;
                   const d = Math.hypot(e.x-p.x, e.y-p.y);
                   if(d < 900) dealDamage(e, Math.max(80, e.maxHp*.55), C.gold);
                 }
                 fxShockwave(p.x, p.y, C.gold, 900, .8); shake(.4); flash(C.gold, .4);
               },
               icon:(cx,x,y,s)=>I.burst(cx,x,y,s,C.gold) },
  ascend:    { id:'ascend',    name:'SAINTED ASCENT', kind:'consumable', tier:'legendary', desc:'즉시 레벨업',
               apply: p => { p.xp = Math.max(p.xp, p.xpNext); p._forcedLevelup = true; },
               icon:(cx,x,y,s)=>I.upArrow(cx,x,y,s,C.gold) },

  // ── RELIC (영구) ──
  // Magnitudes bumped ~30-50% to compensate for passives losing stat role.
  // Items are now the PRIMARY stat lever.
  gyro:      { id:'gyro',      name:'WANDERER SPUR', kind:'relic', tier:'common',    desc:'이동속도 +14%',
               apply: p => { p.speed *= 1.14; },
               icon:(cx,x,y,s)=>I.gear(cx,x,y,s,'#b0bccc') },
  plating:   { id:'plating',   name:'BONE PLATING', kind:'relic', tier:'common',    desc:'최대 HP +20%, 재생 +0.5',
               apply: p => { const boost = Math.round(p.maxHp*.20); p.maxHp += boost; p.hp += boost; p.regen += .5; },
               icon:(cx,x,y,s)=>I.plate(cx,x,y,s,'#b0bccc') },
  magcoil:   { id:'magcoil',   name:'GRAVE COIL',   kind:'relic', tier:'common',    desc:'픽업 범위 +55%, 코인 픽업 시 +1 가산',
               apply: p => { p.magnet *= 1.55; p.coinMul = (p.coinMul||1) + .35; },
               icon:(cx,x,y,s)=>I.magnet(cx,x,y,s,C.pink) },
  siphon:    { id:'siphon',    name:'VAMPIRE CHARM', kind:'relic', tier:'rare',      desc:'처치 시 25% 확률 +8 HP, 보스 처치 시 +50 HP',
               apply: p => { p.killHealChance = (p.killHealChance||0) + .25; p.killHealAmt = Math.max(p.killHealAmt||0, 8); p.bossHeal = (p.bossHeal||0) + 50; },
               icon:(cx,x,y,s)=>I.drop(cx,x,y,s,C.lime) },
  amplifier: { id:'amplifier', name:'BLOOD RELIQUARY', kind:'relic', tier:'rare',      desc:'피해 +22%',
               apply: p => { p.dmgMul *= 1.22; },
               icon:(cx,x,y,s)=>I.signal(cx,x,y,s,C.cyan) },
  flywheel:  { id:'flywheel',  name:'ZEAL WHEEL',   kind:'relic', tier:'rare',      desc:'발사 속도 +18%',
               apply: p => { p.cdMul *= 1.18; },
               icon:(cx,x,y,s)=>I.flywheel(cx,x,y,s,C.cyan) },
  lens:      { id:'lens',      name:'SOUL PRISM',   kind:'relic', tier:'rare',      desc:'범위 +25%',
               apply: p => { p.areaMul *= 1.25; },
               icon:(cx,x,y,s)=>I.triangle(cx,x,y,s,C.cyan) },
  moltenSigil:{ id:'moltenSigil', name:'MOLTEN SIGIL', kind:'relic', tier:'epic', desc:'피해 +16%, 범위 +12%',
               apply: p => { p.dmgMul *= 1.16; p.areaMul *= 1.12; },
               icon:(cx,x,y,s)=>I.burst(cx,x,y,s,C.red) },
  oathChain: { id:'oathChain', name:'OATH CHAIN', kind:'relic', tier:'epic', desc:'발사 속도 +14%, 피해 감소 +7%',
               apply: p => { p.cdMul *= 1.14; p.dr = Math.min(.85, p.dr + .07); },
               icon:(cx,x,y,s)=>I.flywheel(cx,x,y,s,C.gold) },
  voidCharm: { id:'voidCharm', name:'VOID CHARM', kind:'relic', tier:'epic', desc:'픽업 범위 +35%, 범위 +18%',
               apply: p => { p.magnet *= 1.35; p.areaMul *= 1.18; },
               icon:(cx,x,y,s)=>I.concentric(cx,x,y,s,C.violet) },
  aegis:     { id:'aegis',     name:'SANCTUM AEGIS', kind:'relic', tier:'legendary', desc:'피해 감소 +16%, 재생 +0.8',
               apply: p => { p.dr = Math.min(.85, p.dr + .16); p.regen += .8; },
               icon:(cx,x,y,s)=>I.hexShield(cx,x,y,s,C.gold) },
  singularityCore: {
               id:'singularityCore', name:'ABYSS HEART', kind:'relic', tier:'legendary', desc:'피해 +28%, 쿨 -14%',
               apply: p => { p.dmgMul *= 1.28; p.cdMul *= 1.14; },
               icon:(cx,x,y,s)=>I.concentric(cx,x,y,s,C.violet) },
  fourLeaf:  { id:'fourLeaf',  name:'FORTUNE RELIC', kind:'relic', tier:'legendary', desc:'행운 +60%, XP +20%',
               apply: p => { p.luck += .6; p.xpGainMul = (p.xpGainMul||1) * 1.20; },
               icon:(cx,x,y,s)=>I.clover(cx,x,y,s,C.lime) },
};
export function itemsByTier(tier){ return Object.values(ITEMS).filter(it => it.tier === tier); }

/* ───────── SYNERGIES ───────── */
function _hasW(p, key){ return !!p.weapons.find(w => w.key === key); }
function _pLv(p, key){ return p.passives[key]||0; }
function _hasEvo(p){ return p.weapons.some(w => w.evolved); }
export const SYNERGIES = {
  prismatic: {
    name:'PRISMATIC', tier:1, desc:'BEAM + PRISM — 피해 +18%',
    has: p => _hasW(p,'BEAM') && _hasW(p,'PRISM'),
    apply: p => { p.dmgMul *= 1.18; }
  },
  conductor: {
    name:'CONDUCTOR', tier:1, desc:'CHAIN + BEAM — 발사 속도 +12%',
    has: p => _hasW(p,'CHAIN') && _hasW(p,'BEAM'),
    apply: p => { p.cdMul *= 1.12; }
  },
  eventHorizon: {
    name:'EVENT HORIZON', tier:1, desc:'BLACKHOLE + HOMING — 범위 +15%, 피해 +10%',
    has: p => _hasW(p,'BLACKHOLE') && _hasW(p,'HOMING'),
    apply: p => { p.areaMul *= 1.15; p.dmgMul *= 1.10; }
  },
  starfall: {
    name:'STARFALL', tier:1, desc:'BLADE + CROSS — 이동속도 +8%, 피해 +10%',
    has: p => _hasW(p,'BLADE') && _hasW(p,'CROSS'),
    apply: p => { p.speed *= 1.08; p.dmgMul *= 1.10; }
  },
  resonance: {
    name:'RESONANCE', tier:1, desc:'PULSE + SHOCK — 반경 +20%, 쿨 -10%',
    has: p => _hasW(p,'PULSE') && _hasW(p,'SHOCK'),
    apply: p => { p.areaMul *= 1.20; p.cdMul *= 1.10; }
  },
  guardian: {
    name:'GUARDIAN', tier:1, desc:'ORBIT + SHOCK — 최대 HP +25, 재생 +0.5',
    has: p => _hasW(p,'ORBIT') && _hasW(p,'SHOCK'),
    apply: p => { p.maxHp += 25; p.hp += 25; p.regen += .5; }
  },
  overdrive: {
    name:'OVERDRIVE', tier:2, desc:'POWER Lv3+ + PULSE — 피해 +15%',
    has: p => _pLv(p,'POWER') >= 3 && _hasW(p,'PULSE'),
    apply: p => { p.dmgMul *= 1.15; }
  },
  swiftShard: {
    name:'SWIFT SHARD', tier:2, desc:'HASTE Lv3+ + BLADE — 쿨 -10%',
    has: p => _pLv(p,'HASTE') >= 3 && _hasW(p,'BLADE'),
    apply: p => { p.cdMul *= 1.10; }
  },
  magneticCore: {
    name:'MAGNETIC CORE', tier:2, desc:'MAGNET Lv3+ + HOMING — 피해 +12%',
    has: p => _pLv(p,'MAGNET') >= 3 && _hasW(p,'HOMING'),
    apply: p => { p.dmgMul *= 1.12; }
  },
  vitalCircuit: {
    name:'VITAL CIRCUIT', tier:2, desc:'SOUL Lv3+ + ORBIT — 재생 +0.8, 최대 HP +30',
    has: p => _pLv(p,'SOUL') >= 3 && _hasW(p,'ORBIT'),
    apply: p => { p.regen += .8; p.maxHp += 30; p.hp += 30; }
  },
  luckySpark: {
    name:'LUCKY SPARK', tier:2, desc:'LUCK Lv3+ + CHAIN — 연쇄 추가 +1, 피해 +10%',
    has: p => _pLv(p,'LUCK') >= 3 && _hasW(p,'CHAIN'),
    apply: p => { p.dmgMul *= 1.10; const w = p.weapons.find(x=>x.key==='CHAIN'); if(w) w.stats.jumps += 1; }
  },
  trinityBeam: {
    name:'TRINITY BEAM', tier:3, desc:'BEAM + PRISM + CHAIN — 피해 +25%, 쿨 -10%',
    has: p => _hasW(p,'BEAM') && _hasW(p,'PRISM') && _hasW(p,'CHAIN'),
    apply: p => { p.dmgMul *= 1.25; p.cdMul *= 1.10; }
  },
  singularity: {
    name:'SINGULARITY', tier:3, desc:'BLACKHOLE + ORBIT + SHOCK — 범위 +25%',
    has: p => _hasW(p,'BLACKHOLE') && _hasW(p,'ORBIT') && _hasW(p,'SHOCK'),
    apply: p => { p.areaMul *= 1.25; p.dmgMul *= 1.08; }
  },
  ascendant: {
    name:'ASCENDANT', tier:3, desc:'진화 무기 보유 — 전 스탯 +8%',
    has: p => _hasEvo(p),
    apply: p => { p.dmgMul *= 1.08; p.speed *= 1.08; p.cdMul *= 1.08; p.areaMul *= 1.08; }
  }
};

/* ───────── SHRINES ─────────
   Mid-run coin sinks. SHRINE entity spawns at 5/10/15min (configurable in
   gameloop). Picking it opens a 3-of-N card pick that costs ◆ to confirm —
   the cost scales with run-time so a long run actually drains its bank.
   Effects are run-only flags consumed by spawnPlayer-style hooks that are
   *already* installed (dmgMul / cdMul / maxHp / weapons.length cap raise).
   =================================================================== */
export const SHRINES = {
  damage:    { id:'damage',    name:'BLOOD COVENANT',  color:C.red,    baseCost:500,
               desc:'전 무기 데미지 +25% (런 영구)',
               apply:(p)=>{ p.dmgMul *= 1.25; } },
  rapid:     { id:'rapid',     name:'ZEAL PACT',       color:C.gold,   baseCost:500,
               desc:'발사 속도 +20% (런 영구)',
               apply:(p)=>{ p.cdMul *= 1.20; } },
  weapSlot:  { id:'weapSlot',  name:'SEVENTH SEAL',    color:C.violet, baseCost:800,
               desc:'무기 슬롯 +1 (현재 max 6 → 7)',
               apply:(p)=>{ p._weaponSlotBonus = (p._weaponSlotBonus||0) + 1; } },
  fortress:  { id:'fortress',  name:'BULWARK HEART',   color:C.lime,   baseCost:600,
               desc:'최대 HP +50% & 풀 회복',
               apply:(p)=>{ const inc = Math.round(p.maxHp * .5); p.maxHp += inc; p.hp = p.maxHp; } },
  legendCard:{ id:'legendCard',name:'GILDED OMEN',     color:C.gold,   baseCost:1200,
               desc:'다음 레벨업 카드 LEGEND 등급 보장',
               apply:(p)=>{ p._guaranteeLegend = true; } },
  greedRun:  { id:'greedRun',  name:'GREED RITE',      color:C.gold,   baseCost:400,
               desc:'코인 픽업 ×2 (런 한정)',
               apply:(p)=>{ p.coinMul = (p.coinMul||1) + 1.0; } },
  shieldRun: { id:'shieldRun', name:'SAINT WARD',      color:C.cyan,   baseCost:600,
               desc:'피해 감소 +20% & 8초 무적',
               apply:(p)=>{ p.dr = Math.min(.85, p.dr + .20); p._boostInvuln = Math.max(p._boostInvuln||0, 8); } },
};
export function rollShrineCards(n=3){
  const all = Object.values(SHRINES);
  const pool = all.slice();
  const out = [];
  while(out.length < n && pool.length){
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}
export function shrineCost(baseCost, runSeconds){
  // Long runs drain more — every 5 minutes adds 100% to base cost.
  const min = Math.max(0, runSeconds / 60);
  const scale = 1 + (min / 5);
  return Math.ceil(baseCost * scale);
}
export const SHRINE_TIMES = [300, 600, 900]; // seconds — 5/10/15 min

/* ───────── GLYPHS ─────────
   Boss-drop only. After killing a boss, player picks 1 of 3 glyphs.
   Glyphs are global, run-only (not saved to meta), and stack (same glyph
   can be picked multiple times). Each apply is straight stat-mul on the
   player so all weapons/items see it. Boss-bane / greed / vampire reach
   into player flags consumed by dealDamage / coin pickup / killEnemy.
   =================================================================== */
const G_ICONS = {
  power(cx,x,y,s,col){ cx.save(); cx.strokeStyle=col; cx.shadowColor=col; cx.shadowBlur=14; cx.lineWidth=2.4;
    const r=s*.34; cx.beginPath();
    cx.moveTo(x,y-r); cx.lineTo(x+r*.8,y+r*.4); cx.lineTo(x-r*.8,y+r*.4); cx.closePath(); cx.stroke();
    cx.fillStyle=col; cx.beginPath(); cx.arc(x,y+r*.05,s*.07,0,TAU); cx.fill(); cx.restore(); },
  rapid(cx,x,y,s,col){ cx.save(); cx.fillStyle=col; cx.shadowColor=col; cx.shadowBlur=14;
    const r=s*.34; cx.beginPath();
    cx.moveTo(x-r*.5,y-r); cx.lineTo(x+r*.5,y-r*.2); cx.lineTo(x,y-r*.2);
    cx.lineTo(x+r*.5,y+r); cx.lineTo(x-r*.5,y+r*.2); cx.lineTo(x,y+r*.2);
    cx.closePath(); cx.fill(); cx.restore(); },
  wide(cx,x,y,s,col){ cx.save(); cx.strokeStyle=col; cx.shadowColor=col; cx.shadowBlur=14; cx.lineWidth=2.4;
    for(let i=0;i<3;i++){ cx.beginPath(); cx.arc(x,y,s*(.14 + i*.10),0,TAU); cx.globalAlpha=1-i*.25; cx.stroke(); }
    cx.globalAlpha=1; cx.restore(); },
  vampire(cx,x,y,s,col){ cx.save(); cx.fillStyle=col; cx.shadowColor=col; cx.shadowBlur=14; const r=s*.30;
    cx.beginPath(); cx.moveTo(x,y-r*.3);
    cx.bezierCurveTo(x-r*1.5,y-r*1.5,x-r*2,y+r*.4,x,y+r*1.4);
    cx.bezierCurveTo(x+r*2,y+r*.4,x+r*1.5,y-r*1.5,x,y-r*.3);
    cx.fill();
    cx.fillStyle='#000'; cx.beginPath();
    cx.moveTo(x+r*.4,y+r*.2); cx.lineTo(x+r*1.0,y+r*.6); cx.lineTo(x+r*.7,y+r*1.1);
    cx.closePath(); cx.fill(); cx.restore(); },
  boss(cx,x,y,s,col){ cx.save(); cx.strokeStyle=col; cx.shadowColor=col; cx.shadowBlur=14; cx.lineWidth=3;
    const r=s*.32;
    cx.beginPath(); cx.arc(x,y,r,0,TAU); cx.stroke();
    cx.beginPath(); cx.moveTo(x-r*.7,y-r*.7); cx.lineTo(x+r*.7,y+r*.7); cx.stroke();
    cx.beginPath(); cx.moveTo(x+r*.7,y-r*.7); cx.lineTo(x-r*.7,y+r*.7); cx.stroke(); cx.restore(); },
  greed(cx,x,y,s,col){ cx.save(); cx.fillStyle=col; cx.shadowColor=col; cx.shadowBlur=14;
    const r=s*.30; cx.beginPath();
    cx.moveTo(x,y-r); cx.lineTo(x+r,y); cx.lineTo(x,y+r); cx.lineTo(x-r,y); cx.closePath(); cx.fill();
    cx.fillStyle='#000'; cx.font='bold ' + Math.round(s*.28) + 'px monospace';
    cx.textAlign='center'; cx.textBaseline='middle'; cx.fillText('◆', x, y); cx.restore(); },
};
export const GLYPHS = {
  power: { id:'power', name:'WRATH RUNE', color:C.cyan,
    desc:'전 무기 데미지 +20%',
    apply: p => { p.dmgMul *= 1.20; },
    icon:(cx,x,y,s)=>G_ICONS.power(cx,x,y,s,C.cyan) },
  rapid: { id:'rapid', name:'ZEAL RUNE', color:C.gold,
    desc:'발사 속도 +18%',
    apply: p => { p.cdMul *= 1.18; },
    icon:(cx,x,y,s)=>G_ICONS.rapid(cx,x,y,s,C.gold) },
  wide:  { id:'wide',  name:'DOMINION RUNE',  color:C.violet,
    desc:'효과 범위 +22%',
    apply: p => { p.areaMul *= 1.22; },
    icon:(cx,x,y,s)=>G_ICONS.wide(cx,x,y,s,C.violet) },
  vampire: { id:'vampire', name:'VAMPIRE RUNE', color:C.lime,
    desc:'처치 시 8% 확률 +6 HP',
    apply: p => {
      p.killHealChance = (p.killHealChance||0) + .08;
      p.killHealAmt = Math.max(p.killHealAmt||0, 6);
    },
    icon:(cx,x,y,s)=>G_ICONS.vampire(cx,x,y,s,C.lime) },
  bossBane: { id:'bossBane', name:'ABYSS BANE', color:C.red,
    desc:'보스 적에게 +35% 데미지',
    apply: p => { p.bossDmgMul = (p.bossDmgMul||1) * 1.35; },
    icon:(cx,x,y,s)=>G_ICONS.boss(cx,x,y,s,C.red) },
  greed: { id:'greed', name:'GREED RUNE', color:C.gold,
    desc:'코인 +50% 가산, 픽업 범위 +30%',
    apply: p => { p.coinMul = (p.coinMul||1) * 1.5; p.magnet *= 1.30; },
    icon:(cx,x,y,s)=>G_ICONS.greed(cx,x,y,s,C.gold) },
};

/* ───────── CHIPSET ─────────
   Permanent gacha chips bought with ◆. Stored in meta.chips.
   Schema:
     meta.chips.owned[id] = stackLevel       (1+ once owned; 2+ from fusion)
     meta.chips.equipped  = [id, id, null...] (length = slots)
     meta.chips.slots     = N                (default 3, expandable via gacha-page)
   Effects fire from spawnPlayer (player.js applyChips). Tier weights mirror
   ITEM_TIERS for visual consistency. Single-pull = ◆100, 10-pull = ◆900
   (10% off bulk). Slot expansion = 500/1500/4500/...
   Same chip pulled again -> stack +1 (effect *= stackMul of that chip).
   Three of same stack -> manual fusion to next tier (lose 3, gain 1 stronger).
   =================================================================== */
export const CHIP_TIERS = {
  common:    { key:'common',    color:'#b0bccc', glow:'rgba(176,188,204,.6)', weight:65, label:'COMMON' },
  rare:      { key:'rare',      color:C.cyan,    glow:'rgba(0,240,255,.85)',  weight:25, label:'RARE' },
  epic:      { key:'epic',      color:C.violet,  glow:'rgba(155,92,255,.95)', weight: 8, label:'EPIC' },
  legendary: { key:'legendary', color:C.gold,    glow:'rgba(255,212,0,1)',    weight: 2, label:'LEGEND' },
};
// Chip definitions. Each apply(p, lv) is run once at spawn for each equipped
// stack-level. Effects intentionally smaller than relics so 6-slot full-build
// caps around +30~40% global — keeps run challenge alive (per balance agent).
export const CHIPS = {
  // ── COMMON ──
  pulseChip:  { id:'pulseChip',  name:'NOVA RUNE',      tier:'common', desc:'Sanctified Nova 보유 시 데미지 +6%/Lv',
                apply:(p,lv)=>{ if(p.weapons.find(w=>w.key==='PULSE')) p.dmgMul *= (1 + .06*lv); } },
  beamChip:   { id:'beamChip',   name:'LANCE RUNE',     tier:'common', desc:'Seraph Lance 보유 시 범위 +8%/Lv',
                apply:(p,lv)=>{ if(p.weapons.find(w=>w.key==='BEAM')) p.areaMul *= (1 + .08*lv); } },
  warmStart:  { id:'warmStart',  name:'MARTYR SEAL',    tier:'common', desc:'시작 시 +20 HP/Lv',
                apply:(p,lv)=>{ p.maxHp += 20*lv; p.hp += 20*lv; } },
  scavenger:  { id:'scavenger',  name:'SCAVENGER RUNE', tier:'common', desc:'아이템 드랍 운 +5%/Lv',
                apply:(p,lv)=>{ p.luck = (p.luck||0) + .05*lv; } },
  spikeShoes: { id:'spikeShoes', name:'PILGRIM MARK',   tier:'common', desc:'이동 속도 +5%/Lv',
                apply:(p,lv)=>{ p.speed *= (1 + .05*lv); } },
  // ── RARE ──
  bossHunter: { id:'bossHunter', name:'BANE RUNE',      tier:'rare',   desc:'보스 데미지 +12%/Lv',
                apply:(p,lv)=>{ p.bossDmgMul = (p.bossDmgMul||1) * (1 + .12*lv); } },
  killStreak: { id:'killStreak', name:'SLAUGHTER RITE', tier:'rare',   desc:'처치 20마다 5초간 +10%/Lv 데미지',
                apply:(p,lv)=>{ p._killStreakBonus = (p._killStreakBonus||0) + .10*lv; p._killStreakNeed = 20; p._killStreakDur = 5; } },
  ironPlate:  { id:'ironPlate',  name:'IRON VOW',       tier:'rare',   desc:'피해 감소 +3%/Lv',
                apply:(p,lv)=>{ p.dr = Math.min(.85, (p.dr||0) + .03*lv); } },
  greedChip:  { id:'greedChip',  name:'GREED MARK',     tier:'rare',   desc:'코인 +25%/Lv 가산',
                apply:(p,lv)=>{ p.coinMul = (p.coinMul||1) * (1 + .25*lv); } },
  vampChip:   { id:'vampChip',   name:'VAMPIRE MARK',   tier:'rare',   desc:'처치 시 +5% 확률/Lv +3HP',
                apply:(p,lv)=>{ p.killHealChance = (p.killHealChance||0) + .05*lv; p.killHealAmt = Math.max(p.killHealAmt||0, 3); } },
  // ── EPIC ──
  overdrive:  { id:'overdrive',  name:'ZEAL SIGIL',     tier:'epic',   desc:'발사 속도 +8%/Lv',
                apply:(p,lv)=>{ p.cdMul *= (1 + .08*lv); } },
  amplifier:  { id:'amplifier',  name:'WRATH SIGIL',    tier:'epic',   desc:'전 무기 데미지 +9%/Lv',
                apply:(p,lv)=>{ p.dmgMul *= (1 + .09*lv); } },
  rangeChip:  { id:'rangeChip',  name:'DOMINION SIGIL', tier:'epic',   desc:'범위 +10%/Lv',
                apply:(p,lv)=>{ p.areaMul *= (1 + .10*lv); } },
  // ── LEGEND ──
  singularity:{ id:'singularity',name:'ABYSSAL SIGIL', tier:'legendary', desc:'데미지+15%, 쿨감-8%/Lv',
                apply:(p,lv)=>{ p.dmgMul *= (1 + .15*lv); p.cdMul *= (1 + .08*lv); } },
  phoenixCore:{ id:'phoenixCore',name:'PHOENIX OATH',     tier:'legendary', desc:'런당 1회 부활 (Lv2: 2회)',
                apply:(p,lv)=>{ p.revives = (p.revives||0) + lv; } },
  // ── EXPANSION (B-3) — 5 new chips for variety ──
  thornChip:  { id:'thornChip',  name:'THORN VOW',      tier:'rare',   desc:'피격 시 반경 100 적에 30/Lv 데미지',
                apply:(p,lv)=>{ p._thornDmg = (p._thornDmg||0) + 30*lv; p._thornR = 100; } },
  dashChip:   { id:'dashChip',   name:'BLINK SIGIL',    tier:'epic',   desc:'10초마다 자동 회피 1회 (무적 0.4초)',
                apply:(p,lv)=>{ p._autoDashCd = (p._autoDashCd||10) / lv; p._autoDashOn = true; } },
  frostChip:  { id:'frostChip',  name:'FROSTBOUND RUNE', tier:'rare',  desc:'적 처치 시 5% 확률/Lv로 주변 둔화',
                apply:(p,lv)=>{ p._frostKillChance = (p._frostKillChance||0) + .05*lv; } },
  startCoinChip:{id:'startCoinChip',name:'PILGRIM CACHE',tier:'common',desc:'시작 시 +50 코인/Lv (런 한정)',
                apply:(p,lv)=>{ G.coinsRun = (G.coinsRun||0) + 50*lv; } },
  comboChip:  { id:'comboChip',  name:'SLAUGHTER SIGIL', tier:'epic',  desc:'×10 콤보마다 데미지 +3%/Lv (캡 +30%)',
                apply:(p,lv)=>{ p._comboBonusPer10 = (p._comboBonusPer10||0) + .03*lv; p._comboBonusCap = 0.30; } },
};
export const CHIP_PULL_COST = 100;
export const CHIP_PULL10_COST = 900;
export const CHIP_SLOT_COSTS = [500, 1500, 4500, 10000]; // slot 4, 5, 6, 7
export const CHIP_DEFAULT_SLOTS = 3;
export function chipsByTier(tier){ return Object.values(CHIPS).filter(c => c.tier === tier); }
export function rollChipTier(){
  let total = 0; for(const k in CHIP_TIERS) total += CHIP_TIERS[k].weight;
  let r = Math.random() * total;
  for(const k in CHIP_TIERS){ r -= CHIP_TIERS[k].weight; if(r <= 0) return k; }
  return 'common';
}
export function rollChip(){
  const tier = rollChipTier();
  const pool = chipsByTier(tier);
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ───────── SHOP ───────── */
export const SHOP_ITEMS = [
  {key:'hp',     name:'VITAL FORGE',  desc:'시작 HP +20', max:8, costFn: lv => 10 + lv*5 },
  {key:'dmg',    name:'WRATH FORGE',  desc:'기본 데미지 +6%', max:8, costFn: lv => 12 + lv*6 },
  {key:'speed',  name:'PILGRIM BOOTS',desc:'이동 속도 +4%', max:8, costFn: lv => 10 + lv*5 },
  {key:'magnet', name:'GREED ALTAR',  desc:'픽업 범위 +25%', max:6, costFn: lv => 14 + lv*7 },
  {key:'regen',  name:'BLOOD FONT',   desc:'재생 +0.4/s', max:6, costFn: lv => 16 + lv*8 },
  {key:'armor',  name:'IRON VESTMENT',desc:'피해 감소 +4%', max:6, costFn: lv => 16 + lv*8 },
  {key:'reroll', name:'DIVINATION',   desc:'축복 재점 비용 -1', max:3, costFn: lv => 30 + lv*15 },
  {key:'luck',   name:'FORTUNE SEAL', desc:'드랍/희귀 가산 +10%', max:5, costFn: lv => 22 + lv*10 },
  {key:'start',  name:'RELIC CACHE',  desc:'시작 시 무작위 유물 1개씩 자동 장착', max:5, costFn: lv => 60 + lv*40 },
];
