'use strict';
// 밸런스/데이터 정의. 수치 조정은 대부분 이 파일에서 한다.

const CFG = {
  COLS: 22,
  ROWS: 13,
  TILE: 40,
  START_GOLD: 150,
  START_LIVES: 20,
  TOTAL_WAVES: 20,
  BOSS_EVERY: 5,
  ROCKS_MIN: 10,
  ROCKS_MAX: 16,
  SELL_RATIO: 0.7,
  ITEM_LIFETIME: 12,
  HERO_RESPAWN: 5,
  DROP_CHANCE: 0.18,
  SKIP_REWARD_GOLD: 40,
};

// 모든 타워는 길을 막는다 → 배치 자체가 미로 설계.
const TOWERS = {
  wall:   { key: '1', name: '벽',    cost: 5,  color: '#9aa3ad', desc: '공격 없음. 싸게 길을 막아 미로를 만든다.' },
  arrow:  { key: '2', name: '화살탑', cost: 30, color: '#5cb85c', desc: '빠른 단일 공격', range: 3.0, dmg: 9,  rate: 0.55, projSpeed: 520 },
  cannon: { key: '3', name: '대포탑', cost: 50, color: '#f0913a', desc: '느리지만 범위 피해', range: 2.6, dmg: 22, rate: 1.5, splash: 0.9, projSpeed: 300 },
  frost:  { key: '4', name: '냉기탑', cost: 40, color: '#4fc3f7', desc: '맞은 적을 둔화', range: 2.4, dmg: 4,  rate: 0.9, slow: 0.45, slowDur: 1.6, projSpeed: 420 },
};
const TOWER_MAX_LV = 3;

const ENEMIES = {
  grunt:  { name: '졸병',   hp: 32,  speed: 1.5,  gold: 4,  dmg: 8,  r: 9,  color: '#e05555', lives: 1 },
  runner: { name: '날쌘이', hp: 20,  speed: 2.6,  gold: 3,  dmg: 5,  r: 7,  color: '#e8c547', lives: 1 },
  brute:  { name: '덩치',   hp: 120, speed: 0.95, gold: 10, dmg: 15, r: 12, color: '#a05ad0', lives: 2 },
  boss:   { name: '보스',   hp: 700, speed: 0.7,  gold: 60, dmg: 30, r: 17, color: '#d0305a', lives: 5 },
};

const HERO_BASE = {
  hp: 100, speed: 150, dmg: 12, rate: 0.45, range: 75, r: 12,
  skillCd: 6, skillRadius: 95, skillMult: 3,
};

// 런 동안만 유지되는 강화(로그라이크 유물). 드랍 또는 웨이브 보상으로 획득.
const RELICS = [
  { id: 'blade',     icon: '⚔', name: '날카로운 검',   desc: '영웅 공격력 +25%',                apply: g => { g.mods.heroDmg *= 1.25; } },
  { id: 'boots',     icon: '👢', name: '가죽 장화',     desc: '영웅 이동속도 +15%',              apply: g => { g.mods.heroSpeed *= 1.15; } },
  { id: 'gloves',    icon: '🥊', name: '광전사 장갑',   desc: '영웅 공격속도 +20%',              apply: g => { g.mods.heroRate *= 0.82; } },
  { id: 'bow',       icon: '🏹', name: '긴 활',         desc: '영웅 사거리 +20%',                apply: g => { g.mods.heroRange *= 1.2; } },
  { id: 'fang',      icon: '🦷', name: '흡혈 송곳니',   desc: '영웅 피해의 8%만큼 회복',         apply: g => { g.mods.lifesteal += 0.08; } },
  { id: 'chain',     icon: '⚡', name: '연쇄 번개',     desc: '영웅 공격이 주변 적 1명에게 튕김', apply: g => { g.mods.chain += 1; } },
  { id: 'heart',     icon: '❤', name: '강철 심장',     desc: '영웅 최대 HP +30, 즉시 완전 회복', apply: g => { g.hero.maxHp += 30; g.hero.hp = g.hero.maxHp; } },
  { id: 'hourglass', icon: '⏳', name: '모래시계',      desc: '스킬 쿨다운 -25%',               apply: g => { g.mods.skillCd *= 0.75; } },
  { id: 'wrench',    icon: '🔧', name: '공학자의 렌치', desc: '모든 타워 공격력 +15%',           apply: g => { g.mods.towerDmg *= 1.15; } },
  { id: 'lens',      icon: '🔭', name: '망원 렌즈',     desc: '모든 타워 사거리 +10%',           apply: g => { g.mods.towerRange *= 1.1; } },
  { id: 'gearbox',   icon: '⚙', name: '톱니 장치',     desc: '모든 타워 공격속도 +15%',         apply: g => { g.mods.towerRate *= 0.87; } },
  { id: 'frostseal', icon: '❄', name: '서리 인장',     desc: '냉기탑 둔화 +15%p',              apply: g => { g.mods.slowBonus += 0.15; } },
  { id: 'pouch',     icon: '💰', name: '황금 주머니',   desc: '처치 골드 +20%',                  apply: g => { g.mods.goldMult *= 1.2; } },
  { id: 'bank',      icon: '🏦', name: '작은 금고',     desc: '웨이브 종료 시 보유 골드 10% 이자(최대 25)', apply: g => { g.mods.interest += 0.1; } },
  { id: 'clover',    icon: '🍀', name: '네잎클로버',    desc: '아이템 드랍률 +8%p',              apply: g => { g.mods.dropBonus += 0.08; } },
  { id: 'magnet',    icon: '🧲', name: '자석',          desc: '아이템 줍는 범위 증가',           apply: g => { g.mods.magnet += 60; } },
  { id: 'mason',     icon: '🧱', name: '성벽 보수',     desc: '기지 HP +5',                      apply: g => { g.lives += 5; } },
];
const RELIC_BY_ID = Object.fromEntries(RELICS.map(r => [r.id, r]));

function defaultMods() {
  return {
    heroDmg: 1, heroSpeed: 1, heroRate: 1, heroRange: 1, skillCd: 1,
    lifesteal: 0, chain: 0,
    towerDmg: 1, towerRange: 1, towerRate: 1, slowBonus: 0,
    goldMult: 1, interest: 0, dropBonus: 0, magnet: 40,
  };
}

function waveHpMul(w) {
  return 1 + 0.22 * (w - 1) + 0.015 * (w - 1) * (w - 1);
}

function buildWave(w) {
  const q = [];
  const n = 6 + Math.floor(w * 1.5);
  for (let i = 0; i < n; i++) {
    let type = 'grunt';
    const roll = Math.random();
    if (w >= 3 && roll < 0.25 + w * 0.01) type = 'runner';
    else if (w >= 4 && roll > 0.85 - w * 0.01) type = 'brute';
    q.push({ type, delay: type === 'runner' ? 0.45 : 0.85 });
  }
  if (w % CFG.BOSS_EVERY === 0) q.push({ type: 'boss', delay: 1.5 });
  return q;
}
