/* ===================================================================
   UI — DOM-side rendering (HUD, level-up cards, menus, shop, codex,
   pause/end overlays) and run lifecycle (startRun/endRun).
   =================================================================== */
import {
  G, C, TAU, fmtTime, meta, saveMeta,
  setBar, announce,
} from './core.js';
import { AUDIO } from './audio.js';
import { withDrawCtx } from './render.js';
import {
  shake, flash, clearAllWorldSprites, fxBurst, fxRing,
} from './entities.js';
import {
  CLASSES, PASSIVES, ENEMIES, UPGRADE_TIERS, SHOP_ITEMS,
  ITEMS, ITEM_TIERS,
  rollUpgradeTier, rollTierMult,
} from './data.js';
import { WEAPONS, EVOLUTIONS, FUSIONS } from './weapons.js';
import {
  spawnPlayer, addWeapon, levelWeapon, addPassive, applyEvo, weaponEvoReady,
  updateSynergies, applyItem, pickRandomItem,
  fusionsAvailable, applyFusion, setUiHandlers,
} from './player.js';

/* ===================================================================
   STAT PREVIEW HELPERS
   - previewWeaponDelta: simulate next levelUp on a clone, return before/after
   - passivePreviewLines: per-passive human-readable lines with mult applied
   - weaponBaseStatLines: stat list for a brand-new weapon
   - statLabel / fmtVal: display formatting
   =================================================================== */
const STAT_LABELS = {
  cd:'CD', dmg:'DMG', radius:'RAD', kb:'KB',
  rotSpeed:'ROT', length:'LEN', width:'WID', count:'CNT',
  tick:'TICK', nodeR:'NODE',
  speed:'SPD', life:'LIFE',
  pierce:'PIER',
  arc:'ARC',
  jumps:'JUMP', range:'RNG',
  pull:'PULL', splits:'SPL',
};
// Hover description per stat — shown via native title tooltip on each row.
const STAT_DESC = {
  cd:'쿨다운 — 무기 재발사 간격(초). 낮을수록 좋음',
  dmg:'데미지 — 1회 적중 피해량',
  radius:'반경 — 효과 범위(픽셀)',
  kb:'넉백 — 적을 밀어내는 힘',
  rotSpeed:'회전 속도 — 라디안/초',
  length:'사거리 — 빔 길이(픽셀)',
  width:'굵기 — 빔/공격 굵기',
  count:'개수 — 동시 발사/노드 수',
  tick:'적중 간격 — 빔의 데미지 발생 주기(초). 낮을수록 좋음',
  nodeR:'노드 크기 — 궤도 노드 반경',
  speed:'탄속 — 투사체 속도(픽셀/초)',
  life:'지속 — 투사체/효과 유지 시간(초)',
  pierce:'관통 — 한 발이 통과 가능한 적 수',
  arc:'각도 — 부채꼴 너비(라디안)',
  jumps:'연쇄 — 사슬이 튕기는 횟수',
  range:'사거리 — 사슬 점프 가능 거리',
  pull:'흡인력 — 적을 빨아들이는 힘',
  splits:'분열 — 명중 시 갈라지는 탄 수',
};
function statLabel(k){ return STAT_LABELS[k] || k.toUpperCase(); }
function statDesc(k){ return STAT_DESC[k] || k; }
function fmtVal(v){
  if(typeof v !== 'number') return String(v);
  if(Number.isInteger(v)) return String(v);
  // 2 dp, strip trailing zeros
  return v.toFixed(2).replace(/\.?0+$/, '') || '0';
}
function fmtDelta(d){
  const sign = d > 0 ? '+' : '';
  if(Math.abs(d) < 0.005) return '';
  return sign + fmtVal(d);
}
// Stats where a higher number is *worse* (e.g. cooldown). Used to color deltas.
const LOWER_IS_BETTER = new Set(['cd','tick']);

function previewWeaponDelta(w, mult){
  const before = {};
  for(const k in w.stats){ if(typeof w.stats[k] === 'number') before[k] = w.stats[k]; }
  const cloneStats = JSON.parse(JSON.stringify(w.stats));
  const cloneInst = { stats: cloneStats, level: w.level + 1, def: w.def };
  w.def.levelUp(cloneInst, w.level + 1);
  const after = {};
  for(const k in cloneStats){ if(typeof cloneStats[k] === 'number') after[k] = cloneStats[k]; }
  const m = mult || 1;
  if(m !== 1){
    for(const k in before){
      const delta = after[k] - before[k];
      if(delta !== 0) after[k] = before[k] + delta * m;
    }
  }
  return { before, after };
}

function renderStatTable(rows){
  // rows: [{key, before?, after, delta?, multAffected?, rawKey}]
  if(!rows.length) return '';
  const html = rows.map(r => {
    const tip = r.rawKey ? statDesc(r.rawKey) : r.key;
    const kv = `<span class="key">${r.key}</span>`;
    let val;
    if(r.before != null && r.after != null && r.before !== r.after){
      const d = r.after - r.before;
      const better = LOWER_IS_BETTER.has(r.rawKey) ? d < 0 : d > 0;
      const cls = better ? 'delta-pos' : 'delta-neg';
      const arrow = better ? '▲' : '▼';
      const deltaTxt = fmtDelta(d);
      val = `<span class="val">${fmtVal(r.before)}<span class="arrow">→</span>${fmtVal(r.after)}${deltaTxt?`<span class="${cls}">${arrow}${deltaTxt}</span>`:''}</span>`;
    } else if(r.after != null){
      val = `<span class="val">${fmtVal(r.after)}</span>`;
    } else {
      val = `<span class="val">${r.text || ''}</span>`;
    }
    return `<div class="row" title="${tip.replace(/"/g,'&quot;')}">${kv}${val}</div>`;
  }).join('');
  return `<div class="stat-table">${html}</div>`;
}

function weaponUpgradeRows(w, mult){
  const { before, after } = previewWeaponDelta(w, mult);
  const rows = [];
  for(const k in before){
    if(before[k] === after[k]) continue;
    rows.push({ rawKey:k, key:statLabel(k), before:before[k], after:after[k] });
  }
  return rows;
}

function weaponNewRows(def){
  const rows = [];
  for(const k in def.baseStats){
    const v = def.baseStats[k];
    if(typeof v !== 'number') continue;
    rows.push({ rawKey:k, key:statLabel(k), after:v });
  }
  return rows;
}

function passivePreviewRows(passiveKey, mult, currentLv, p){
  // Personalized: show evolutions PLAYER CAN ACTUALLY UNLOCK with their current
  // weapons via this passive. (Generic "all unlocks" felt detached.)
  const rows = [];
  const lvNext = (currentLv || 0) + 1;
  const maxLv = PASSIVES[passiveKey].maxLv;
  // Stat-effect line — passives give modest stat per level too now
  const statLine = (() => {
    switch(passiveKey){
      case 'POWER':   return 'DMG +8%';
      case 'HASTE':   return '이동 +6%';
      case 'CADENCE': return '쿨감 +6%';
      case 'REACH':   return '범위 +8%';
      case 'ARMOR':   return 'DR +4%';
      case 'SOUL':    return 'HP +12, 재생 +0.25/s';
      case 'MAGNET':  return '픽업 +20%';
      case 'LUCK':    return '행운 +6%';
    }
    return '';
  })();
  if(statLine) rows.push({ key:'NOW', text: statLine });
  // Personalized evolution preview
  const myWeaponKeys = p ? new Set(p.weapons.map(w => w.key)) : new Set();
  const matches = [];
  for(const wKey in EVOLUTIONS){
    if(!myWeaponKeys.has(wKey)) continue;
    for(const evo of EVOLUTIONS[wKey]){
      if(evo.req.includes(passiveKey)) matches.push({ wKey, evo });
    }
  }
  if(matches.length){
    // Show up to 2 matches with weapon Lv progress
    const shown = matches.slice(0, 2).map(m => {
      const w = p.weapons.find(x => x.key === m.wKey);
      const wLv = w ? `${w.level}/${w.def.maxLv}` : '?';
      return `${m.wKey} Lv.${wLv} → ${m.evo.name}`;
    });
    for(const s of shown) rows.push({ key:lvNext === maxLv ? '★MAX' : 'EVO', text: s });
    if(matches.length > 2){
      rows.push({ key:'+', text:`...+${matches.length-2} 더` });
    }
  } else if(p) {
    rows.push({ key:'EVO', text:'<span style="color:#7d96b4">관련 무기 미보유</span>' });
  }
  return rows;
}

function evolutionRows(w, evoDef){
  const before = {};
  for(const k in w.stats){ if(typeof w.stats[k] === 'number') before[k] = w.stats[k]; }
  const cloneStats = JSON.parse(JSON.stringify(w.stats));
  evoDef.apply({ stats: cloneStats });
  const rows = [];
  for(const k in cloneStats){
    if(typeof cloneStats[k] !== 'number') continue;
    if(before[k] === cloneStats[k]) continue;
    rows.push({ rawKey:k, key:statLabel(k), before:before[k], after:cloneStats[k] });
  }
  return rows;
}

/* ===================================================================
   LEVEL UP / CARD CHOOSER
   =================================================================== */
export function doLevelUp(forceNoXpReset=false){
  const p = G.player;
  if(!forceNoXpReset && p.xp >= p.xpNext){
    p.xp -= p.xpNext;
    p.level++;
    // Log-cap XP curve: exponential up to ~250, then plateau.
    // Without the cap, late game (L15+) demanded 400+ XP/level — multiple
    // minutes between level-ups. Cap keeps the picking flow steady so the
    // player gets weapon/passive choices throughout the run.
    // L1=3, L5=22, L10=101, L13≈250(cap), L20=250.
    p.xpNext = Math.min(Math.round(p.xpNext * 1.30 + 2), 250);
  }
  AUDIO.level();
  shake(.1); flash('#fff', .25);
  G.mode = 'levelup';
  // Reroll cost resets every level-up — within a single screen rerolls still
  // compound, but progressing to the next level starts fresh at the base cost.
  G.rerollCost = 3;
  G.weaponPickPool = pickLevelupCards(p, 3);
  document.getElementById('levelup-overlay').classList.remove('hidden');
  document.getElementById('reroll-cost').textContent = G.rerollCost;
  renderLevelupCards();
}
function pickLevelupCards(p, n=3){
  // Evolutions and fusions auto-trigger from gameloop._autoEvoFuse — no longer
  // surfaced as level-up cards. Cards offer weap_new / weap_up / pas / heal /
  // gold only.
  const pool = [];
  for(const w of p.weapons){
    if(w.level < w.def.maxLv){
      pool.push({type:'weap_up', key:w.key, weight: 6});
    }
  }
  if(p.weapons.length < 6){
    for(const k in WEAPONS){
      if(!p.weapons.find(w=>w.key===k)){
        pool.push({type:'weap_new', key:k, weight: 5});
      }
    }
  }
  for(const k in PASSIVES){
    const lv = p.passives[k]||0;
    if(lv < PASSIVES[k].maxLv){
      pool.push({type:'pas', key:k, weight: 4 + (lv>0?2:0)});
    }
  }
  pool.push({type:'heal', weight:2});
  pool.push({type:'gold', weight:2});

  const out = [];
  const used = new Set();
  while(out.length < n){
    let total = 0;
    for(const x of pool){ if(!used.has(x)) total += x.weight * (1 + p.luck*.5); }
    if(total === 0) break;
    let r = Math.random()*total;
    let chosen = null;
    for(const x of pool){
      if(used.has(x)) continue;
      const w = x.weight * (1 + p.luck*.5);
      if(r < w){ chosen = x; used.add(x); break; }
      r -= w;
    }
    if(!chosen) break;
    out.push(chosen);
  }

  for(const card of out){
    card.tier = rollUpgradeTier(p.luck);
    card.mult = rollTierMult(card.tier);
    card.rarity = card.tier.key;
  }
  return out;
}
function renderLevelupCards(){
  const p = G.player;
  const root = document.getElementById('cards');
  root.innerHTML = '';
  for(const card of G.weaponPickPool){
    const el = document.createElement('div');
    const rarityClass = card.type === 'evolve' ? 'evo' : (card.rarity || 'common');
    el.className = 'card rarity-' + rarityClass + (card.type==='evolve'?' evo':'');
    let title = '', desc = '', tag='', color='#fff', statTable = '';
    const mult = card.mult || 1;
    if(card.type === 'weap_new'){
      const d = WEAPONS[card.key]; title = d.name; tag = 'NEW'; color = d.color;
      desc = `<span style="color:#9ab5d0">${d.desc}</span>`;
      statTable = renderStatTable(weaponNewRows(d));
    }
    else if(card.type === 'weap_up'){
      // Fusion weapons aren't in WEAPONS — fall back to the instance's own def.
      const w = p.weapons.find(w=>w.key===card.key);
      const d = WEAPONS[card.key] || w?.def;
      if(!d || !w){ continue; }  // defensive — skip malformed card
      title = d.name; tag = 'UP'; color = w.color || d.color;
      desc = `Lv.${w.level} → ${w.level+1}`;
      statTable = renderStatTable(weaponUpgradeRows(w, mult));
    }
    else if(card.type === 'pas'){
      const d = PASSIVES[card.key]; const curLv = (p.passives[card.key]||0); const lv = curLv + 1;
      title = d.name; tag = `Lv.${lv}/${d.maxLv}`; color = d.color;
      desc = `<span style="color:#9ab5d0">${d.desc}</span>`;
      statTable = renderStatTable(passivePreviewRows(card.key, mult, curLv, p));
    }
    else if(card.type === 'heal'){
      title = 'REPAIR'; tag='HEAL'; color=C.red;
      const heal = Math.round(p.maxHp * 0.5 * mult);
      desc = `HP +${heal} <span style="color:#7d96b4">(50%${mult!==1?` ×${mult.toFixed(2)}`:''})</span>`;
    }
    else if(card.type === 'gold'){
      title = 'CORE CACHE'; tag='GOLD'; color=C.gold;
      const amt = Math.round(10 * mult);
      desc = `+${amt} ◆${mult!==1?` <span style="color:#7d96b4">(×${mult.toFixed(2)})</span>`:''}`;
    }
    else if(card.type === 'evolve'){
      const e = card.evo; const w = p.weapons.find(w=>w.key===card.key);
      title = e.name; color = e.color; tag = '▲ EVO';
      const reqs = e.req.map(r => PASSIVES[r].name).join(' + ');
      desc = `${e.desc}<br><span style="color:#ffd96b">재료: ${reqs}</span><br><span style="color:#9eff5b">→ 무기 슬롯이 변형됩니다</span>`;
      if(w) statTable = renderStatTable(evolutionRows(w, e));
    }
    else if(card.type === 'item_pick'){
      const it = card.item;
      title = it.name; color = ITEM_TIERS[it.tier].color;
      tag = it.kind === 'relic' ? '◈ 유물' : '◇ 아이템';
      desc = `<span style="color:#cfeaff">${it.desc}</span><br><span style="color:#7d96b4">${it.kind === 'relic' ? '영구 효과' : '일회성 사용'}</span>`;
    }
    else if(card.type === 'fuse'){
      const f = card.fuse;
      title = f.name; color = f.color; tag = '★ FUSE';
      desc = `${f.desc}<br><span style="color:#ffd96b">재료: ${f.sourceA} + ${f.sourceB}</span><br><span style="color:#9eff5b">두 무기 흡수 → Lv.1 새 무기</span>`;
    }
    el.className = 'card rarity-' + rarityClass + (card.type==='evolve'?' evo':'') + (card.type==='fuse'?' fuse':'');
    let tierLabel;
    if(card.type === 'evolve') tierLabel = `<div class="tier-label" style="color:#00e5ff;text-shadow:0 0 14px rgba(0,229,255,.9)">▲ EVOLVE · 진화</div>`;
    else if(card.type === 'fuse') tierLabel = `<div class="tier-label" style="color:#ff3dcb;text-shadow:0 0 14px rgba(255,61,203,.9)">★ FUSE · 융합</div>`;
    else if(card.type === 'pas') tierLabel = `<div class="tier-label" style="color:${PASSIVES[card.key].color};text-shadow:0 0 10px ${PASSIVES[card.key].color}">◇ GATE · 진화 게이트</div>`;
    else if(card.tier) tierLabel = `<div class="tier-label" style="color:${card.tier.color};text-shadow:0 0 10px ${card.tier.glow}">${card.tier.label}${(card.mult && card.mult !== 1)?' · ×'+card.mult.toFixed(2):''}</div>`;
    else tierLabel = '';
    el.innerHTML = `<div class="tag">${tag}</div>
      <div class="ico"><canvas width="64" height="64" data-card="${G.weaponPickPool.indexOf(card)}"></canvas></div>
      <div class="name">${title}</div>
      ${tierLabel}
      <div class="desc">${desc}</div>
      ${statTable}`;
    el.addEventListener('click', ()=> applyLevelupCard(card));
    root.appendChild(el);
    const cv = el.querySelector('canvas');
    const cx = cv.getContext('2d');
    cx.translate(32, 32);
    if(card.type === 'item_pick'){
      const it = card.item;
      const tcol = ITEM_TIERS[it.tier].color;
      cx.strokeStyle = tcol; cx.shadowColor = tcol; cx.shadowBlur = 14; cx.lineWidth = 2.4;
      const isRelic = it.kind === 'relic';
      cx.beginPath();
      if(isRelic){
        for(let k=0;k<6;k++){
          const a = k*TAU/6 - Math.PI/2;
          const xx = Math.cos(a)*22, yy = Math.sin(a)*22;
          if(k===0) cx.moveTo(xx,yy); else cx.lineTo(xx,yy);
        }
      } else {
        cx.moveTo(0, -22); cx.lineTo(22, 0); cx.lineTo(0, 22); cx.lineTo(-22, 0);
      }
      cx.closePath(); cx.stroke();
      if(it.icon) it.icon(cx, 0, 0, 56);
    } else if(card.type === 'fuse'){
      const f = card.fuse;
      cx.strokeStyle = f.color; cx.shadowColor = f.color; cx.shadowBlur = 18; cx.lineWidth = 3;
      // 10-pt star outer
      cx.beginPath();
      for(let k=0;k<10;k++){
        const a = k*Math.PI/5 - Math.PI/2;
        const rr = k%2===0 ? 24 : 12;
        const xx = Math.cos(a)*rr, yy = Math.sin(a)*rr;
        if(k===0) cx.moveTo(xx,yy); else cx.lineTo(xx,yy);
      }
      cx.closePath(); cx.stroke();
      // small inner ring
      cx.lineWidth = 2;
      cx.beginPath(); cx.arc(0, 0, 6, 0, TAU); cx.stroke();
    } else if(card.type === 'weap_new' || card.type === 'weap_up'){
      // For fused weapons (only weap_up since you can't pick fused as 'new'),
      // use the instance's def — they aren't in the global WEAPONS table.
      const d = WEAPONS[card.key] || (card.type === 'weap_up' ? p.weapons.find(w=>w.key===card.key)?.def : null);
      if(d) withDrawCtx(cx, ()=> d.icon(cx, 0, 0, 64));
    } else if(card.type === 'evolve'){
      const d = WEAPONS[card.key]; cx.save(); cx.globalAlpha = .7; withDrawCtx(cx, ()=> d.icon(cx, 0, 0, 64)); cx.restore();
      cx.strokeStyle = card.evo.color; cx.shadowColor = card.evo.color; cx.shadowBlur = 18; cx.lineWidth = 3;
      cx.beginPath(); cx.moveTo(-14, 8); cx.lineTo(14, -8); cx.moveTo(6, -8); cx.lineTo(14, -8); cx.lineTo(14, 0); cx.stroke();
    } else if(card.type === 'pas'){
      const d = PASSIVES[card.key];
      cx.strokeStyle = d.color; cx.shadowColor = d.color; cx.shadowBlur = 16; cx.lineWidth = 3;
      cx.beginPath(); cx.arc(0, 0, 18, 0, TAU); cx.stroke();
      cx.shadowBlur = 8; cx.lineWidth = 2;
      cx.beginPath(); cx.arc(0, 0, 8, 0, TAU); cx.stroke();
    } else if(card.type === 'heal'){
      cx.fillStyle = C.red; cx.shadowColor = C.red; cx.shadowBlur = 14;
      cx.beginPath(); cx.moveTo(0,-12); cx.bezierCurveTo(-24,-30,-30,4,0,22); cx.bezierCurveTo(30,4,24,-30,0,-12); cx.fill();
    } else if(card.type === 'gold'){
      cx.fillStyle = C.gold; cx.shadowColor = C.gold; cx.shadowBlur = 14;
      cx.beginPath(); cx.moveTo(0,-16); cx.lineTo(16,0); cx.lineTo(0,16); cx.lineTo(-16,0); cx.fill();
    }
  }
}
function applyLevelupCard(card){
  const p = G.player;
  const mult = card.mult || 1;
  if(card.type === 'weap_new'){ addWeapon(p, card.key); }
  else if(card.type === 'weap_up'){ levelWeapon(p, card.key, mult); }
  else if(card.type === 'pas'){ addPassive(p, card.key, mult); }
  else if(card.type === 'evolve'){
    applyEvo(p, card.key, card.evo.id);
    // Heavy "milestone" feedback so the player feels the upgrade.
    const col = card.evo.color || C.cyan;
    flash(col, .55); shake(.5);
    fxBurst(p.x, p.y, col, 36, 320, 4, .8);
    fxRing(p.x, p.y, col, 140, .7);
    fxRing(p.x, p.y, '#ffffff', 200, .9);
    AUDIO.level();
    announce('▲ EVOLVE · ' + card.evo.name, 3);
  }
  else if(card.type === 'item_pick'){ applyItem(p, card.item.id); }
  else if(card.type === 'fuse'){
    applyFusion(p, card.fuseKey);
    const col = (card.fuse && card.fuse.color) || '#ff3dcb';
    flash(col, .65); shake(.7);
    fxBurst(p.x, p.y, col, 48, 380, 5, 1.0);
    fxRing(p.x, p.y, col, 180, .8);
    fxRing(p.x, p.y, '#ffffff', 260, 1.0);
    AUDIO.level();
    announce('★ FUSE · ' + (card.fuse?.name || 'WEAPON FUSED'), 3);
  }
  else if(card.type === 'heal'){ p.hp = Math.min(p.maxHp, p.hp + p.maxHp*.5 * mult); }
  else if(card.type === 'gold'){ const amt = Math.round(10 * mult); G.coinsRun += amt; meta.coins += amt; saveMeta(); }
  updateSynergies(p);
  document.getElementById('levelup-overlay').classList.add('hidden');
  G.mode = 'play';
  if(p.xp >= p.xpNext){ setTimeout(()=> doLevelUp(false), 80); }
}
/* Chest pick — opens the level-up overlay with 3 random RELIC cards (boss-only).
   Relics are gated to boss chests so they feel like a milestone. */
export function openChestPick(){
  const p = G.player; if(!p) return;
  const seen = new Set();
  const cards = [];
  for(let attempts = 0; attempts < 40 && cards.length < 3; attempts++){
    const it = pickRandomItem((p.luck||0) + .2, ['common','rare','legendary'], 'relic');
    if(it && !seen.has(it.id)){
      seen.add(it.id);
      cards.push({type:'item_pick', item:it, rarity: it.tier === 'legendary' ? 'legend' : it.tier});
    }
  }
  if(cards.length === 0) return;
  AUDIO.level();
  G.mode = 'levelup';
  // Reroll cost also resets here so chest rerolls don't carry from prior level-ups.
  G.rerollCost = 3;
  G.weaponPickPool = cards;
  document.getElementById('levelup-overlay').classList.remove('hidden');
  document.getElementById('reroll-cost').textContent = G.rerollCost;
  renderLevelupCards();
}

export function rerollLevelup(){
  if(meta.coins < G.rerollCost) return;
  meta.coins -= G.rerollCost; saveMeta();
  G.rerollCost = Math.ceil(G.rerollCost * 1.4);
  document.getElementById('reroll-cost').textContent = G.rerollCost;
  G.weaponPickPool = pickLevelupCards(G.player, 3);
  renderLevelupCards();
}
export function skipLevelup(){
  const p = G.player; p.hp = Math.min(p.maxHp, p.hp + 10);
  document.getElementById('levelup-overlay').classList.add('hidden');
  G.mode = 'play';
}

/* ===================================================================
   PROGRESSION GUIDE PANEL — right-side, always-visible.
   Two sections:
   - ▲ EVOLVE (cyan): per-weapon, what's needed for any of its 3 evo paths
   - ★ FUSE (magenta): per fusion pair, status of both sources
   Tooltips on each row explain requirements. Cursor:help signals info-only.
   =================================================================== */
let _fgT = 0;
function updateProgressionGuide(p){
  const root = document.getElementById('progression-guide');
  const evoList = document.getElementById('evo-list');
  const fuseList = document.getElementById('fuse-list');
  if(!root || !evoList || !fuseList) return;
  if(!p || !p.weapons || p.weapons.length === 0){ root.style.display = 'none'; return; }

  // ── EVOLVE rows: one per weapon, showing best-available evo path progress.
  const evoRows = [];
  for(const w of p.weapons){
    if(w.isFusion) continue;  // fusions can't re-evolve
    if(w.evolved){
      evoRows.push({ sortKey: 3, html:
        `<div class="pg-row evo locked" title="${w.def.name} — 이미 진화됨: ${w.evoName||''}">
          <div class="pg-name" style="color:${w.color||w.def.color}">${w.def.name} ✓</div>
          <div class="pg-meta">진화 완료: ${w.evoName||'(이름 없음)'}</div>
        </div>` });
      continue;
    }
    const list = EVOLUTIONS[w.key];
    if(!list || list.length === 0) continue;
    const maxLv = w.def.maxLv;
    const atMax = w.level >= maxLv;
    // Find best path (most reqs met)
    let bestPath = list[0]; let bestMet = -1;
    for(const path of list){
      const met = path.req.filter(pk => (p.passives[pk]||0) >= PASSIVES[pk].maxLv).length;
      if(met > bestMet){ bestMet = met; bestPath = path; }
    }
    const allReqsMet = bestPath.req.every(pk => (p.passives[pk]||0) >= PASSIVES[pk].maxLv);
    const ready = atMax && allReqsMet;
    const reqStr = bestPath.req.map(pk => {
      const cur = p.passives[pk] || 0;
      const max = PASSIVES[pk].maxLv;
      return cur >= max ? `<span class="ok">${pk}✓</span>` : `<span class="need">${pk}${cur}/${max}</span>`;
    }).join('+');
    const lvStr = atMax ? `<span class="ok">Lv.${maxLv}✓</span>` : `<span class="lvl">Lv.${w.level}/${maxLv}</span>`;
    const cls = ready ? 'ready' : ((atMax || allReqsMet) ? 'partial' : 'locked');
    const sortKey = ready ? 0 : (atMax ? 1 : (allReqsMet ? 1 : 2));
    const tip = `${w.def.name} → ${bestPath.name}\n조건: 무기 ${maxLv}렙 + ${bestPath.req.join('+')} 만렙`;
    evoRows.push({ sortKey, html:
      `<div class="pg-row evo ${cls}" title="${tip.replace(/"/g,'&quot;')}">
        <div class="pg-name" style="color:${w.def.color}">${w.def.name} → ${bestPath.name}</div>
        <div class="pg-meta">${lvStr} · ${reqStr}</div>
      </div>` });
  }

  // ── FUSE rows: one per fusion pair, only if at least one source weapon owned.
  const wmap = new Map(p.weapons.map(w => [w.key, w]));
  const fuseRows = [];
  for(const fk in FUSIONS){
    const f = FUSIONS[fk];
    const a = wmap.get(f.sourceA), b = wmap.get(f.sourceB);
    const hasA = !!a, hasB = !!b;
    if(!hasA && !hasB) continue;
    const evoA = hasA && a.evolved, evoB = hasB && b.evolved;
    const maxA = hasA && a.level >= a.def.maxLv, maxB = hasB && b.level >= b.def.maxLv;
    const ready = evoA && evoB && maxA && maxB;
    const both = hasA && hasB;
    const cls = ready ? 'ready' : (both ? 'partial' : 'locked');
    const sortKey = ready ? 0 : (both ? 1 : 2);
    const stat = (key, has, evo, max, w) => {
      if(!has) return `<span class="miss">${key}없음</span>`;
      if(!max) return `<span class="lvl">${key}${w.level}/${w.def.maxLv}</span>`;
      if(!evo) return `<span class="need">${key}진화필요</span>`;
      return `<span class="ok">${key}✓</span>`;
    };
    const tip = `${f.name} = ${f.sourceA} + ${f.sourceB}\n조건: 둘 다 만렙+진화 → 새 무기 Lv.1로 융합`;
    fuseRows.push({ sortKey, html:
      `<div class="pg-row fuse ${cls}" title="${tip.replace(/"/g,'&quot;')}">
        <div class="pg-name" style="color:${f.color}">${f.name}</div>
        <div class="pg-meta">${stat(f.sourceA, hasA, evoA, maxA, a)} + ${stat(f.sourceB, hasB, evoB, maxB, b)}</div>
      </div>` });
  }

  if(evoRows.length === 0 && fuseRows.length === 0){ root.style.display = 'none'; return; }
  evoRows.sort((x,y)=>x.sortKey - y.sortKey);
  fuseRows.sort((x,y)=>x.sortKey - y.sortKey);
  evoList.innerHTML = evoRows.length ? evoRows.map(r=>r.html).join('') : '<div style="color:#5d7290;font-size:9px">무기 보유 시 표시</div>';
  fuseList.innerHTML = fuseRows.length ? fuseRows.map(r=>r.html).join('') : '<div style="color:#5d7290;font-size:9px">2개 이상 무기 보유 시 표시</div>';
  root.style.display = 'block';
}

/* ===================================================================
   HUD UPDATE
   =================================================================== */
export function updateHUD(){
  const p = G.player; if(!p) return;
  setBar('hp-bar', (p.hp / p.maxHp) * 100);
  document.getElementById('hp-text').textContent = `${Math.ceil(p.hp)} / ${p.maxHp|0}`;
  setBar('xp-bar', (p.xp / p.xpNext) * 100);
  document.getElementById('lv-chip').textContent = `LV ${p.level}`;
  document.getElementById('timer').textContent = fmtTime(G.t);
  document.getElementById('kill-chip').textContent = `KILLS ${G.killCount}`;
  document.getElementById('coin-chip').textContent = `◆ ${G.coinsRun}`;
  const ws = document.getElementById('weapon-slots');
  if(ws.children.length !== p.weapons.length){
    ws.innerHTML = '';
    for(const w of p.weapons){
      const el = document.createElement('div'); el.className = 'slot';
      el.innerHTML = `<canvas width="48" height="48"></canvas><div class="lv">${w.level}</div>`;
      ws.appendChild(el);
      const cv = el.querySelector('canvas'); const cx = cv.getContext('2d');
      cx.translate(24,24);
      withDrawCtx(cx, ()=> w.def.icon(cx, 0, 0, 48));
    }
  } else {
    for(let i=0;i<p.weapons.length;i++){
      ws.children[i].querySelector('.lv').textContent = p.weapons[i].level;
    }
  }
  const ps = document.getElementById('passive-slots');
  const pkeys = Object.keys(p.passives);
  if(ps.children.length !== pkeys.length){
    ps.innerHTML = '';
    for(const k of pkeys){
      const el = document.createElement('div'); el.className = 'slot passive';
      el.innerHTML = `<canvas width="48" height="48"></canvas><div class="lv">${p.passives[k]}</div>`;
      ps.appendChild(el);
      const cv = el.querySelector('canvas'); const cx = cv.getContext('2d');
      cx.translate(24,24);
      const d = PASSIVES[k];
      cx.strokeStyle = d.color; cx.fillStyle = 'rgba(0,0,0,0)';
      cx.shadowColor = d.color; cx.shadowBlur = 12; cx.lineWidth = 2.4;
      cx.beginPath(); cx.arc(0,0,12,0,TAU); cx.stroke();
    }
  } else {
    let i=0;
    for(const k of pkeys){
      ps.children[i].querySelector('.lv').textContent = p.passives[k];
      i++;
    }
  }
  if(G.bossActive){
    const b = G.bossActive;
    setBar('boss-hp-bar', (b.hp/b.maxHp)*100);
  }
  const ce = document.getElementById('combo');
  if(G.combo > 4){
    ce.textContent = `×${G.combo} COMBO`;
    ce.classList.add('show');
  } else { ce.classList.remove('show'); }
  // Progression guide panel — right-side, always-visible during play. Throttled
  // since state only changes on level-up / evolve, not per frame.
  if(!_fgT || G.realT - _fgT > 0.4){
    _fgT = G.realT;
    updateProgressionGuide(p);
  }
  // Relic inventory row — small icons with hover tooltips.
  const rs = document.getElementById('relic-slots');
  const relics = p.relics || [];
  if(rs.children.length !== relics.length){
    rs.innerHTML = '';
    for(const id of relics){
      const it = ITEMS[id]; if(!it) continue;
      const tierCol = ITEM_TIERS[it.tier].color;
      const el = document.createElement('div'); el.className = 'slot relic';
      el.innerHTML = `<canvas width="48" height="48"></canvas><div class="ttip">${it.name} · <span style="color:#9ab5d0">${it.desc}</span></div>`;
      rs.appendChild(el);
      const cv = el.querySelector('canvas'); const cx = cv.getContext('2d');
      cx.translate(24,24);
      // Hex tier shell
      cx.strokeStyle = tierCol; cx.shadowColor = tierCol; cx.shadowBlur = 8; cx.lineWidth = 1.8;
      cx.beginPath();
      for(let k=0;k<6;k++){
        const a = k * TAU/6 - Math.PI/2;
        const xx = Math.cos(a)*16, yy = Math.sin(a)*16;
        if(k===0) cx.moveTo(xx,yy); else cx.lineTo(xx,yy);
      }
      cx.closePath(); cx.stroke();
      // Per-item glyph
      if(it.icon) it.icon(cx, 0, 0, 48);
    }
  }
}

/* ===================================================================
   RUN LIFECYCLE
   =================================================================== */
export function startRun(classKey){
  clearAllWorldSprites();
  G.ents = []; G.t = 0; G.spawnTimer = 0; G.combo=0; G.comboTimer=0;
  G.killCount = 0; G.coinsRun = 0; G.bossActive=null; G.bossTimer = 0; G.bossCount = 0;
  G.endReason = null; G.rerollCost = 3;
  G.classChosen = classKey;
  G.cam = {x:0, y:0, zoom:1, tx:0, ty:0};
  G.shake = 0; G.flash = 0;
  G.superMagnetTimer = 0; G.freezeTimer = 0;
  G.mode = 'play';
  spawnPlayer(classKey);
  AUDIO.init().then(()=> AUDIO.setMode('main'));
  meta.runs++;
  saveMeta();
  closeOverlay('menu-overlay'); closeOverlay('class-overlay');
  document.getElementById('menu-runs').textContent = meta.runs;
  announce('SURVIVE 15:00', 1.6);
}
export function endRun(victory){
  if(G.mode === 'end') return;
  G.mode = 'end';
  G.endReason = victory ? 'victory' : 'death';
  document.getElementById('end-overlay').classList.remove('hidden');
  document.getElementById('end-title').textContent = victory ? 'YOU SURVIVED' : 'CORE OFFLINE';
  document.getElementById('end-text').textContent = victory ? '시스템 안정화. 금고에 코어 적립.' : '벡터가 붕괴되었습니다.';
  const stats = document.getElementById('end-stats');
  stats.innerHTML = `
    <span>TIME</span><b>${fmtTime(G.t)}</b>
    <span>KILLS</span><b>${G.killCount}</b>
    <span>LEVEL</span><b>${G.player ? G.player.level : 1}</b>
    <span>CORES</span><b>◆ ${G.coinsRun}</b>
    <span>VECTOR</span><b>${G.classChosen}</b>
  `;
  if(G.t > meta.bestTime){ meta.bestTime = G.t|0; }
  meta.kills += G.killCount;
  if(victory){ meta.wins++; }
  unlockMilestones();
  saveMeta();
  document.getElementById('menu-coins').textContent = meta.coins;
  document.getElementById('menu-best').textContent = fmtTime(meta.bestTime);
  AUDIO.setMode(victory ? 'victory' : 'death');
}
function unlockMilestones(){
  const order = ['CIRCLE','TRIANGLE','HEXAGON','SQUARE','STAR'];
  for(const k of order){
    const need = CLASSES[k].unlock;
    if(meta.coins >= need && !meta.unlocked.includes(k)){
      meta.unlocked.push(k);
      announce('UNLOCKED ' + k, 2);
    }
  }
}
export function returnToMenu(){
  closeOverlay('end-overlay');
  showMenu();
}
export function restartRun(){
  closeOverlay('end-overlay');
  startRun(G.classChosen);
}
export function showMenu(){
  G.mode = 'menu';
  document.getElementById('menu-overlay').classList.remove('hidden');
  document.getElementById('menu-coins').textContent = meta.coins;
  document.getElementById('menu-best').textContent = fmtTime(meta.bestTime);
  document.getElementById('menu-runs').textContent = meta.runs;
  AUDIO.init().then(()=> AUDIO.setMode('menu'));
}
export function closeOverlay(id){ document.getElementById(id).classList.add('hidden'); }
export function togglePause(){
  if(G.mode === 'play'){
    G.mode = 'pause';
    document.getElementById('pause-overlay').classList.remove('hidden');
    const p = G.player; if(!p) return;
    let html = `<div><b>VECTOR:</b> ${G.classChosen} · LV ${p.level} · ${fmtTime(G.t)}</div>`;
    html += '<div style="margin-top:8px;color:#9ab5d0;font-weight:700">WEAPONS</div>';
    for(const w of p.weapons){
      const tag = w.evolved ? ` <span style="color:#ff2bd6">▲ ${w.evoName||''}</span>` : '';
      html += `<div>· ${w.def.name} <span style="color:${w.color||w.def.color}">Lv.${w.level}</span>${tag}</div>`;
    }
    html += '<div style="margin-top:8px;color:#9ab5d0;font-weight:700">PASSIVES</div>';
    for(const k in p.passives) html += `<div>· ${PASSIVES[k].name} <span style="color:${PASSIVES[k].color}">Lv.${p.passives[k]}</span></div>`;
    if(Object.keys(p.passives).length===0) html += '<div style="color:#5d7290">(없음)</div>';
    // Relics — permanent pickups
    html += '<div style="margin-top:8px;color:#9ab5d0;font-weight:700">RELICS</div>';
    const relics = p.relics || [];
    if(relics.length === 0){
      html += '<div style="color:#5d7290">(없음)</div>';
    } else {
      for(const id of relics){
        const it = ITEMS[id]; if(!it) continue;
        const col = ITEM_TIERS[it.tier].color;
        html += `<div>· <span style="color:${col}">${it.name}</span> <span style="color:#7d96b4">— ${it.desc}</span></div>`;
      }
    }
    // Active consumable boost timers
    const activeBoosts = [];
    if(p._boostSpd > 0) activeBoosts.push(`⚡ 이동가속 ${p._boostSpd.toFixed(1)}s`);
    if(p._boostCdr > 0) activeBoosts.push(`⏱ 쿨감 ${p._boostCdr.toFixed(1)}s`);
    if(p._boostDmg > 0) activeBoosts.push(`✦ 데미지 ${p._boostDmg.toFixed(1)}s`);
    if(p._boostInvuln > 0) activeBoosts.push(`🛡 무적 ${p._boostInvuln.toFixed(1)}s`);
    if(activeBoosts.length){
      html += '<div style="margin-top:8px;color:#9ab5d0;font-weight:700">ACTIVE</div>';
      for(const b of activeBoosts) html += `<div style="color:#ffd400">· ${b}</div>`;
    }
    // FUSION guide moved out of pause — it's always visible on the right side
    // during play (#fusion-guide). Pause stays focused on player-state info.
    document.getElementById('pause-info').innerHTML = html;
  } else if(G.mode === 'pause'){
    G.mode = 'play';
    closeOverlay('pause-overlay');
  }
}
export function toggleMute(){
  AUDIO.setMuted(!AUDIO.isMuted());
  document.getElementById('mute-btn').textContent = AUDIO.isMuted() ? '×' : '♪';
}
export function confirmAbandon(){
  if(confirm('이 런을 포기합니다.')){
    closeOverlay('pause-overlay');
    endRun(false);
  }
}

/* ===================================================================
   CLASS PICKER UI
   =================================================================== */
export function openClassPicker(){
  closeOverlay('menu-overlay');
  document.getElementById('class-overlay').classList.remove('hidden');
  buildClassPicker();
}
function buildClassPicker(){
  const grid = document.getElementById('class-grid');
  grid.innerHTML = '';
  for(const k in CLASSES){
    const cl = CLASSES[k];
    const locked = !meta.unlocked.includes(k);
    const el = document.createElement('div');
    el.className = 'class-card' + (locked ? ' locked' : '');
    el.innerHTML = `<canvas width="80" height="80"></canvas>
      <div class="cname">${cl.name}</div>
      <div class="cdesc">${cl.desc}</div>
      <div class="cstart">${locked ? '◆ ' + cl.unlock + ' 필요' : 'START: ' + WEAPONS[cl.startWeap].name}</div>`;
    grid.appendChild(el);
    const cv = el.querySelector('canvas'); const cx = cv.getContext('2d');
    cx.translate(40,40);
    cx.shadowBlur = 18; cx.shadowColor = cl.color;
    if(cl.sides === 0){
      cx.beginPath(); cx.arc(0,0,22,0,TAU); cx.strokeStyle = cl.color; cx.lineWidth=3; cx.stroke();
      cx.beginPath(); cx.arc(0,0,8,0,TAU); cx.fillStyle = cl.color; cx.fill();
    } else {
      cx.beginPath();
      for(let i=0;i<cl.sides;i++){
        const a = i*TAU/cl.sides - Math.PI/2;
        const x = Math.cos(a)*24, y = Math.sin(a)*24;
        if(i===0) cx.moveTo(x,y); else cx.lineTo(x,y);
      }
      cx.closePath(); cx.strokeStyle = cl.color; cx.lineWidth=3; cx.stroke();
    }
    if(!locked) el.addEventListener('click', ()=> startRun(k));
  }
}

/* ===================================================================
   SHOP
   =================================================================== */
function buildShop(){
  document.getElementById('shop-coins').textContent = meta.coins;
  const grid = document.getElementById('shop-grid');
  grid.innerHTML = '';
  for(const it of SHOP_ITEMS){
    const lv = meta.shop[it.key]||0;
    const max = it.max;
    const cost = lv >= max ? null : it.costFn(lv);
    const el = document.createElement('div'); el.className = 'shop-card' + (lv>=max ? ' maxed' : '');
    let pips = '';
    for(let i=0;i<max;i++) pips += `<span class="pip ${i<lv?'on':''}"></span>`;
    el.innerHTML = `<div class="sn">${it.name}</div><div class="sd">${it.desc}</div><div>${pips}</div><div class="sp">${cost==null?'MAX':'◆ '+cost}</div>`;
    if(cost!=null) el.addEventListener('click', ()=>{
      if(meta.coins >= cost){
        meta.coins -= cost; meta.shop[it.key] = lv+1; saveMeta();
        buildShop();
        document.getElementById('menu-coins').textContent = meta.coins;
      }
    });
    grid.appendChild(el);
  }
}
export function openShop(){ closeOverlay('menu-overlay'); document.getElementById('shop-overlay').classList.remove('hidden'); buildShop(); }

/* ===================================================================
   CODEX
   =================================================================== */
function buildCodex(){
  const root = document.getElementById('codex-content');
  let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">';
  html += '<div><div style="color:#fff;font-weight:900;letter-spacing:.2em;margin-bottom:6px">WEAPONS</div>';
  for(const k in WEAPONS){
    const seen = meta.seenCodex.weapons.includes(k);
    const d = WEAPONS[k];
    html += `<div style="padding:6px;border-bottom:1px solid #1c2a4a;color:${seen?d.color:'#5d7290'}"><b>${seen?d.name:'???'}</b> · <span style="color:#9ab5d0">${seen?d.desc:'미해금'}</span></div>`;
  }
  html += '</div><div><div style="color:#fff;font-weight:900;letter-spacing:.2em;margin-bottom:6px">PASSIVES</div>';
  for(const k in PASSIVES){
    const seen = meta.seenCodex.passives.includes(k);
    const d = PASSIVES[k];
    html += `<div style="padding:6px;border-bottom:1px solid #1c2a4a;color:${seen?d.color:'#5d7290'}"><b>${seen?d.name:'???'}</b> · <span style="color:#9ab5d0">${seen?d.desc:'미해금'}</span></div>`;
  }
  html += '</div></div>';
  html += '<div style="color:#fff;font-weight:900;letter-spacing:.2em;margin-top:14px;margin-bottom:6px">★ FUSIONS — 두 무기를 모두 진화 + 만렙 시 융합 가능</div>';
  for(const fk in FUSIONS){
    const f = FUSIONS[fk];
    html += `<div style="padding:6px;border-bottom:1px solid #1c2a4a;color:${f.color}">· <b>${f.name}</b> <span style="color:#9ab5d0">= ${f.sourceA} + ${f.sourceB} — ${f.desc}</span></div>`;
  }
  html += '<div style="color:#fff;font-weight:900;letter-spacing:.2em;margin-top:14px;margin-bottom:6px">ENEMIES</div>';
  for(const k in ENEMIES){
    const d = ENEMIES[k];
    html += `<div style="padding:6px;border-bottom:1px solid #1c2a4a;color:${d.color}">· ${k} <span style="color:#9ab5d0">${d.brain} · HP ${d.hp} · DMG ${d.dmg}</span></div>`;
  }
  root.innerHTML = html;
}
export function openCodex(){ closeOverlay('menu-overlay'); document.getElementById('codex-overlay').classList.remove('hidden'); buildCodex(); }

// Wire player.js so applyItem (consumable forced level-up) and damagePlayer (death) can invoke us.
setUiHandlers({ doLevelUp, endRun });
