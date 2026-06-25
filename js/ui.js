/* ===================================================================
   UI — DOM-side rendering (HUD, level-up cards, menus, shop, codex,
   pause/end overlays) and run lifecycle (startRun/endRun).
   =================================================================== */
import {
  G, C, fmtTime, meta, saveMeta,
  setBar, announce,
} from './core.js';
import { AUDIO } from './audio.js?v=abyssal-audio-v4';
import {
  shake, flash, clearAllWorldSprites, fxBurst, fxRing, fxRuneCircle,
} from './entities.js';
import {
  CLASSES, PASSIVES, ENEMIES, UPGRADE_TIERS, SHOP_ITEMS,
  ITEMS, ITEM_TIERS, GLYPHS,
  CHIPS, CHIP_TIERS, CHIP_PULL_COST, CHIP_PULL10_COST, CHIP_SLOT_COSTS, CHIP_DEFAULT_SLOTS,
  rollChip,
  SHRINES, rollShrineCards, shrineCost,
  rollUpgradeTier, rollTierMult,
} from './data.js';
import { WEAPONS, EVOLUTIONS, FUSIONS } from './weapons.js';
import {
  spawnPlayer, addWeapon, levelWeapon, addPassive, applyEvo, weaponEvoReady,
  updateSynergies, applyItem, applyGlyph, pickRandomItem,
  fusionsAvailable, applyFusion, setUiHandlers,
} from './player.js';

const CLASS_ART = {
  CIRCLE:'assets/sprites/classes/rift-warden.png',
  TRIANGLE:'assets/sprites/classes/blood-seer.png',
  HEXAGON:'assets/sprites/classes/grave-bulwark.png',
  SQUARE:'assets/sprites/classes/iron-exile.png',
  STAR:'assets/sprites/classes/hex-witch.png',
};
const SETTINGS = [
  { key:'reduceFlash',  name:'REDUCE FLASH',  desc:'섬광과 파티클 밀도를 낮춥니다.' },
  { key:'reduceShake',  name:'REDUCE SHAKE',  desc:'카메라 흔들림을 약하게 합니다.' },
  { key:'autoQuality',  name:'AUTO QUALITY',  desc:'프레임 저하 시 효과 밀도를 자동 조절합니다.' },
  { key:'highContrast', name:'HIGH CONTRAST', desc:'작은 UI 텍스트 대비를 높입니다.' },
];
const CODEX_TABS = [
  { key:'skills', label:'SKILLS' },
  { key:'virtues', label:'VIRTUES' },
  { key:'awaken', label:'AWAKEN' },
  { key:'runes', label:'RUNES' },
  { key:'enemies', label:'ENEMIES' },
];
let _codexTab = 'skills';
const SKILL_ART = {
  PULSE:'assets/icons/skills/sanctified-nova.png',
  BEAM:'assets/icons/skills/seraph-lance.png',
  ORBIT:'assets/icons/skills/runic-aegis.png',
  HOMING:'assets/icons/skills/bone-shards.png',
  CROSS:'assets/icons/skills/hellfire-cross.png',
  SHOCK:'assets/icons/skills/grave-cleave.png',
  CHAIN:'assets/icons/skills/hex-lightning.png',
  BLADE:'assets/icons/skills/spectral-blades.png',
  BLACKHOLE:'assets/icons/skills/abyss-well.png',
  PRISM:'assets/icons/skills/soul-prism.png',
};
const STAT_ICON_CLASS = { dmg:'wrath', area:'dominion', cd:'zeal', speed:'fleet', hp:'vitality' };
function _escAttr(s){ return String(s || '').replace(/"/g, '&quot;'); }
if(!window.__replaceBrokenIcon){
  window.__replaceBrokenIcon = img => {
    const kind = img.dataset.fallbackKind || 'generic';
    const color = img.dataset.fallbackColor || '#d8c7a1';
    const node = document.createElement('div');
    node.className = `rune-icon rune-${kind}`;
    node.style.setProperty('--accent', color);
    node.setAttribute('aria-label', img.getAttribute('alt') || '');
    node.innerHTML = '<span></span>';
    img.replaceWith(node);
  };
}
function imgIcon(src, alt='', cls='ui-art-img', fallbackKind='generic', fallbackColor='#d8c7a1'){
  return `<img class="${_escAttr(cls)}" src="${_escAttr(src)}" alt="${_escAttr(alt)}" draggable="false" data-fallback-kind="${_escAttr(fallbackKind)}" data-fallback-color="${_escAttr(fallbackColor)}" onerror="window.__replaceBrokenIcon&&window.__replaceBrokenIcon(this)">`;
}
function runeIcon(kind, color, label=''){
  return `<div class="rune-icon rune-${kind || 'generic'}" style="--accent:${color || '#d8c7a1'}" aria-label="${_escAttr(label)}"><span></span></div>`;
}
function skillIconSrc(key){ return SKILL_ART[key] || null; }
function weaponIconHtml(key, label=''){
  const src = skillIconSrc(key);
  return src ? imgIcon(src, label, 'ui-art-img skill-art-img', 'skill', '#d8c7a1') : runeIcon('skill', '#d8c7a1', label);
}
function cardIconHtml(card, p, color, title){
  if(card.type === 'weap_new' || card.type === 'weap_up' || card.type === 'evolve'){
    return weaponIconHtml(card.key, title);
  }
  if(card.type === 'pas') return runeIcon('virtue-' + card.key.toLowerCase(), color, title);
  if(card.type === 'item_pick'){
    const kind = card.item.kind === 'relic' ? 'relic' : 'loot';
    return runeIcon(kind + '-' + card.item.tier, color, title);
  }
  if(card.type === 'glyph_pick') return runeIcon('glyph', color, title);
  if(card.type === 'shrine_pick') return runeIcon('altar', color, title);
  if(card.type === 'fuse') return runeIcon('awaken', color, title);
  if(card.type === 'heal') return runeIcon('blood', C.red, title);
  if(card.type === 'gold') return runeIcon('coffer', C.gold, title);
  if(card.type === 'stat_up') return runeIcon('stat-' + (STAT_ICON_CLASS[card.stat] || 'generic'), color, title);
  return runeIcon('generic', color, title);
}
function slotWeaponIcon(w){ return weaponIconHtml(w.key, w.def.name); }
function weaponSlotSignature(w){
  return [w.key, w.level, w.evolved ? '1' : '0', w.evoName || '', w.color || w.def.color || ''].join('|');
}
function renderWeaponSlot(el, w){
  el.className = 'slot' + (w.evolved ? ' evolved' : '');
  el.dataset.sig = weaponSlotSignature(w);
  el.title = w.evolved ? `${w.def.name} → ${w.evoName || 'AWAKENED'}` : w.def.name;
  el.innerHTML = `${slotWeaponIcon(w)}<div class="lv">${w.level}</div>${w.evolved ? '<div class="evo-mark">▲</div>' : ''}`;
}
function slotPassiveIcon(key){
  const d = PASSIVES[key];
  return runeIcon('virtue-' + key.toLowerCase(), d?.color || C.gold, d?.name || key);
}
function slotRelicIcon(item){
  const tier = ITEM_TIERS[item.tier];
  return runeIcon('relic-' + item.tier, tier?.color || C.gold, item.name);
}
function syncSettingsClasses(){
  document.body.classList.toggle('high-contrast', !!meta.settings?.highContrast);
}
function renderBuffTimers(p){
  const root = document.getElementById('buff-timers');
  if(!root) return;
  const buffs = [];
  const add = (name, time, color) => {
    if(time > 0) buffs.push({ name, time, color });
  };
  add('WRATH', p._boostDmg || 0, C.red);
  add('ZEAL', p._boostCdr || 0, C.gold);
  add('FLEET', p._boostSpd || 0, C.cyan);
  add('AEGIS', p._boostInvuln || 0, C.violet);
  add('MAGNET', G.superMagnetTimer || 0, C.pink);
  add('FREEZE', G.freezeTimer || 0, C.teal);
  add('STREAK', p._streakActive || 0, C.gold);
  if(!buffs.length){ root.innerHTML = ''; return; }
  root.innerHTML = buffs.slice(0, 6).map(b =>
    `<div class="buff-pill" style="--accent:${b.color}">${b.name}<span>${Math.max(0, b.time).toFixed(1)}</span></div>`
  ).join('');
}

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
function fmtPct(v){ return `${fmtVal(v)}%`; }
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
    const m = mult || 1;
    switch(passiveKey){
      case 'POWER':   return `DMG +${fmtPct(12 * m)}`;
      case 'HASTE':   return `이동 +${fmtPct(9 * m)}`;
      case 'CADENCE': return `쿨감 +${fmtPct(9 * m)}`;
      case 'REACH':   return `범위 +${fmtPct(12 * m)}`;
      case 'ARMOR':   return `DR +${fmtPct(6 * m)}`;
      case 'SOUL':    return `HP +${fmtVal(18 * m)}, 재생 +${fmtVal(.4 * m)}/s`;
      case 'MAGNET':  return `픽업 +${fmtPct(30 * m)}`;
      case 'LUCK':    return `희귀 +${fmtPct(9 * m)}`;
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
    rows.push({ key:'RUNE', text:'<span style="color:#7d96b4">관련 스킬 미보유</span>' });
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

function baseRerollCost(){
  return Math.max(0, 3 - (meta.shop.reroll || 0));
}
function resetRerollCost(){
  G.rerollCost = baseRerollCost();
  document.getElementById('reroll-cost').textContent = G.rerollCost;
}
function nextRerollCost(cost){
  return cost <= 0 ? 1 : Math.ceil(cost * 1.4);
}

/* ===================================================================
   LEVEL UP / CARD CHOOSER
   =================================================================== */
export function doLevelUp(forceNoXpReset=false){
  const p = G.player;
  if(!forceNoXpReset && p.xp >= p.xpNext){
    p.xp -= p.xpNext;
    p.level++;
    // Steeper curve + higher cap. Previous (×1.30, cap 250 at L13) plateaued
    // too early — by 4-5min the player was leveling every few seconds, drowning
    // the run in modal pop-ups and freezing combat flow. New curve keeps growing
    // through L18 so late-game pacing feels like 1 level / 30~90s instead of
    // multiple per minute.
    // L1=3, L5=24, L10=126, L13=318, L15=584, L16=790, L17=900(cap).
    p.xpNext = Math.min(Math.round(p.xpNext * 1.35 + 2), 900);
  }
  AUDIO.level();
  shake(.1); flash('#fff', .25);
  G.mode = 'levelup';
  // Reroll cost resets every level-up from the current DIVINATION discount.
  // Within one screen rerolls still compound, so upgraded free starts don't loop.
  G.weaponPickPool = pickLevelupCards(p, 3);
  document.getElementById('levelup-overlay').classList.remove('hidden');
  resetRerollCost();
  renderLevelupCards();
}
// Permanent stat-up cards — only injected late-game when the regular pool dries
// up (all weapons maxed + all passives maxed). Without these, late-run level-ups
// served only heal/gold (the dead-card bug from the balance audit). Now players
// keep growing past the content cap, but the +%/level is small (5-12% scaled by
// rarity) so it doesn't trivialize the mid-game weapon/passive picks.
const STAT_UPS = {
  dmg:   { label:'+ WRATH',   tag:'STAT', color:C.red,    desc:'전 스킬 데미지 영구 +5%',
           apply:(p,m)=>{ p.dmgMul *= (1 + .05*m); } },
  area:  { label:'+ DOMINION',tag:'STAT', color:C.violet, desc:'효과 범위 영구 +5%',
           apply:(p,m)=>{ p.areaMul *= (1 + .05*m); } },
  cd:    { label:'+ ZEAL',    tag:'STAT', color:C.gold,   desc:'발사 속도 영구 +5%',
           apply:(p,m)=>{ p.cdMul *= (1 + .05*m); } },
  speed: { label:'+ FLEET',   tag:'STAT', color:C.cyan,   desc:'이동 속도 영구 +4%',
           apply:(p,m)=>{ p.speed *= (1 + .04*m); } },
  hp:    { label:'+ VITALITY',tag:'STAT', color:C.lime,   desc:'최대 HP 영구 +15, 회복',
           apply:(p,m)=>{ const inc = Math.round(15*m); p.maxHp += inc; p.hp = Math.min(p.maxHp, p.hp + inc); } },
};
function pickLevelupCards(p, n=3){
  // Evolutions and fusions auto-trigger from gameloop._autoEvoFuse — no longer
  // surfaced as level-up cards. Cards offer weap_new / weap_up / pas / heal /
  // gold / stat_up.
  const pool = [];
  for(const w of p.weapons){
    if(w.level < w.def.maxLv){
      pool.push({type:'weap_up', key:w.key, weight: 6});
    }
  }
  const weapCap = 6 + (p._weaponSlotBonus || 0);
  if(p.weapons.length < weapCap){
    for(const k in WEAPONS){
      if(p.weapons.find(w=>w.key===k)) continue;
      // Skip weapons that were consumed by a previous fusion — re-offering
      // them feels broken since the player intentionally "spent" them.
      if(p._fusedSources && p._fusedSources.has(k)) continue;
      pool.push({type:'weap_new', key:k, weight: 5});
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
  // Late-game injection: when regular content is exhausted, surface permanent
  // stat-ups so picks remain meaningful past the content cap.
  const allWeapMax = p.weapons.length >= 6 && p.weapons.every(w => w.level >= w.def.maxLv);
  const allPasMax = Object.keys(PASSIVES).every(k => (p.passives[k]||0) >= PASSIVES[k].maxLv);
  const lateGame = allWeapMax && allPasMax;
  const partialLate = !lateGame && (allWeapMax || allPasMax);
  if(lateGame){
    for(const k in STAT_UPS) pool.push({type:'stat_up', stat:k, weight:10});
  } else if(partialLate){
    for(const k in STAT_UPS) pool.push({type:'stat_up', stat:k, weight:3});
  }

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

  // GOLDEN PROMISE shrine: next level-up's cards are all guaranteed LEGEND tier.
  // One-shot — flag clears after fulfilment.
  const forceLegend = p._guaranteeLegend;
  if(forceLegend) p._guaranteeLegend = false;
  for(const card of out){
    if(forceLegend){
      card.tier = UPGRADE_TIERS.legend;
      card.mult = rollTierMult(card.tier);
      card.rarity = 'legend';
    } else {
      card.tier = rollUpgradeTier(p.luck);
      card.mult = rollTierMult(card.tier);
      card.rarity = card.tier.key;
    }
  }
  return out;
}
function renderLevelupCards(){
  const p = G.player;
  const root = document.getElementById('cards');
  G._levelupChoosing = false;
  root.innerHTML = '';
  root.scrollLeft = 0;
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
      title = 'BLOOD REST'; tag='HEAL'; color=C.red;
      const heal = Math.round(p.maxHp * 0.5 * mult);
      desc = `HP +${heal} <span style="color:#7d96b4">(50%${mult!==1?` ×${mult.toFixed(2)}`:''})</span>`;
    }
    else if(card.type === 'stat_up'){
      const su = STAT_UPS[card.stat];
      title = su.label; tag = su.tag; color = su.color;
      desc = `<span style="color:#cfeaff">${su.desc}${mult!==1?` <span style="color:#9eff5b">×${mult.toFixed(2)}</span>`:''}</span>`;
    }
    else if(card.type === 'gold'){
      title = 'COFFER OF CORES'; tag='GOLD'; color=C.gold;
      const amt = Math.round(10 * mult);
      desc = `+${amt} ◆${mult!==1?` <span style="color:#7d96b4">(×${mult.toFixed(2)})</span>`:''}`;
    }
    else if(card.type === 'evolve'){
      const e = card.evo; const w = p.weapons.find(w=>w.key===card.key);
      title = e.name; color = e.color; tag = '▲ RUNE';
      const reqs = e.req.map(r => PASSIVES[r].name).join(' + ');
      desc = `${e.desc}<br><span style="color:#ffd96b">룬 조건: ${reqs}</span><br><span style="color:#9eff5b">→ 스킬 슬롯이 각성됩니다</span>`;
      if(w) statTable = renderStatTable(evolutionRows(w, e));
    }
    else if(card.type === 'item_pick'){
      const it = card.item;
      title = it.name; color = ITEM_TIERS[it.tier].color;
      tag = it.kind === 'relic' ? '◈ RELIC' : '◇ LOOT';
      desc = `<span style="color:#cfeaff">${it.desc}</span><br><span style="color:#7d96b4">${it.kind === 'relic' ? '영구 효과' : '일회성 사용'}</span>`;
    }
    else if(card.type === 'glyph_pick'){
      const g = card.glyph;
      const stackCount = (p.glyphs||[]).filter(id => id === g.id).length;
      title = g.name; color = g.color; tag = '▽ RUNE';
      const stackLabel = stackCount > 0 ? `<br><span style="color:#9eff5b">현재 ${stackCount}중첩 — 픽 시 누적</span>` : '<br><span style="color:#9eff5b">이번 원정 영구 (심연 보스 보상)</span>';
      desc = `<span style="color:#cfeaff">${g.desc}</span>${stackLabel}`;
    }
    else if(card.type === 'shrine_pick'){
      const s = card.shrine;
      const affordable = meta.coins >= card.cost;
      title = s.name; color = s.color; tag = '◈ ALTAR';
      const costLine = `<br><span style="color:${affordable?'#ffd400':'#ff6464'};font-weight:900">◆ ${card.cost} ${affordable?'':'(코인 부족)'}</span>`;
      desc = `<span style="color:#cfeaff">${s.desc}</span>${costLine}`;
    }
    else if(card.type === 'fuse'){
      const f = card.fuse;
      title = f.name; color = f.color; tag = '★ AWAKEN';
      desc = `${f.desc}<br><span style="color:#ffd96b">각성 재료: ${f.sourceA} + ${f.sourceB}</span><br><span style="color:#9eff5b">두 스킬 흡수 → Lv.1 전설 스킬</span>`;
    }
    el.className = 'card rarity-' + rarityClass + (card.type==='evolve'?' evo':'') + (card.type==='fuse'?' fuse':'') + (card.type==='glyph_pick'?' glyph':'') + (card.type==='shrine_pick'?' shrine':'');
    el.style.setProperty('--accent', color);
    let tierLabel;
    if(card.type === 'evolve') tierLabel = `<div class="tier-label" style="color:#49c7ff;text-shadow:0 0 14px rgba(73,199,255,.9)">▲ RUNE · 각성</div>`;
    else if(card.type === 'fuse') tierLabel = `<div class="tier-label" style="color:#b8182f;text-shadow:0 0 14px rgba(184,24,47,.9)">★ AWAKEN · 전설</div>`;
    else if(card.type === 'glyph_pick') tierLabel = `<div class="tier-label" style="color:${card.glyph.color};text-shadow:0 0 14px ${card.glyph.color}">▽ BOSS RUNE · 심연 보상</div>`;
    else if(card.type === 'shrine_pick') tierLabel = `<div class="tier-label" style="color:${card.shrine.color};text-shadow:0 0 14px ${card.shrine.color}">◈ CURSED ALTAR · 즉시 헌납</div>`;
    else if(card.type === 'pas') tierLabel = `<div class="tier-label" style="color:${PASSIVES[card.key].color};text-shadow:0 0 10px ${PASSIVES[card.key].color}">◇ VIRTUE · 룬 조건</div>`;
    else if(card.type === 'item_pick') tierLabel = `<div class="tier-label" style="color:${ITEM_TIERS[card.item.tier].color};text-shadow:0 0 12px ${ITEM_TIERS[card.item.tier].glow}">${card.item.tier.toUpperCase()} · ${card.item.kind.toUpperCase()}</div>`;
    else if(card.tier) tierLabel = `<div class="tier-label" style="color:${card.tier.color};text-shadow:0 0 10px ${card.tier.glow}">${card.tier.label}${(card.mult && card.mult !== 1)?' · ×'+card.mult.toFixed(2):''}</div>`;
    else tierLabel = '';
    const iconHtml = cardIconHtml(card, p, color, title);
    el.innerHTML = `<div class="tag">${tag}</div>
      <div class="ico">${iconHtml}</div>
      <div class="name">${title}</div>
      ${tierLabel}
      <div class="desc">${desc}</div>
      ${statTable}`;
    el.addEventListener('click', ()=> chooseLevelupCard(card, el));
    root.appendChild(el);
  }
}
function chooseLevelupCard(card, el){
  if(G._levelupChoosing) return;
  G._levelupChoosing = true;
  el.classList.add('selected');
  window.setTimeout(()=>{
    G._levelupChoosing = false;
    applyLevelupCard(card);
  }, 120);
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
    fxRuneCircle(p.x, p.y, col, 150, .75, {style:'seal',spokes:9});
    fxRing(p.x, p.y, '#ffffff', 210, .9, {style:'rune',spokes:12});
    AUDIO.level();
    announce('▲ EVOLVE · ' + card.evo.name, 3);
  }
  else if(card.type === 'item_pick'){ applyItem(p, card.item.id); }
  else if(card.type === 'glyph_pick'){ applyGlyph(p, card.glyph.id); }
  else if(card.type === 'shrine_pick'){
    if(meta.coins < card.cost){
      // Refuse — replay the same modal so player can pick another or skip.
      AUDIO.hit?.();
      announce('◆ 코인 부족', 1.2);
      return;
    }
    meta.coins -= card.cost; saveMeta();
    card.shrine.apply(p);
    const col = card.shrine.color;
    flash(col, .55); shake(.45);
    fxBurst(p.x, p.y, col, 40, 280, 4, .7);
    fxRuneCircle(p.x, p.y, col, 170, .75, {style:'seal',spokes:8});
    AUDIO.level();
    announce('◈ ' + card.shrine.name, 2.2);
    updateSynergies(p);
  }
  else if(card.type === 'fuse'){
    applyFusion(p, card.fuseKey);
    const col = (card.fuse && card.fuse.color) || '#ff3dcb';
    flash(col, .65); shake(.7);
    fxBurst(p.x, p.y, col, 48, 380, 5, 1.0);
    fxRuneCircle(p.x, p.y, col, 190, .85, {style:'seal',spokes:12});
    fxRing(p.x, p.y, '#ffffff', 270, 1.0, {style:'rune',spokes:14});
    AUDIO.level();
    announce('★ FUSE · ' + (card.fuse?.name || 'WEAPON FUSED'), 3);
  }
  else if(card.type === 'heal'){ p.hp = Math.min(p.maxHp, p.hp + p.maxHp*.5 * mult); }
  else if(card.type === 'gold'){ const amt = Math.round(10 * mult); G.coinsRun += amt; meta.coins += amt; saveMeta(); }
  else if(card.type === 'stat_up'){ STAT_UPS[card.stat].apply(p, mult); }
  updateSynergies(p);
  document.getElementById('levelup-overlay').classList.add('hidden');
  G.mode = 'play';
  if(p.xp >= p.xpNext){ setTimeout(()=> doLevelUp(false), 80); }
}
/* Shrine pick — mid-run coin sink. 3 of N effect cards, each with a coin
   cost scaled by current run time. Player picks one if affordable, or skips
   (free) — even skipping consumes the shrine.
   =================================================================== */
export function openShrinePick(){
  const p = G.player; if(!p) return;
  const cards = rollShrineCards(3).map(s => ({
    type:'shrine_pick', shrine:s, cost: shrineCost(s.baseCost, G.t), rarity:'epic',
  }));
  if(cards.length === 0) return;
  AUDIO.level();
  G.mode = 'levelup';
  G.weaponPickPool = cards;
  document.getElementById('levelup-overlay').classList.remove('hidden');
  resetRerollCost();
  renderLevelupCards();
}
/* Glyph pick — opens the level-up overlay with 3 random GLYPH cards.
   Triggered by killEnemy on boss death (separate from chest pick). Glyphs are
   run-only globals (not saved to meta), and the same glyph can be picked again
   on later boss kills (stack). */
export function openGlyphPick(){
  const p = G.player; if(!p) return;
  const all = Object.values(GLYPHS);
  if(all.length === 0) return;
  const pool = all.slice();
  const cards = [];
  const want = Math.min(3, pool.length);
  while(cards.length < want){
    const idx = Math.floor(Math.random() * pool.length);
    const g = pool.splice(idx, 1)[0];
    cards.push({type:'glyph_pick', glyph:g, rarity:'epic'});
  }
  AUDIO.level();
  G.mode = 'levelup';
  G.weaponPickPool = cards;
  document.getElementById('levelup-overlay').classList.remove('hidden');
  resetRerollCost();
  renderLevelupCards();
}
/* Chest pick — opens the level-up overlay with 3 random RELIC cards (boss-only).
   Relics are gated to boss chests so they feel like a milestone. */
export function openChestPick(){
  const p = G.player; if(!p) return;
  const seen = new Set();
  const cards = [];
  for(let attempts = 0; attempts < 40 && cards.length < 3; attempts++){
    const it = pickRandomItem((p.luck||0) + .2, ['rare','epic','legendary'], 'relic');
    if(it && !seen.has(it.id)){
      seen.add(it.id);
      cards.push({type:'item_pick', item:it, rarity: it.tier === 'legendary' ? 'legend' : it.tier});
    }
  }
  if(cards.length === 0) return;
  AUDIO.level();
  G.mode = 'levelup';
  // Reroll cost also resets here so chest rerolls don't carry from prior level-ups.
  G.weaponPickPool = cards;
  document.getElementById('levelup-overlay').classList.remove('hidden');
  resetRerollCost();
  renderLevelupCards();
}

export function rerollLevelup(){
  if(G._levelupChoosing) return;
  if(meta.coins < G.rerollCost) return;
  meta.coins -= G.rerollCost; saveMeta();
  G.rerollCost = nextRerollCost(G.rerollCost);
  document.getElementById('reroll-cost').textContent = G.rerollCost;
  G.weaponPickPool = pickLevelupCards(G.player, 3);
  renderLevelupCards();
}
export function skipLevelup(){
  if(G._levelupChoosing) return;
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
        `<div class="pg-row evo locked" title="${w.def.name} — 이미 각성됨: ${w.evoName||''}">
          <div class="pg-name" style="color:${w.color||w.def.color}">${w.def.name} ✓</div>
          <div class="pg-meta">각성 완료: ${w.evoName||'(이름 없음)'}</div>
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
    const tip = `${w.def.name} → ${bestPath.name}\n조건: 스킬 ${maxLv}렙 + ${bestPath.req.join('+')} 만렙`;
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
      if(!evo) return `<span class="need">${key}각성필요</span>`;
      return `<span class="ok">${key}✓</span>`;
    };
    const tip = `${f.name} = ${f.sourceA} + ${f.sourceB}\n조건: 둘 다 만렙+각성 → 새 전설 스킬 Lv.1`;
    fuseRows.push({ sortKey, html:
      `<div class="pg-row fuse ${cls}" title="${tip.replace(/"/g,'&quot;')}">
        <div class="pg-name" style="color:${f.color}">${f.name}</div>
        <div class="pg-meta">${stat(f.sourceA, hasA, evoA, maxA, a)} + ${stat(f.sourceB, hasB, evoB, maxB, b)}</div>
      </div>` });
  }

  if(evoRows.length === 0 && fuseRows.length === 0){ root.style.display = 'none'; return; }
  evoRows.sort((x,y)=>x.sortKey - y.sortKey);
  fuseRows.sort((x,y)=>x.sortKey - y.sortKey);
  evoList.innerHTML = evoRows.length ? evoRows.map(r=>r.html).join('') : '<div style="color:#5d7290;font-size:9px">스킬 보유 시 표시</div>';
  fuseList.innerHTML = fuseRows.length ? fuseRows.map(r=>r.html).join('') : '<div style="color:#5d7290;font-size:9px">2개 이상 스킬 보유 시 표시</div>';
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
      renderWeaponSlot(el, w);
      ws.appendChild(el);
    }
  } else {
    for(let i=0;i<p.weapons.length;i++){
      const w = p.weapons[i];
      const el = ws.children[i];
      if(el.dataset.sig !== weaponSlotSignature(w)) renderWeaponSlot(el, w);
      else el.querySelector('.lv').textContent = w.level;
    }
  }
  const ps = document.getElementById('passive-slots');
  const pkeys = Object.keys(p.passives);
  if(ps.children.length !== pkeys.length){
    ps.innerHTML = '';
    for(const k of pkeys){
      const el = document.createElement('div'); el.className = 'slot passive';
      el.innerHTML = `${slotPassiveIcon(k)}<div class="lv">${p.passives[k]}</div>`;
      ps.appendChild(el);
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
  const diff = document.getElementById('diff-chip');
  if(diff) diff.textContent = 'RIFT · ' + (G.biomeName || 'RUINED NAVE');
  renderBuffTimers(p);
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
      const el = document.createElement('div'); el.className = 'slot relic';
      el.innerHTML = `${slotRelicIcon(it)}<div class="ttip">${it.name} · <span style="color:#9ab5d0">${it.desc}</span></div>`;
      rs.appendChild(el);
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
  G._shrinesSpawned = null;  // re-seed each run so SHRINEs respawn
  G.endReason = null; G.rerollCost = baseRerollCost();
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
  announce('SURVIVE THE RIFT 15:00', 1.6);
}
export function endRun(victory){
  if(G.mode === 'end') return;
  G.mode = 'end';
  G.endReason = victory ? 'victory' : 'death';
  document.getElementById('end-overlay').classList.remove('hidden');
  document.getElementById('end-title').textContent = victory ? 'RIFT SEALED' : 'EXILE FALLEN';
  const grade = (() => {
    if(victory) return 'S RANK · RIFT SEALED';
    if(G.t >= 720) return 'A RANK · DEEP DELVE';
    if(G.t >= 420 || G.killCount >= 600) return 'B RANK · BLOODIED';
    return 'C RANK · FIRST BLOOD';
  })();
  document.getElementById('end-grade').textContent = grade;
  document.getElementById('end-text').textContent = victory ? '심연이 봉인되었습니다. 전리품이 금고에 적립됩니다.' : '추방자가 균열 속에서 쓰러졌습니다.';
  const stats = document.getElementById('end-stats');
  const coinsTotal = meta.coins;
  stats.innerHTML = `
    <span>TIME</span><b>${fmtTime(G.t)}</b>
    <span>KILLS</span><b>${G.killCount}</b>
    <span>LEVEL</span><b>${G.player ? G.player.level : 1}</b>
    <span>CORES</span><b>◆ ${G.coinsRun}</b>
    <span>EXILE</span><b>${CLASSES[G.classChosen]?.name || G.classChosen}</b>
    <span>VAULT</span><b>◆ ${coinsTotal}</b>
  `;
  if(G.t > meta.bestTime){ meta.bestTime = G.t|0; }
  meta.kills += G.killCount;
  if(victory){ meta.wins++; }
  unlockMilestones();
  saveMeta();
  document.getElementById('menu-coins').textContent = meta.coins;
  document.getElementById('menu-best').textContent = fmtTime(meta.bestTime);
  flash(victory ? C.gold : C.red, victory ? .45 : .55);
  shake(victory ? .35 : .5);
  AUDIO.setMode(victory ? 'victory' : 'death');
}
function unlockMilestones(){
  const order = ['CIRCLE','TRIANGLE','HEXAGON','SQUARE','STAR'];
  for(const k of order){
    const need = CLASSES[k].unlock;
    if(meta.coins >= need && !meta.unlocked.includes(k)){
      meta.unlocked.push(k);
      announce('EXILE UNLOCKED · ' + CLASSES[k].name, 2);
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
  syncSettingsClasses();
  document.getElementById('menu-overlay').classList.remove('hidden');
  document.getElementById('menu-coins').textContent = meta.coins;
  document.getElementById('menu-best').textContent = fmtTime(meta.bestTime);
  document.getElementById('menu-runs').textContent = meta.runs;
  AUDIO.init().then(()=> AUDIO.setMode('menu'));
}
function setAbandonConfirm(show){
  document.getElementById('abandon-confirm')?.classList.toggle('hidden', !show);
}
export function closeOverlay(id){
  document.getElementById(id).classList.add('hidden');
  if(id === 'pause-overlay') setAbandonConfirm(false);
}
export function togglePause(){
  if(G.mode === 'play'){
    G.mode = 'pause';
    document.getElementById('pause-overlay').classList.remove('hidden');
    setAbandonConfirm(false);
    const p = G.player; if(!p) return;
    let html = `<div><b>EXILE:</b> ${CLASSES[G.classChosen]?.name || G.classChosen} · LV ${p.level} · ${fmtTime(G.t)}</div>`;
    html += '<div style="margin-top:8px;color:#9ab5d0;font-weight:700">SKILLS</div>';
    for(const w of p.weapons){
      const tag = w.evolved ? ` <span style="color:#ff2bd6">▲ ${w.evoName||''}</span>` : '';
      html += `<div>· ${w.def.name} <span style="color:${w.color||w.def.color}">Lv.${w.level}</span>${tag}</div>`;
    }
    html += '<div style="margin-top:8px;color:#9ab5d0;font-weight:700">VIRTUES</div>';
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
    setAbandonConfirm(false);
    closeOverlay('pause-overlay');
  }
}
export function toggleMute(){
  AUDIO.setMuted(!AUDIO.isMuted());
  document.getElementById('mute-btn').textContent = AUDIO.isMuted() ? '×' : '♪';
}
export function toggleGuide(){
  const root = document.getElementById('progression-guide');
  if(!root) return;
  root.classList.toggle('mobile-open');
}
export function confirmAbandon(){
  if(G.mode !== 'pause') return;
  setAbandonConfirm(true);
}
export function cancelAbandon(){
  setAbandonConfirm(false);
}
export function abandonRun(){
  if(G.mode !== 'pause') return;
  setAbandonConfirm(false);
  closeOverlay('pause-overlay');
  endRun(false);
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
    const art = CLASS_ART[k] ? imgIcon(CLASS_ART[k], cl.name, 'class-art-img', 'virtue-' + k.toLowerCase(), cl.color) : runeIcon('virtue-' + k.toLowerCase(), cl.color, cl.name);
    el.style.setProperty('--accent', cl.color);
    el.innerHTML = `<div class="class-portrait">${art}</div>
      <div class="cname">${cl.name}</div>
      <div class="cdesc">${cl.desc}</div>
      <div class="cstart">${locked ? '◆ ' + cl.unlock + ' 필요' : 'RIFT SKILL: ' + WEAPONS[cl.startWeap].name}</div>`;
    grid.appendChild(el);
    if(!locked) el.addEventListener('click', ()=> startRun(k));
  }
}

/* ===================================================================
   SHOP
   =================================================================== */
let shopFeedbackTimer = 0;
function clearShopFeedback(){
  const el = document.getElementById('shop-feedback');
  if(!el) return;
  window.clearTimeout(shopFeedbackTimer);
  el.textContent = '';
  el.classList.remove('show');
}
function showShopFeedback(text){
  const el = document.getElementById('shop-feedback');
  if(!el) return;
  window.clearTimeout(shopFeedbackTimer);
  el.textContent = text;
  el.classList.add('show');
  shopFeedbackTimer = window.setTimeout(()=>el.classList.remove('show'), 1400);
}
function buildShop(){
  document.getElementById('shop-coins').textContent = meta.coins;
  clearShopFeedback();
  const grid = document.getElementById('shop-grid');
  grid.innerHTML = '';
  for(const it of SHOP_ITEMS){
    const lv = meta.shop[it.key]||0;
    const max = it.max;
    const cost = lv >= max ? null : it.costFn(lv);
    const affordable = cost == null || meta.coins >= cost;
    const el = document.createElement('div');
    el.className = 'shop-card' + (lv>=max ? ' maxed' : '') + (!affordable ? ' unaffordable' : '');
    let pips = '';
    for(let i=0;i<max;i++) pips += `<span class="pip ${i<lv?'on':''}"></span>`;
    el.innerHTML = `<div class="sn">${it.name}</div><div class="sd">${it.desc}</div><div>${pips}</div><div class="sp" style="color:${cost==null?'#fff':affordable?'#fff1bc':'#ff7aa1'}">${cost==null?'MAX':'◆ '+cost}</div>`;
    if(cost!=null) el.addEventListener('click', ()=>{
      if(meta.coins >= cost){
        meta.coins -= cost; meta.shop[it.key] = lv+1; saveMeta();
        buildShop();
        document.getElementById('menu-coins').textContent = meta.coins;
      } else {
        AUDIO.hit?.();
        announce('◆ 코어 부족', 1.2);
        showShopFeedback('◆ 코어 부족');
      }
    });
    grid.appendChild(el);
  }
}
export function openShop(){ closeOverlay('menu-overlay'); document.getElementById('shop-overlay').classList.remove('hidden'); buildShop(); }

function buildSettings(){
  syncSettingsClasses();
  const root = document.getElementById('settings-grid');
  root.innerHTML = SETTINGS.map(s => {
    const on = !!meta.settings?.[s.key];
    return `<button class="setting-card ${on?'on':''}" onclick="toggleSetting('${s.key}')">
      <div><b>${s.name}</b><span>${s.desc}</span></div>
      <i class="toggle-dot"></i>
    </button>`;
  }).join('');
}
export function toggleSetting(key){
  if(!SETTINGS.some(s => s.key === key)) return;
  meta.settings[key] = !meta.settings[key];
  if(key === 'autoQuality' && !meta.settings[key]){ G.qualityScale = 1; G.qualityLabel = 'HIGH'; }
  saveMeta();
  buildSettings();
}
export function openSettings(){
  closeOverlay('menu-overlay');
  document.getElementById('settings-overlay').classList.remove('hidden');
  buildSettings();
}

/* ===================================================================
   CHIPSET LAB — gacha + inventory + slot equip + manual fusion.
   meta.chips.owned[id] = stack level (1+, 1 from raw pull, +1 from fusion).
   meta.chips.equipped[i] = chipId|null. Fixed length = meta.chips.slots.
   Manual fusion: 3 owned at same level → 1 owned at level+1 (consumes 3,
   refunds nothing — keeps every pull meaningful). Auto-unequips fused chips.
   =================================================================== */
function _chipCardHtml(chip, opts={}){
  const tier = CHIP_TIERS[chip.tier];
  const stack = opts.stack || 0;
  const equippedTag = opts.equippedSlot != null ? `<div class="cequip">▣ ${opts.equippedSlot+1}</div>` : '';
  const stackTag = stack > 1 ? `<div class="cstack">×${stack}</div>` : '';
  const cls = 'chip tier-' + chip.tier + (opts.equipped ? ' equipped' : '') + (opts.fuseReady ? ' fuse-ready' : '') + (opts.empty ? ' empty' : '');
  const fuseBtn = opts.fuseReady ? `<div class="cfuse" data-fuse="${chip.id}">★ FORGE → ${_CHIP_TIER_NEXT[chip.tier] ? CHIP_TIERS[_CHIP_TIER_NEXT[chip.tier]].label : '?'}</div>` : '';
  // Effective-strength hint when stack > 1 — players can read "+5%/Lv" but a
  // ×4 stack means +20%, which is non-obvious without math. We surface a
  // small "현재" line that scales linear-equivalent values out of the desc.
  const effLine = stack > 1 ? `<div style="font-size:9px;color:#9eff5b;font-weight:700;letter-spacing:.08em">${opts.equipped ? '현재' : '장착 시'} Lv ${stack} (효과 ×${stack})</div>` : '';
  return `<div class="${cls}" data-chip="${chip.id}" data-action="${opts.action||''}" data-slot="${opts.equippedSlot ?? ''}" title="${chip.name} — ${chip.desc}${stack>1?` · Lv ${stack}`:''}">
    ${equippedTag}${stackTag}
    <div class="cn" style="color:${tier.color}">${chip.name}</div>
    <div class="cd">${chip.desc}</div>
    ${effLine}
    <div style="font-size:9px;color:${tier.color};letter-spacing:.12em;font-weight:700">${tier.label}</div>
    ${fuseBtn}
  </div>`;
}
function _emptySlotHtml(slotIdx){
  return `<div class="chip empty" data-action="empty-slot" data-slot="${slotIdx}" style="width:160px">
    <div class="cn" style="color:#5d7290">EMPTY SOCKET ${slotIdx+1}</div>
    <div class="cd" style="color:#5d7290">룬 금고에서 룬을 클릭해 장착</div>
  </div>`;
}
function _chipFlash(name, tierKey){
  const tier = CHIP_TIERS[tierKey];
  const el = document.getElementById('chipset-pull-result');
  // Higher tiers get a stronger glow + outline + tier prefix sigil.
  const sigil = tierKey === 'legendary' ? '★ ' : tierKey === 'epic' ? '◈ ' : tierKey === 'rare' ? '◇ ' : '· ';
  const outline = tierKey === 'legendary' ? `outline:3px solid ${tier.color};box-shadow:0 0 26px ${tier.color}` :
                  tierKey === 'epic' ? `outline:2px solid ${tier.color};box-shadow:0 0 16px ${tier.color}` : '';
  const desc = CHIPS[Object.keys(CHIPS).find(k=>CHIPS[k].name===name)]?.desc || '';
  el.innerHTML += `<div class="chip tier-${tierKey}" style="pointer-events:none;${outline}">
    <div class="cn" style="color:${tier.color}">${sigil}${name}</div>
    <div class="cd" style="font-size:10px">${desc}</div>
    <div style="font-size:9px;color:${tier.color};letter-spacing:.12em;font-weight:700">${tier.label}</div>
  </div>`;
}
export function chipsetPull(n){
  const cost = n === 10 ? CHIP_PULL10_COST : CHIP_PULL_COST;
  if(meta.coins < cost){ AUDIO.hit?.(); return; }
  meta.coins -= cost;
  document.getElementById('chipset-pull-result').innerHTML = '';
  const newOwned = [];
  for(let i = 0; i < n; i++){
    const chip = rollChip();
    if(!chip) continue;
    meta.chips.owned[chip.id] = (meta.chips.owned[chip.id] || 0) + 1;
    newOwned.push(chip);
    _chipFlash(chip.name, chip.tier);
  }
  saveMeta();
  AUDIO.level?.();
  buildChipset();
}
export function chipsetBuySlot(){
  const slots = meta.chips.slots || CHIP_DEFAULT_SLOTS;
  const idx = slots - CHIP_DEFAULT_SLOTS; // 0 → first expansion (slot 4)
  if(idx >= CHIP_SLOT_COSTS.length) return;
  const cost = CHIP_SLOT_COSTS[idx];
  if(meta.coins < cost) return;
  meta.coins -= cost;
  meta.chips.slots = slots + 1;
  meta.chips.equipped.push(null);
  saveMeta();
  buildChipset();
}
function chipsetEquip(chipId){
  // If already equipped (any slot), do nothing — clicking same chip in inventory
  // shouldn't re-equip into another slot. Player must explicitly unequip first.
  const eq = meta.chips.equipped;
  if(eq.includes(chipId)){
    _chipsetToast('이미 장착된 룬', '#9ab5d0');
    return;
  }
  const empty = eq.indexOf(null);
  if(empty < 0){
    // Slots full — refuse and tell the player. No silent overwrite.
    _chipsetToast('소켓이 가득 참 — 장착된 룬을 먼저 클릭해 빼세요', '#ff6464');
    return;
  }
  eq[empty] = chipId;
  saveMeta();
  buildChipset();
}
// Lightweight transient message in the pull-result strip.
function _chipsetToast(msg, color='#ffd400'){
  const el = document.getElementById('chipset-pull-result');
  if(!el) return;
  el.innerHTML = `<div style="padding:18px 22px;border:1px dashed ${color};border-radius:8px;color:${color};font-size:12px;letter-spacing:.16em;font-weight:700">${msg}</div>`;
}
function chipsetUnequip(slot){
  meta.chips.equipped[slot] = null;
  saveMeta();
  buildChipset();
}
// Tier ladder for fusion. legendary doesn't fuse further (returns null).
const _CHIP_TIER_NEXT = { common:'rare', rare:'epic', epic:'legendary', legendary:null };
function _pickRandomChipOfTier(tier){
  const pool = Object.values(CHIPS).filter(c => c.tier === tier);
  if(!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
function chipsetFuse(chipId){
  // Real forging: 3 runes of same id → 1 random rune of next tier.
  // Consumes the source rune stacks entirely (owned[id] -= 3) and adds 1 to
  // the new rune's owned count. Auto-unequips the source if its owned hits 0
  // and it was equipped (so a stale equipped socket doesn't reference a rune
  // the player no longer owns).
  const src = CHIPS[chipId]; if(!src) return;
  if((meta.chips.owned[chipId] || 0) < 3) return;
  const nextTier = _CHIP_TIER_NEXT[src.tier];
  if(!nextTier){
    // legendary: no fuse target. Just refund some coins so it isn't a trap.
    meta.coins += 200;
    saveMeta();
    buildChipset();
    return;
  }
  const newChip = _pickRandomChipOfTier(nextTier);
  if(!newChip) return;
  meta.chips.owned[chipId] -= 3;
  if(meta.chips.owned[chipId] <= 0){
    delete meta.chips.owned[chipId];
    // Unequip if currently slotted
    const idx = meta.chips.equipped.indexOf(chipId);
    if(idx >= 0) meta.chips.equipped[idx] = null;
  }
  meta.chips.owned[newChip.id] = (meta.chips.owned[newChip.id] || 0) + 1;
  saveMeta();
  // Visual feedback: flash the result in pull-result area.
  const tier = CHIP_TIERS[newChip.tier];
  document.getElementById('chipset-pull-result').innerHTML =
    `<div class="chip tier-${newChip.tier}" style="pointer-events:none;outline:3px solid ${tier.color};box-shadow:0 0 24px ${tier.color}">
      <div class="cn" style="color:${tier.color}">★ FORGE → ${newChip.name}</div>
      <div class="cd" style="font-size:10px">${newChip.desc}</div>
      <div style="font-size:9px;color:${tier.color};letter-spacing:.12em;font-weight:700">${tier.label}</div>
    </div>`;
  AUDIO.level?.();
  buildChipset();
}
function buildChipset(){
  document.getElementById('chipset-coins').textContent = meta.coins;
  // Slot info + buy button state
  const slots = meta.chips.slots || CHIP_DEFAULT_SLOTS;
  const expansionIdx = slots - CHIP_DEFAULT_SLOTS;
  const slotBtn = document.getElementById('slot-btn');
  if(expansionIdx >= CHIP_SLOT_COSTS.length){
    slotBtn.textContent = '+ 슬롯 (MAX)';
    slotBtn.disabled = true;
  } else {
    const cost = CHIP_SLOT_COSTS[expansionIdx];
    slotBtn.textContent = `+ 슬롯 → ${slots+1} (◆ ${cost})`;
    slotBtn.disabled = meta.coins < cost;
  }
  document.getElementById('chipset-slot-info').textContent = `${slots} sockets`;
  // Equipped grid
  const eqRoot = document.getElementById('chipset-equipped');
  let html = '';
  for(let i = 0; i < slots; i++){
    const chipId = meta.chips.equipped[i];
    if(!chipId){ html += _emptySlotHtml(i); }
    else {
      const chip = CHIPS[chipId];
      if(!chip){ html += _emptySlotHtml(i); continue; }
      const stack = meta.chips.owned[chipId] || 1;
      html += _chipCardHtml(chip, {stack, equippedSlot:i, equipped:true, action:'unequip'});
    }
  }
  eqRoot.innerHTML = html;
  // Inventory grid — sorted by tier (legend → common), then stack desc, then name.
  // Without sorting, chips appear in JSON-key order which feels random as the
  // pull list grows, making fuse-ready stacks hard to spot.
  const invRoot = document.getElementById('chipset-inventory');
  const ownedIds = Object.keys(meta.chips.owned).filter(id => meta.chips.owned[id] > 0);
  if(ownedIds.length === 0){
    invRoot.innerHTML = `<div class="empty-state">아직 룬이 없습니다.<br>위의 제련 버튼으로 첫 룬을 만든 뒤 소켓에 장착하세요.</div>`;
  } else {
    const tierRank = { legendary:0, epic:1, rare:2, common:3 };
    ownedIds.sort((a, b) => {
      const ca = CHIPS[a], cb = CHIPS[b];
      if(!ca || !cb) return 0;
      const ta = tierRank[ca.tier] ?? 9, tb = tierRank[cb.tier] ?? 9;
      if(ta !== tb) return ta - tb;
      const sa = meta.chips.owned[a], sb = meta.chips.owned[b];
      if(sa !== sb) return sb - sa;
      return ca.name.localeCompare(cb.name);
    });
    invRoot.innerHTML = ownedIds.map(id => {
      const chip = CHIPS[id]; if(!chip) return '';
      const stack = meta.chips.owned[id];
      const isEquipped = meta.chips.equipped.includes(id);
      const fuseReady = stack >= 3;
      return _chipCardHtml(chip, {stack, equipped:isEquipped, fuseReady, action: fuseReady ? 'fuse-or-equip' : 'equip'});
    }).join('');
  }
  // Wire clicks via delegation (rebuild on every change so no leak).
  eqRoot.onclick = ev => {
    const card = ev.target.closest('.chip'); if(!card) return;
    const slot = parseInt(card.dataset.slot, 10);
    if(!isNaN(slot) && card.dataset.action === 'unequip') chipsetUnequip(slot);
  };
  invRoot.onclick = ev => {
    // FUSE button takes priority — checks first.
    const fuseBtn = ev.target.closest('[data-fuse]');
    if(fuseBtn){ ev.stopPropagation(); chipsetFuse(fuseBtn.dataset.fuse); return; }
    const card = ev.target.closest('.chip'); if(!card) return;
    const id = card.dataset.chip; if(!id) return;
    chipsetEquip(id);
  };
  // Pull button states
  document.getElementById('pull1-btn').disabled = meta.coins < CHIP_PULL_COST;
  document.getElementById('pull10-btn').disabled = meta.coins < CHIP_PULL10_COST;
}
export function openChipset(){
  closeOverlay('menu-overlay');
  document.getElementById('chipset-overlay').classList.remove('hidden');
  // Friendly empty-state hint — without this the 90px result strip just looked
  // like dead space when the player first arrives.
  document.getElementById('chipset-pull-result').innerHTML =
    `<div class="empty-state" style="border-color:rgba(255,61,203,.4)">
      ◇ 코어로 룬을 제련한 후 금고에서 소켓에 장착하세요 · 같은 룬 ×3 → ★ FORGE 로 다음 등급 변환
    </div>`;
  buildChipset();
}

/* ===================================================================
   CODEX
   =================================================================== */
function buildCodex(){
  const root = document.getElementById('codex-content');
  const tabs = document.getElementById('codex-tabs');
  tabs.innerHTML = CODEX_TABS.map(t =>
    `<button class="codex-tab ${_codexTab===t.key?'active':''}" onclick="setCodexTab('${t.key}')">${t.label}</button>`
  ).join('');
  const row = (color, title, desc) =>
    `<div style="padding:8px 6px;border-bottom:1px solid #1c2a4a;color:${color}"><b>${title}</b> <span style="color:#9ab5d0">${desc}</span></div>`;
  let html = '';
  if(_codexTab === 'skills'){
    html += '<div style="color:#fff;font-weight:900;letter-spacing:.2em;margin-bottom:6px">SKILLS</div>';
    for(const k in WEAPONS){
      const seen = meta.seenCodex.weapons.includes(k);
      const d = WEAPONS[k];
      html += row(seen?d.color:'#5d7290', seen?d.name:'???', seen?'· '+d.desc:'· 미해금');
    }
  } else if(_codexTab === 'virtues'){
    html += '<div style="color:#fff;font-weight:900;letter-spacing:.2em;margin-bottom:6px">VIRTUES</div>';
    for(const k in PASSIVES){
      const seen = meta.seenCodex.passives.includes(k);
      const d = PASSIVES[k];
      html += row(seen?d.color:'#5d7290', seen?d.name:'???', seen?'· '+d.desc:'· 미해금');
    }
  } else if(_codexTab === 'awaken'){
    html += '<div style="color:#fff;font-weight:900;letter-spacing:.2em;margin-bottom:6px">★ AWAKENINGS</div>';
    for(const fk in FUSIONS){
      const f = FUSIONS[fk];
      html += row(f.color, f.name, `= ${f.sourceA} + ${f.sourceB} — ${f.desc}`);
    }
  } else if(_codexTab === 'runes'){
    html += '<div style="color:#fff;font-weight:900;letter-spacing:.2em;margin-bottom:6px">▽ BOSS RUNES</div>';
    for(const gk in GLYPHS){
      const g = GLYPHS[gk];
      html += row(g.color, g.name, '· ' + g.desc);
    }
  } else {
    html += '<div style="color:#fff;font-weight:900;letter-spacing:.2em;margin-bottom:6px">ABYSS BESTIARY</div>';
    for(const k in ENEMIES){
      const d = ENEMIES[k];
      html += row(d.color, d.name || k, `· ${d.brain} · HP ${d.hp} · DMG ${d.dmg}`);
    }
  }
  root.innerHTML = html;
}
export function setCodexTab(tab){
  if(!CODEX_TABS.some(t => t.key === tab)) return;
  _codexTab = tab;
  buildCodex();
}
export function openCodex(){ closeOverlay('menu-overlay'); document.getElementById('codex-overlay').classList.remove('hidden'); buildCodex(); }

// Wire player.js so applyItem (consumable forced level-up) and damagePlayer (death) can invoke us.
syncSettingsClasses();
setUiHandlers({ doLevelUp, endRun, openGlyphPick, openShrinePick });
