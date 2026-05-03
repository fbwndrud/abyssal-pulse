/* ===================================================================
   PLAYER — spawn, weapon/passive add+level, damage, evolution apply,
   item application, drop helpers, synergy check.
   Installs the kill hook in entities.js so killEnemy can drop XP/items
   without entities.js having to import data.js.
   =================================================================== */
import { G, W, H, C, TAU, rand, meta, saveMeta, saveMetaLater, announce } from './core.js';
import { AUDIO } from './audio.js';
import {
  makeEnt, fxBurst, fxRing, fxText, shake, flash,
  spawnXP, spawnCoin, spawnHeart, spawnMagnet, spawnFreeze, spawnChest, spawnEnemy,
  setOnKillHook,
} from './entities.js';
import {
  CLASSES, PASSIVES, ITEMS, ITEM_TIERS, SYNERGIES, itemsByTier,
} from './data.js';
import { WEAPONS, EVOLUTIONS, FUSIONS, findFusion } from './weapons.js';

// doLevelUp lives in ui.js. Avoid a hard import (would create a tighter cycle);
// ui.js wires it via setLevelUpHandler at boot.
let _doLevelUp = null, _endRun = null;
export function setUiHandlers({ doLevelUp, endRun }){
  _doLevelUp = doLevelUp; _endRun = endRun;
}

/* ───────── PLAYER SPAWN ───────── */
export function spawnPlayer(classKey){
  const cl = CLASSES[classKey];
  const p = {
    type:'player', x:0, y:0, vx:0, vy:0,
    r: cl.r, color: cl.color, sides: cl.sides,
    hp: cl.hp, maxHp: cl.hp,
    speed: cl.speed * (1 + meta.shop.speed*.04),
    dmgMul: 1 + meta.shop.dmg*.06,
    cdMul: 1,
    areaMul: 1,
    magnet: 70 * (1 + meta.shop.magnet*.25),
    luck: meta.shop.luck * .1,
    dr: meta.shop.armor*.04,
    regen: meta.shop.regen*.4,
    invuln: 1.5,
    weapons: [],
    passives: {},
    level: 1,
    xp: 0,
    xpNext: 5,
    faceA: 0,
    rot: 0,
    trail: [],
  };
  addWeapon(p, cl.startWeap);
  p.maxHp += meta.shop.hp * 20;
  p.hp = p.maxHp;
  G.player = p;
  // Snap camera to the player on spawn — without this the run starts with
  // the camera at (0,0) lerping toward the player, which leaves the player
  // visibly off-center for the first ~1 second.
  G.cam.x = p.x - W/2;
  G.cam.y = p.y - H/2;
  G.cam.tx = G.cam.x;
  G.cam.ty = G.cam.y;
  // PRELOADED shop bonus: auto-apply N random relics at start (one per upgrade level).
  // Relics only (consumables wouldn't make sense here — they're transient).
  const startCount = meta.shop.start || 0;
  if(startCount > 0){
    const relicPool = Object.values(ITEMS).filter(it => it.kind === 'relic' && it.tier !== 'legendary');
    for(let i = 0; i < startCount && relicPool.length; i++){
      const pick = relicPool[Math.floor(Math.random() * relicPool.length)];
      applyItem(p, pick.id);
    }
  }
  return p;
}

export function addWeapon(p, key){
  if(p.weapons.length >= 6) return false;
  if(p.weapons.find(w=>w.key===key)) return false;
  const def = WEAPONS[key];
  if(!def) return false;
  const inst = { key, def, level:1, stats: JSON.parse(JSON.stringify(def.baseStats)), id: Math.random().toString(36).slice(2,6) };
  p.weapons.push(inst);
  if(!meta.seenCodex.weapons.includes(key)){ meta.seenCodex.weapons.push(key); saveMeta(); }
  updateSynergies(p);
  return true;
}
export function levelWeapon(p, key, mult){
  const w = p.weapons.find(w=>w.key===key); if(!w) return false;
  if(w.level >= w.def.maxLv) return false;
  w.level++;
  const before = {};
  for(const k in w.stats){ if(typeof w.stats[k] === 'number') before[k] = w.stats[k]; }
  w.def.levelUp(w, w.level);
  if(mult && mult !== 1){
    for(const k in before){
      const cur = w.stats[k];
      const delta = cur - before[k];
      if(delta !== 0) w.stats[k] = before[k] + delta * mult;
    }
  }
  return true;
}
export function addPassive(p, key, mult){
  const def = PASSIVES[key];
  const lv = (p.passives[key]||0) + 1;
  if(lv > def.maxLv) return false;
  // Per-level stat boost — modest (smaller than original since maxLv compressed
  // 5→3). Items remain the primary stat lever.
  if(typeof def.apply === 'function') def.apply(p, mult || 1);
  p.passives[key] = lv;
  // Max-level milestone: evolution gate unlocked + flavor burst.
  if(lv === def.maxLv && typeof def.lv3Reward === 'function'){
    def.lv3Reward(p);
    fxBurst(p.x, p.y, def.color, 30, 240, 3.5, .7);
    fxRing(p.x, p.y, def.color, 110, .6);
    AUDIO.level();
    announce('▲ ' + def.name + ' MAX — 진화 게이트 해금', 2.0);
  }
  if(!meta.seenCodex.passives.includes(key)){ meta.seenCodex.passives.push(key); saveMeta(); }
  return true;
}
export function damagePlayer(amount){
  const p = G.player; if(!p || p.invuln > 0) return;
  amount = Math.max(1, amount * (1 - p.dr));
  p.hp -= amount;
  p.invuln = .85;
  shake(.18);
  flash(C.red, .25);
  AUDIO.damage();
  fxBurst(p.x, p.y, C.red, 16, 200, 3, .5);
  fxText(p.x, p.y - p.r - 6, '-' + Math.round(amount), C.red);
  if(p.hp <= 0){
    p.hp = 0;
    if(_endRun) _endRun(false);
  }
}

/* ───────── EVOLUTION ─────────
   Multi-path: each weapon now has 1+ evolution defs gated by different
   passives. weaponEvoReady returns ALL paths whose req passives are
   maxed (caller picks one via card UI). */
export function weaponEvoReady(p, w){
  const list = EVOLUTIONS[w.key];
  if(!Array.isArray(list)) return [];
  if(w.evolved) return [];
  if(w.level < w.def.maxLv) return [];
  return list.filter(e =>
    e.req.every(pk => (p.passives[pk]||0) >= (PASSIVES[pk]?.maxLv ?? 0))
  );
}
export function applyEvo(p, weaponKey, evoId){
  const w = p.weapons.find(x => x.key === weaponKey); if(!w) return;
  const list = EVOLUTIONS[weaponKey]; if(!Array.isArray(list)) return;
  const e = evoId ? list.find(x => x.id === evoId) : list[0];
  if(!e) return;
  e.apply(w);
  if(!w.evolved) w.evolved = true;
  w.evoName = e.name;
  w.evoColor = e.color;
  // Some evos grant passive player buffs via extra flags (regenBoost, etc.)
  // Apply those at evo-time so the player carries them through the run.
  if(w.extra?.regenBoost){ p.regen += w.extra.regenBoost; }
  fxRing(p.x, p.y, e.color, 180, .9);
  fxBurst(p.x, p.y, e.color, 60, 360, 5, .8);
  shake(.4); flash(e.color, .4);
  AUDIO.explode();
  announce('▲ 진화 · ' + e.name, 2.2);
  updateSynergies(p);
}

/* ───────── FUSION ─────────
   A fusion is offered when both source weapons are EVOLVED and at maxLv.
   Picking it removes both source weapons and adds the fused weapon at Lv 1.
   Each fusion in weapons.js defines its own onUpdate so the resulting
   weapon expresses both source identities — Lv 1 is intentionally tuned
   to feel stronger than the two source maxLv evolutions combined. */
function _fusionGenericIcon(color){
  return (ctx, x, y, s) => {
    ctx.save();
    ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.lineWidth = 2.4;
    const r = s * .35;
    // outer star
    ctx.beginPath();
    for(let i=0;i<10;i++){
      const a = i*Math.PI/5 - Math.PI/2;
      const rr = i%2===0 ? r : r*.55;
      const px = x + Math.cos(a)*rr, py = y + Math.sin(a)*rr;
      if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    }
    ctx.closePath(); ctx.stroke();
    // inner ring
    ctx.beginPath(); ctx.arc(x,y,r*.3,0,Math.PI*2); ctx.stroke();
    ctx.restore();
  };
}
export function fusionsAvailable(p){
  // Returns array of fusion keys ready to trigger.
  if(!p || !p.weapons) return [];
  const out = [];
  for(const k in FUSIONS){
    const f = FUSIONS[k];
    const a = p.weapons.find(w => w.key === f.sourceA);
    const b = p.weapons.find(w => w.key === f.sourceB);
    if(!a || !b) continue;
    if(!a.evolved || !b.evolved) continue;
    if(a.level < a.def.maxLv || b.level < b.def.maxLv) continue;
    out.push(k);
  }
  return out;
}
export function applyFusion(p, fuseKey){
  const fuse = FUSIONS[fuseKey]; if(!fuse) return;
  const def = {
    name: fuse.name,
    color: fuse.color,
    kind: fuse.kind,
    desc: fuse.desc,
    maxLv: fuse.maxLv || 6,
    baseStats: fuse.baseStats,
    icon: fuse.icon || _fusionGenericIcon(fuse.color),
    onUpdate: fuse.onUpdate,
    levelUp: fuse.levelUp,
  };
  // Remove both source weapons (in descending index so splice is safe)
  const idxA = p.weapons.findIndex(w => w.key === fuse.sourceA);
  const idxB = p.weapons.findIndex(w => w.key === fuse.sourceB);
  if(idxA < 0 || idxB < 0) return;
  const [hi, lo] = idxA > idxB ? [idxA, idxB] : [idxB, idxA];
  p.weapons.splice(hi, 1);
  p.weapons.splice(lo, 1);
  // Add the fused weapon at Lv 1 (with its own key so other code never confuses it
  // with a base WEAPONS entry; pause/codex match against fuse.id).
  const inst = {
    key: fuse.id, def, level:1,
    stats: JSON.parse(JSON.stringify(fuse.baseStats)),
    id: Math.random().toString(36).slice(2,6),
    color: fuse.color, evolved: false, isFusion: true,
    fuseKey: fuseKey,
    extra: fuse.extra ? Object.assign({}, fuse.extra) : null,
  };
  p.weapons.push(inst);
  // Dramatic fx
  fxRing(p.x, p.y, fuse.color, 220, 1.0);
  fxBurst(p.x, p.y, fuse.color, 80, 400, 6, .9);
  shake(.5); flash(fuse.color, .5);
  AUDIO.explode();
  announce('★ 융합 · ' + fuse.name, 2.5);
  updateSynergies(p);
}

/* ───────── SYNERGIES ───────── */
export function updateSynergies(p){
  if(!p._synergiesActive) p._synergiesActive = new Set();
  for(const sid in SYNERGIES){
    const s = SYNERGIES[sid];
    if(!p._synergiesActive.has(sid) && s.has(p)){
      p._synergiesActive.add(sid);
      s.apply(p);
      fxBurst(p.x, p.y, C.gold, 36, 260, 4, .6);
      fxRing(p.x, p.y, C.gold, 140, .7);
      shake(.2); flash(C.gold, .25);
      AUDIO.level();
      announce('◈ 시너지 · ' + s.name, 2.0);
    }
  }
}

/* ───────── ITEMS ─────────
   kindFilter: 'relic' or 'consumable' to restrict the pool. Used so bosses
   only drop relics (chest pick) and mobs only drop consumables. */
export function pickRandomItem(luck, tierBias, kindFilter){
  const tiers = tierBias || ['common','rare','legendary'];
  const L = Math.max(0, luck||0);
  const weights = {
    common: tiers.includes('common') ? Math.max(0, 5 - L*2) : 0,
    rare: tiers.includes('rare') ? 2 + L*1.2 : 0,
    legendary: tiers.includes('legendary') ? .5 + L*.9 : 0
  };
  const total = weights.common + weights.rare + weights.legendary;
  if(total <= 0) return null;
  let r = Math.random()*total; let pickTier = 'common';
  if((r -= weights.common) <= 0) pickTier = 'common';
  else if((r -= weights.rare) <= 0) pickTier = 'rare';
  else pickTier = 'legendary';
  const tieredPool = itemsByTier(pickTier);
  const pool = kindFilter ? tieredPool.filter(it => it.kind === kindFilter) : tieredPool;
  if(!pool.length) return null;
  return pool[Math.floor(Math.random()*pool.length)];
}
export function dropItem(x, y, luck, tierBias, kindFilter){
  const it = pickRandomItem(luck, tierBias, kindFilter);
  if(!it) return null;
  return makeEnt({type:'item', x, y, vx:rand(-60,60), vy:rand(-60,60), r:11, color:ITEM_TIERS[it.tier].color, glow:ITEM_TIERS[it.tier].glow, item:it, life:30, maxLife:30});
}
export function applyItem(p, itemId){
  const it = ITEMS[itemId]; if(!it) return;
  it.apply(p);
  if(it.kind === 'relic'){
    if(!p.relics) p.relics = [];
    p.relics.push(itemId);
  }
  if(!meta.seenCodex.items) meta.seenCodex.items = [];
  if(!meta.seenCodex.items.includes(itemId)){ meta.seenCodex.items.push(itemId); saveMeta(); }
  const col = ITEM_TIERS[it.tier].color;
  fxBurst(p.x, p.y, col, 24, 200, 3, .5);
  fxRing(p.x, p.y, col, 80, .5);
  AUDIO.pickup();
  announce((it.kind==='relic'?'◈ 유물 · ':'◇ 아이템 · ') + it.name, 1.6);
  if(p._forcedLevelup){ p._forcedLevelup = false; p.xp = p.xpNext; if(_doLevelUp) _doLevelUp(false); }
  updateSynergies(p);
}

/* ───────── KILL HOOK INSTALL ─────────
   Called by entities.killEnemy after fx; drops XP / items / does HEX split. */
setOnKillHook(function onKill(e){
  spawnXP(e.x, e.y, e.xp || 1);
  if(Math.random() < (e.gold || 0) + (G.player ? G.player.luck*.05 : 0)){
    spawnCoin(e.x, e.y);
  }
  const pLuck = G.player ? G.player.luck : 0;
  // Drop rate caps — luck never breaks the game economy.
  const HEART_CAP = .015, ITEM_MOB_CAP = .008, ITEM_ELITE_CAP = .08;
  if(e.isBoss){
    // Boss reward = chest only. Chest opens to a 3-relic pick screen.
    // Relics are gated to bosses so they feel like meaningful milestones.
    spawnChest(e.x, e.y);
  } else if(Math.random() < Math.min(HEART_CAP, .003 + pLuck*.01)){
    spawnHeart(e.x, e.y);
  } else if(Math.random() < .002){
    spawnMagnet(e.x, e.y);
  } else if(Math.random() < .0008){
    spawnFreeze(e.x, e.y);
  } else if(Math.random() < Math.min(ITEM_MOB_CAP, .0015 + pLuck*.003)){
    // Regular mobs: small chance of a consumable item. Relics never drop here.
    dropItem(e.x, e.y, pLuck, ['common','rare'], 'consumable');
  }
  // Elite (HEX/OCT) drop chance — bumped slightly back to 3% since passives no
  // longer give stat boosts; consumable items now carry the stat scaling load.
  if(!e.isBoss && (e.kind === 'HEX' || e.kind === 'OCT')){
    if(Math.random() < Math.min(ITEM_ELITE_CAP, .03 + pLuck*.025)){
      dropItem(e.x, e.y, pLuck, ['common','rare'], 'consumable');
    }
  }
  if(e.def && e.def.onDeath === 'split'){
    for(let i=0;i<3;i++){
      const a = Math.random()*TAU;
      const m = spawnEnemy('SWARM', e.x + Math.cos(a)*8, e.y + Math.sin(a)*8);
      m.vx = Math.cos(a)*200; m.vy = Math.sin(a)*200;
    }
  }
});
