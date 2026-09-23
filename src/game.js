'use strict';
(() => {
  const T = CFG.TILE, COLS = CFG.COLS, ROWS = CFG.ROWS;
  const W = COLS * T, H = ROWS * T;

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.aspectRatio = `${W} / ${H}`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const $ = id => document.getElementById(id);
  const tileCenter = (c, r) => ({ x: c * T + T / 2, y: r * T + T / 2 });
  const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
  const rand = arr => arr[Math.floor(Math.random() * arr.length)];

  let G = null;
  const keys = new Set();

  // ───────────────────────── 상태 ─────────────────────────
  function newGame() {
    const board = new Board(COLS, ROWS);
    board.generateRocks(CFG.ROCKS_MIN + Math.floor(Math.random() * (CFG.ROCKS_MAX - CFG.ROCKS_MIN + 1)));
    const heroPos = tileCenter(board.goal.c - 1, board.goal.r);
    G = {
      board,
      field: board.computeField(),
      gold: CFG.START_GOLD,
      lives: CFG.START_LIVES,
      wave: 0,
      kills: 0,
      phase: 'build', // build | wave | over
      enemies: [], projectiles: [], items: [], effects: [], texts: [],
      spawnQueue: [], spawnTimer: 0, hpMul: 1,
      towers: [],
      hero: {
        x: heroPos.x, y: heroPos.y, r: HERO_BASE.r,
        hp: HERO_BASE.hp, maxHp: HERO_BASE.hp,
        dead: false, respawn: 0, atkCd: 0, skillCd: 0, facing: 0, path: null,
      },
      mods: defaultMods(),
      relics: [],
      tool: 'wall', selected: null, hover: null, preview: null,
      speed: 1, paused: false, modal: false, time: 0, hurtFlash: 0,
    };
    updatePathInfo();
    buildSidebar();
  }

  function updatePathInfo() {
    const { board } = G;
    G.path = board.pathFrom(G.field, board.spawn.c, board.spawn.r);
  }

  const heroStat = {
    dmg: () => HERO_BASE.dmg * G.mods.heroDmg,
    rate: () => HERO_BASE.rate * G.mods.heroRate,
    speed: () => HERO_BASE.speed * G.mods.heroSpeed,
    range: () => HERO_BASE.range * G.mods.heroRange,
    skillCd: () => HERO_BASE.skillCd * G.mods.skillCd,
  };

  function towerStat(t) {
    const d = TOWERS[t.type];
    const lv = t.lv - 1;
    return {
      dmg: d.dmg * (1 + 0.6 * lv) * G.mods.towerDmg,
      range: (d.range + 0.35 * lv) * G.mods.towerRange * T,
      rate: d.rate * (1 - 0.1 * lv) * G.mods.towerRate,
    };
  }
  const upgradeCost = t => Math.round(TOWERS[t.type].cost * 0.8 * t.lv);

  // ───────────────────────── 건설 ─────────────────────────
  function circleRectOverlap(cx, cy, cr, rx, ry, rw, rh) {
    const nx = Math.max(rx, Math.min(cx, rx + rw));
    const ny = Math.max(ry, Math.min(cy, ry + rh));
    return dist2(cx, cy, nx, ny) < cr * cr;
  }

  function enemyTile(e) {
    return { c: Math.floor(e.x / T), r: Math.floor(e.y / T) };
  }

  function canPlace(c, r, type) {
    const { board } = G;
    if (!board.inside(c, r)) return { ok: false };
    if (board.isSpecial(c, r) || board.cells[board.idx(c, r)] !== CELL_EMPTY) return { ok: false, reason: '건설 불가' };
    if (G.gold < TOWERS[type].cost) return { ok: false, reason: '골드 부족' };
    const h = G.hero;
    if (!h.dead && circleRectOverlap(h.x, h.y, h.r, c * T, r * T, T, T)) return { ok: false, reason: '영웅이 서 있음' };
    for (const e of G.enemies) {
      const et = enemyTile(e);
      if (et.c === c && et.r === r) return { ok: false, reason: '적이 지나는 중' };
    }
    const i = board.idx(c, r);
    const field = board.computeField(i);
    if (field[board.idx(board.spawn.c, board.spawn.r)] < 0) return { ok: false, reason: '길을 완전히 막을 수 없음' };
    for (const e of G.enemies) {
      const et = enemyTile(e);
      if (board.inside(et.c, et.r) && field[board.idx(et.c, et.r)] < 0) return { ok: false, reason: '적을 가둘 수 없음' };
    }
    return { ok: true, field };
  }

  function placeTower(c, r) {
    const type = G.tool;
    const res = canPlace(c, r, type);
    if (!res.ok) {
      if (res.reason) floatText(c * T + T / 2, r * T + 4, res.reason, '#ff8080');
      return;
    }
    const { board } = G;
    const t = { type, c, r, lv: 1, cd: 0, angle: 0, invested: TOWERS[type].cost };
    G.gold -= t.invested;
    board.cells[board.idx(c, r)] = CELL_TOWER;
    board.towers[board.idx(c, r)] = t;
    G.towers.push(t);
    onBoardChanged(res.field);
  }

  function sellTower(t) {
    const { board } = G;
    const refund = Math.floor(t.invested * CFG.SELL_RATIO);
    G.gold += refund;
    board.cells[board.idx(t.c, t.r)] = CELL_EMPTY;
    board.towers[board.idx(t.c, t.r)] = null;
    G.towers.splice(G.towers.indexOf(t), 1);
    floatText(t.c * T + T / 2, t.r * T + 10, `+${refund}G`, '#ffd54f');
    G.selected = null;
    onBoardChanged(board.computeField());
  }

  function upgradeTower(t) {
    if (t.type === 'wall' || t.lv >= TOWER_MAX_LV) return;
    const cost = upgradeCost(t);
    if (G.gold < cost) return;
    G.gold -= cost;
    t.invested += cost;
    t.lv++;
    G.effects.push({ type: 'ring', x: t.c * T + T / 2, y: t.r * T + T / 2, r0: 10, r1: 30, t: 0, life: 0.35, color: '#ffd54f' });
  }

  function onBoardChanged(field) {
    G.field = field;
    for (const e of G.enemies) e.repath = true;
    updatePathInfo();
    refreshSelPanel();
  }

  // ───────────────────────── 적 ─────────────────────────
  function spawnEnemy(type) {
    const def = ENEMIES[type];
    const { spawn } = G.board;
    const p = tileCenter(spawn.c, spawn.r);
    const hp = Math.round(def.hp * G.hpMul);
    G.enemies.push({
      type, def, x: p.x - T, y: p.y, tc: spawn.c, tr: spawn.r, dir: [1, 0],
      hp, maxHp: hp, slowT: 0, slowAmt: 0, dead: false, repath: false, hitFlash: 0,
    });
  }

  function updateEnemy(e, dt) {
    const { board } = G;
    if (e.repath) {
      e.repath = false;
      const et = enemyTile(e);
      if (board.isOpen(et.c, et.r)) { e.tc = et.c; e.tr = et.r; }
    }
    if (e.slowT > 0) e.slowT -= dt;
    if (e.hitFlash > 0) e.hitFlash -= dt;
    const slow = e.slowT > 0 ? e.slowAmt : 0;
    let step = e.def.speed * T * (1 - slow) * dt;
    while (step > 0) {
      const tp = tileCenter(e.tc, e.tr);
      const dx = tp.x - e.x, dy = tp.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d > step) { e.x += dx / d * step; e.y += dy / d * step; break; }
      e.x = tp.x; e.y = tp.y; step -= d;
      if (e.tc === board.goal.c && e.tr === board.goal.r) { leak(e); return; }
      const next = board.nextStep(G.field, e.tc, e.tr, e.dir);
      if (!next) break;
      e.tc = next.c; e.tr = next.r; e.dir = next.dir;
    }
    // 영웅과 접촉 시 피해
    const h = G.hero;
    if (!h.dead && dist2(e.x, e.y, h.x, h.y) < (e.def.r + h.r) ** 2) {
      h.hp -= e.def.dmg * dt;
      G.hurtFlash = 0.15;
      if (h.hp <= 0) killHero();
    }
  }

  function leak(e) {
    e.dead = true;
    G.lives -= e.def.lives;
    G.effects.push({ type: 'screen', t: 0, life: 0.3 });
    if (G.lives <= 0) { G.lives = 0; gameOver(false); }
  }

  function damageEnemy(e, dmg, fromHero) {
    if (e.dead) return;
    e.hp -= dmg;
    e.hitFlash = 0.08;
    if (fromHero) {
      floatText(e.x, e.y - e.def.r - 4, Math.round(dmg), '#fff');
      if (G.mods.lifesteal > 0) {
        G.hero.hp = Math.min(G.hero.maxHp, G.hero.hp + dmg * G.mods.lifesteal);
      }
    }
    if (e.hp <= 0) killEnemy(e);
  }

  function killEnemy(e) {
    e.dead = true;
    G.kills++;
    const gold = Math.round(e.def.gold * G.mods.goldMult);
    G.gold += gold;
    floatText(e.x, e.y, `+${gold}`, '#ffd54f');
    G.effects.push({ type: 'ring', x: e.x, y: e.y, r0: e.def.r, r1: e.def.r * 2.2, t: 0, life: 0.25, color: e.def.color });
    rollDrop(e);
  }

  // ───────────────────────── 아이템 ─────────────────────────
  function rollDrop(e) {
    if (e.type === 'boss') { dropItem(e.x, e.y, 'relic'); return; }
    if (Math.random() > CFG.DROP_CHANCE + G.mods.dropBonus) return;
    const roll = Math.random();
    dropItem(e.x, e.y, roll < 0.55 ? 'coin' : roll < 0.85 ? 'potion' : 'relic');
  }

  function dropItem(x, y, type) {
    const item = { type, x, y, t: CFG.ITEM_LIFETIME, bob: Math.random() * 6 };
    if (type === 'relic') item.relic = rand(RELICS).id;
    G.items.push(item);
  }

  function updateItems(dt) {
    const h = G.hero;
    for (const it of G.items) {
      it.t -= dt;
      if (h.dead) continue;
      const d = Math.sqrt(dist2(it.x, it.y, h.x, h.y));
      if (d < h.r + 10) { pickup(it); continue; }
      if (d < G.mods.magnet + h.r) {
        const s = Math.min(d, 320 * dt);
        it.x += (h.x - it.x) / d * s;
        it.y += (h.y - it.y) / d * s;
      }
    }
    G.items = G.items.filter(it => it.t > 0 && !it.taken);
  }

  function pickup(it) {
    it.taken = true;
    const h = G.hero;
    if (it.type === 'coin') {
      const g = 5 + G.wave;
      G.gold += g;
      floatText(it.x, it.y, `+${g}G`, '#ffd54f');
    } else if (it.type === 'potion') {
      h.hp = Math.min(h.maxHp, h.hp + 35);
      floatText(it.x, it.y, '+35 HP', '#7dff8a');
    } else {
      addRelic(it.relic);
    }
  }

  function addRelic(id) {
    const def = RELIC_BY_ID[id];
    const owned = G.relics.find(r => r.id === id);
    if (owned) owned.count++; else G.relics.push({ id, count: 1 });
    def.apply(G);
    G.banner = { text: `${def.icon} ${def.name} — ${def.desc}`, t: 2.5 };
    buildRelicList();
  }

  // ───────────────────────── 영웅 ─────────────────────────
  function heroBlocked(x, y, r) {
    if (x - r < 0 || y - r < 0 || x + r > W || y + r > H) return true;
    const { board } = G;
    const c0 = Math.floor((x - r) / T), c1 = Math.floor((x + r) / T);
    const r0 = Math.floor((y - r) / T), r1 = Math.floor((y + r) / T);
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        if (!board.inside(cc, rr) || board.cells[board.idx(cc, rr)] === CELL_EMPTY) continue;
        if (circleRectOverlap(x, y, r, cc * T, rr * T, T, T)) return true;
      }
    }
    return false;
  }

  function updateHero(dt) {
    const h = G.hero;
    if (h.dead) {
      h.respawn -= dt;
      if (h.respawn <= 0) {
        const p = tileCenter(G.board.goal.c, G.board.goal.r);
        h.x = p.x; h.y = p.y; h.hp = h.maxHp; h.dead = false; h.path = null;
      }
      return;
    }
    if (h.atkCd > 0) h.atkCd -= dt;
    if (h.skillCd > 0) h.skillCd -= dt;

    // 이동: 키보드 우선, 없으면 우클릭 경로
    let vx = 0, vy = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) vx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) vx += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) vy -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) vy += 1;
    if (vx || vy) {
      h.path = null;
    } else if (h.path && h.path.length) {
      const wp = h.path[0];
      const dx = wp.x - h.x, dy = wp.y - h.y;
      const d = Math.hypot(dx, dy);
      if (d < 4) h.path.shift();
      else { vx = dx / d; vy = dy / d; }
    }
    const len = Math.hypot(vx, vy);
    if (len) {
      const s = heroStat.speed() * dt / len;
      const nx = h.x + vx * s, ny = h.y + vy * s;
      if (!heroBlocked(nx, h.y, h.r)) h.x = nx;
      if (!heroBlocked(h.x, ny, h.r)) h.y = ny;
      h.facing = Math.atan2(vy, vx);
    }

    // 자동 공격: 사거리 안 가장 가까운 적
    if (h.atkCd <= 0) {
      const target = nearestEnemy(h.x, h.y, heroStat.range());
      if (target) {
        h.atkCd = heroStat.rate();
        h.facing = Math.atan2(target.y - h.y, target.x - h.x);
        heroHit(h.x, h.y, target, G.mods.chain, new Set());
      }
    }
  }

  function heroHit(fx, fy, target, chainsLeft, hitSet) {
    hitSet.add(target);
    G.effects.push({ type: 'bolt', x1: fx, y1: fy, x2: target.x, y2: target.y, t: 0, life: 0.12 });
    damageEnemy(target, heroStat.dmg(), true);
    if (chainsLeft > 0) {
      const next = nearestEnemy(target.x, target.y, 90, hitSet);
      if (next) heroHit(target.x, target.y, next, chainsLeft - 1, hitSet);
    }
  }

  function useSkill() {
    const h = G.hero;
    if (h.dead || h.skillCd > 0 || G.paused || G.modal) return;
    h.skillCd = heroStat.skillCd();
    const R = HERO_BASE.skillRadius;
    G.effects.push({ type: 'ring', x: h.x, y: h.y, r0: 10, r1: R, t: 0, life: 0.3, color: '#ffe082', width: 4 });
    for (const e of G.enemies) {
      if (dist2(e.x, e.y, h.x, h.y) < (R + e.def.r) ** 2) damageEnemy(e, heroStat.dmg() * HERO_BASE.skillMult, true);
    }
  }

  function killHero() {
    const h = G.hero;
    h.dead = true;
    h.hp = 0;
    h.respawn = CFG.HERO_RESPAWN;
    G.effects.push({ type: 'ring', x: h.x, y: h.y, r0: 5, r1: 40, t: 0, life: 0.5, color: '#ff5252' });
  }

  function heroMoveTo(x, y) {
    const h = G.hero;
    if (h.dead) return;
    const from = { c: Math.floor(h.x / T), r: Math.floor(h.y / T) };
    const to = { c: Math.floor(x / T), r: Math.floor(y / T) };
    const tiles = G.board.findPath(from, to);
    if (!tiles) return;
    h.path = tiles.slice(0, -1).map(t => tileCenter(t.c, t.r));
    h.path.push({ x, y });
    G.effects.push({ type: 'ring', x, y, r0: 12, r1: 4, t: 0, life: 0.3, color: '#ffe082' });
  }

  function nearestEnemy(x, y, range, exclude) {
    let best = null, bd = range * range;
    for (const e of G.enemies) {
      if (e.dead || (exclude && exclude.has(e))) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ───────────────────────── 타워 / 투사체 ─────────────────────────
  function updateTowers(dt) {
    const { board } = G;
    for (const t of G.towers) {
      if (t.type === 'wall') continue;
      t.cd -= dt;
      if (t.cd > 0) continue;
      const st = towerStat(t);
      const cx = t.c * T + T / 2, cy = t.r * T + T / 2;
      // 목표까지 가장 가까운(=가장 위험한) 적 우선
      let target = null, best = Infinity;
      for (const e of G.enemies) {
        if (e.dead || dist2(cx, cy, e.x, e.y) > st.range * st.range) continue;
        const d = board.inside(e.tc, e.tr) ? G.field[board.idx(e.tc, e.tr)] : 999;
        if (d < best) { best = d; target = e; }
      }
      if (!target) continue;
      t.cd = st.rate;
      t.angle = Math.atan2(target.y - cy, target.x - cx);
      const def = TOWERS[t.type];
      G.projectiles.push({
        type: t.type, x: cx, y: cy, target, tx: target.x, ty: target.y,
        speed: def.projSpeed, dmg: st.dmg,
        splash: def.splash ? def.splash * T : 0,
        slow: def.slow ? Math.min(0.85, def.slow + G.mods.slowBonus) : 0, slowDur: def.slowDur || 0,
      });
    }
  }

  function updateProjectiles(dt) {
    for (const p of G.projectiles) {
      if (!p.target.dead) { p.tx = p.target.x; p.ty = p.target.y; }
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const s = p.speed * dt;
      if (d <= s + 4) { p.done = true; projectileHit(p); continue; }
      p.x += dx / d * s; p.y += dy / d * s;
    }
    G.projectiles = G.projectiles.filter(p => !p.done);
  }

  function projectileHit(p) {
    const apply = e => {
      damageEnemy(e, p.dmg, false);
      if (p.slow) {
        e.slowAmt = e.slowT > 0 ? Math.max(e.slowAmt, p.slow) : p.slow;
        e.slowT = p.slowDur;
      }
    };
    if (p.splash) {
      G.effects.push({ type: 'ring', x: p.tx, y: p.ty, r0: 6, r1: p.splash, t: 0, life: 0.25, color: '#ffb74d' });
      for (const e of G.enemies) if (!e.dead && dist2(e.x, e.y, p.tx, p.ty) < p.splash ** 2) apply(e);
    } else if (!p.target.dead) {
      apply(p.target);
    }
  }

  // ───────────────────────── 웨이브 ─────────────────────────
  function startWave() {
    if (G.phase !== 'build' || G.modal) return;
    G.wave++;
    G.hpMul = waveHpMul(G.wave);
    G.spawnQueue = buildWave(G.wave);
    G.spawnTimer = 0.3;
    G.phase = 'wave';
    G.banner = { text: G.wave % CFG.BOSS_EVERY === 0 ? `웨이브 ${G.wave} — 보스 등장!` : `웨이브 ${G.wave}`, t: 1.6 };
  }

  function updateSpawns(dt) {
    if (!G.spawnQueue.length) return;
    G.spawnTimer -= dt;
    if (G.spawnTimer > 0) return;
    const s = G.spawnQueue.shift();
    spawnEnemy(s.type);
    G.spawnTimer = s.delay;
  }

  function endWave() {
    const bonus = 20 + G.wave * 4;
    const interest = Math.min(25, Math.floor(G.gold * G.mods.interest));
    G.gold += bonus + interest;
    G.phase = 'build';
    G.projectiles = [];
    if (G.wave >= CFG.TOTAL_WAVES) { gameOver(true); return; }
    showRewardModal(bonus, interest);
  }

  // ───────────────────────── 메인 업데이트 ─────────────────────────
  function update(dt) {
    G.time += dt;
    updateSpawns(dt);
    updateHero(dt);
    for (const e of G.enemies) if (!e.dead) updateEnemy(e, dt);
    updateTowers(dt);
    updateProjectiles(dt);
    G.enemies = G.enemies.filter(e => !e.dead);
    updateItems(dt);
    for (const fx of G.effects) fx.t += dt;
    G.effects = G.effects.filter(fx => fx.t < fx.life);
    for (const tx of G.texts) { tx.t += dt; tx.y -= 28 * dt; }
    G.texts = G.texts.filter(tx => tx.t < tx.life);
    if (G.banner) { G.banner.t -= dt; if (G.banner.t <= 0) G.banner = null; }
    if (G.hurtFlash > 0) G.hurtFlash -= dt;
    if (G.phase === 'wave' && !G.spawnQueue.length && !G.enemies.length) endWave();
  }

  function floatText(x, y, text, color) {
    G.texts.push({ x, y, text: String(text), color, t: 0, life: 0.8 });
  }

  // ───────────────────────── 렌더링 ─────────────────────────
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPath(path, color, dash, width) {
    if (!path || path.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.lineDashOffset = -G.time * 30;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    path.forEach((p, i) => {
      const c = tileCenter(p.c, p.r);
      if (i === 0) ctx.moveTo(c.x - T / 2, c.y); else ctx.lineTo(c.x, c.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function drawTower(t) {
    const x = t.c * T, y = t.r * T;
    const def = TOWERS[t.type];
    if (t.type === 'wall') {
      ctx.fillStyle = '#7d8691';
      roundRect(x + 2, y + 2, T - 4, T - 4, 4); ctx.fill();
      ctx.strokeStyle = '#5c646e'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + T / 2); ctx.lineTo(x + T - 2, y + T / 2);
      ctx.moveTo(x + T / 2, y + 2); ctx.lineTo(x + T / 2, y + T / 2);
      ctx.moveTo(x + T / 4, y + T / 2); ctx.lineTo(x + T / 4, y + T - 2);
      ctx.moveTo(x + T * 3 / 4, y + T / 2); ctx.lineTo(x + T * 3 / 4, y + T - 2);
      ctx.stroke();
      return;
    }
    ctx.fillStyle = '#2d3545';
    roundRect(x + 2, y + 2, T - 4, T - 4, 6); ctx.fill();
    ctx.strokeStyle = def.color; ctx.lineWidth = 2;
    roundRect(x + 2, y + 2, T - 4, T - 4, 6); ctx.stroke();
    const cx = x + T / 2, cy = y + T / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t.angle);
    ctx.fillStyle = def.color;
    if (t.type === 'arrow') {
      ctx.beginPath(); ctx.moveTo(13, 0); ctx.lineTo(-8, -8); ctx.lineTo(-4, 0); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill();
    } else if (t.type === 'cannon') {
      ctx.fillRect(0, -4, 15, 8);
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
    } else if (t.type === 'frost') {
      ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(0, -11); ctx.lineTo(-11, 0); ctx.lineTo(0, 11); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e1f5fe';
      ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    for (let i = 0; i < t.lv; i++) {
      ctx.fillStyle = '#ffd54f';
      ctx.beginPath(); ctx.arc(x + 8 + i * 7, y + T - 7, 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawBar(x, y, w, ratio, color) {
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 2, y, w * Math.max(0, ratio), 3);
  }

  function drawItem(it) {
    const y = it.y + Math.sin(G.time * 4 + it.bob) * 2;
    if (it.t < 3 && Math.floor(it.t * 8) % 2 === 0) return; // 사라지기 전 깜빡임
    if (it.type === 'coin') {
      ctx.fillStyle = '#ffd54f';
      ctx.beginPath(); ctx.arc(it.x, y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 1.5; ctx.stroke();
    } else if (it.type === 'potion') {
      ctx.fillStyle = '#ef5350';
      roundRect(it.x - 6, y - 6, 12, 12, 3); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(it.x - 1.5, y - 4, 3, 8); ctx.fillRect(it.x - 4, y - 1.5, 8, 3);
    } else {
      ctx.save();
      ctx.shadowColor = '#d18cff'; ctx.shadowBlur = 12;
      ctx.fillStyle = '#b36bff';
      ctx.beginPath(); ctx.moveTo(it.x, y - 9); ctx.lineTo(it.x + 7, y); ctx.lineTo(it.x, y + 9); ctx.lineTo(it.x - 7, y); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  function render() {
    const { board } = G;
    // 바닥
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#232a37' : '#262e3c';
        ctx.fillRect(c * T, r * T, T, T);
      }
    }
    // 현재 적 경로
    drawPath(G.path, 'rgba(255,255,255,.28)', [6, 8], 3);

    // 입구/기지
    const sp = tileCenter(board.spawn.c, board.spawn.r);
    ctx.fillStyle = 'rgba(224,85,85,.25)'; ctx.fillRect(board.spawn.c * T, board.spawn.r * T, T, T);
    ctx.strokeStyle = '#e05555'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, 12 + Math.sin(G.time * 3) * 2, 0, Math.PI * 2); ctx.stroke();
    const gp = tileCenter(board.goal.c, board.goal.r);
    ctx.fillStyle = '#3f7fd6'; roundRect(gp.x - 15, gp.y - 15, 30, 30, 5); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(G.lives, gp.x, gp.y + 1);

    // 바위
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board.cells[board.idx(c, r)] !== CELL_ROCK) continue;
        ctx.fillStyle = '#454b55';
        roundRect(c * T + 3, r * T + 3, T - 6, T - 6, 10); ctx.fill();
        ctx.fillStyle = '#51575f';
        roundRect(c * T + 8, r * T + 6, T - 18, T - 18, 7); ctx.fill();
      }
    }

    for (const t of G.towers) drawTower(t);
    for (const it of G.items) drawItem(it);

    // 적
    for (const e of G.enemies) {
      ctx.fillStyle = e.hitFlash > 0 ? '#fff' : e.def.color;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.def.r, 0, Math.PI * 2); ctx.fill();
      if (e.slowT > 0) { ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 2; ctx.stroke(); }
      if (e.type === 'boss') { ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 2; ctx.stroke(); }
      if (e.hp < e.maxHp) drawBar(e.x, e.y - e.def.r - 7, e.def.r * 2 + 4, e.hp / e.maxHp, '#ff5252');
    }

    // 영웅
    const h = G.hero;
    if (!h.dead) {
      ctx.strokeStyle = 'rgba(255,224,130,.12)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(h.x, h.y, heroStat.range(), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffca28';
      ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.strokeStyle = '#6d4c00'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(h.x, h.y);
      ctx.lineTo(h.x + Math.cos(h.facing) * (h.r + 6), h.y + Math.sin(h.facing) * (h.r + 6)); ctx.stroke();
      drawBar(h.x, h.y - h.r - 9, 30, h.hp / h.maxHp, '#66bb6a');
      if (h.skillCd > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - h.skillCd / heroStat.skillCd())); ctx.stroke();
      }
    }

    // 투사체
    for (const p of G.projectiles) {
      ctx.fillStyle = p.type === 'cannon' ? '#333' : p.type === 'frost' ? '#b3e5fc' : '#c5e1a5';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.type === 'cannon' ? 5 : 3, 0, Math.PI * 2); ctx.fill();
    }

    // 이펙트
    for (const fx of G.effects) {
      const k = fx.t / fx.life;
      if (fx.type === 'ring') {
        ctx.strokeStyle = fx.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = fx.width || 2;
        ctx.beginPath(); ctx.arc(fx.x, fx.y, fx.r0 + (fx.r1 - fx.r0) * k, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (fx.type === 'bolt') {
        ctx.strokeStyle = `rgba(255,236,150,${1 - k})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(fx.x1, fx.y1); ctx.lineTo(fx.x2, fx.y2); ctx.stroke();
      }
    }

    drawHover();
    drawSelection();

    // 떠오르는 글자
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 12px system-ui';
    for (const tx of G.texts) {
      ctx.globalAlpha = 1 - tx.t / tx.life;
      ctx.fillStyle = '#000'; ctx.fillText(tx.text, tx.x + 1, tx.y + 1);
      ctx.fillStyle = tx.color; ctx.fillText(tx.text, tx.x, tx.y);
    }
    ctx.globalAlpha = 1;

    // 화면 오버레이
    const leakFx = G.effects.find(fx => fx.type === 'screen');
    if (leakFx) { ctx.fillStyle = `rgba(255,0,0,${0.25 * (1 - leakFx.t / leakFx.life)})`; ctx.fillRect(0, 0, W, H); }
    if (G.hurtFlash > 0) { ctx.strokeStyle = 'rgba(255,60,60,.5)'; ctx.lineWidth = 8; ctx.strokeRect(0, 0, W, H); }
    if (G.banner) {
      ctx.globalAlpha = Math.min(1, G.banner.t * 2);
      ctx.fillStyle = 'rgba(10,14,22,.8)'; roundRect(W / 2 - 230, 14, 460, 36, 10); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px system-ui'; ctx.fillText(G.banner.text, W / 2, 33);
      ctx.globalAlpha = 1;
    }
    if (h.dead) {
      ctx.fillStyle = '#ff8a80'; ctx.font = 'bold 18px system-ui';
      ctx.fillText(`영웅 부활까지 ${Math.ceil(h.respawn)}초`, W / 2, H - 24);
    }
    if (G.paused && !G.modal) {
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 32px system-ui'; ctx.fillText('일시정지', W / 2, H / 2);
    }
  }

  function drawHover() {
    const hv = G.hover;
    if (!hv || !G.tool || !G.board.inside(hv.c, hv.r)) return;
    if (G.board.cells[G.board.idx(hv.c, hv.r)] === CELL_TOWER) return; // 타워 위 = 선택 모드
    const res = canPlace(hv.c, hv.r, G.tool);
    const x = hv.c * T, y = hv.r * T;
    if (res.ok) {
      const newPath = G.board.pathFrom(res.field, G.board.spawn.c, G.board.spawn.r);
      drawPath(newPath, 'rgba(255,213,79,.85)', [4, 6], 2);
      const diff = newPath.length - G.path.length;
      ctx.fillStyle = 'rgba(102,187,106,.35)'; ctx.fillRect(x, y, T, T);
      ctx.strokeStyle = '#66bb6a'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, T - 2, T - 2);
      const def = TOWERS[G.tool];
      if (def.range) {
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2, def.range * G.mods.towerRange * T, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (diff !== 0) {
        ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
        ctx.fillStyle = diff > 0 ? '#ffd54f' : '#90caf9';
        ctx.fillText(`경로 ${diff > 0 ? '+' : ''}${diff}칸`, x + T / 2, y - 8);
      }
    } else {
      ctx.fillStyle = 'rgba(239,83,80,.35)'; ctx.fillRect(x, y, T, T);
      ctx.strokeStyle = '#ef5350'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, T - 2, T - 2);
      if (res.reason) {
        ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
        ctx.fillStyle = '#ff8a80'; ctx.fillText(res.reason, x + T / 2, y - 8);
      }
    }
  }

  function drawSelection() {
    const t = G.selected;
    if (!t) return;
    const x = t.c * T, y = t.r * T;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x, y, T, T);
    if (t.type !== 'wall') {
      ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2, towerStat(t).range, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  // ───────────────────────── UI (DOM) ─────────────────────────
  function buildSidebar() {
    const list = $('build-list');
    list.innerHTML = '';
    for (const [type, def] of Object.entries(TOWERS)) {
      const b = document.createElement('button');
      b.className = 'build-btn';
      b.dataset.type = type;
      b.innerHTML = `<span class="swatch" style="background:${def.color}"></span>
        <span class="b-name">${def.name} <kbd>${def.key}</kbd></span>
        <span class="b-cost">${def.cost}G</span>
        <span class="b-desc">${def.desc}</span>`;
      b.onclick = () => selectTool(type);
      list.appendChild(b);
    }
    buildRelicList();
    refreshSelPanel();
  }

  function buildRelicList() {
    const el = $('relic-list');
    if (!G.relics.length) { el.innerHTML = '<p class="muted">아직 없음. 적 처치 / 웨이브 보상으로 획득.</p>'; return; }
    el.innerHTML = G.relics.map(r => {
      const d = RELIC_BY_ID[r.id];
      return `<div class="relic" title="${d.desc}"><span class="r-icon">${d.icon}</span><span>${d.name}${r.count > 1 ? ` ×${r.count}` : ''}</span><span class="r-desc">${d.desc}</span></div>`;
    }).join('');
  }

  function selectTool(type) {
    G.tool = G.tool === type ? null : type;
    G.selected = null;
    refreshSelPanel();
  }

  function refreshSelPanel() {
    const panel = $('sel-panel');
    const t = G.selected;
    if (!t) { panel.hidden = true; return; }
    panel.hidden = false;
    const def = TOWERS[t.type];
    const refund = Math.floor(t.invested * CFG.SELL_RATIO);
    let html = `<h3>${def.name} <span class="muted">Lv.${t.lv}</span></h3>`;
    if (t.type !== 'wall') {
      const st = towerStat(t);
      html += `<p class="muted">피해 ${st.dmg.toFixed(1)} · 사거리 ${(st.range / T).toFixed(1)}칸 · 공격간격 ${st.rate.toFixed(2)}초</p>`;
    }
    html += '<div class="row">';
    if (t.type !== 'wall' && t.lv < TOWER_MAX_LV) {
      html += `<button id="btn-up" ${G.gold < upgradeCost(t) ? 'disabled' : ''}>강화 (${upgradeCost(t)}G) <kbd>U</kbd></button>`;
    }
    html += `<button id="btn-sell" class="danger">판매 (+${refund}G) <kbd>X</kbd></button></div>`;
    panel.innerHTML = html;
    const up = $('btn-up');
    if (up) up.onclick = () => { upgradeTower(t); refreshSelPanel(); };
    $('btn-sell').onclick = () => sellTower(t);
  }

  let hudTimer = 0;
  function updateHUD() {
    $('s-wave').textContent = `${G.wave}/${CFG.TOTAL_WAVES}`;
    $('s-gold').textContent = G.gold;
    $('s-lives').textContent = G.lives;
    $('s-path').textContent = G.path ? `${G.path.length}칸` : '-';
    $('s-kills').textContent = G.kills;
    const wb = $('btn-wave');
    wb.disabled = G.phase !== 'build';
    wb.textContent = G.phase === 'build' ? `웨이브 ${G.wave + 1} 시작 ▶` : `진행 중… (${G.enemies.length + G.spawnQueue.length})`;
    $('btn-speed').textContent = `속도 x${G.speed}`;
    $('btn-pause').textContent = G.paused ? '계속 ▶' : '일시정지';
    for (const b of document.querySelectorAll('.build-btn')) {
      b.classList.toggle('active', b.dataset.type === G.tool);
      b.classList.toggle('poor', G.gold < TOWERS[b.dataset.type].cost);
    }
    const h = G.hero;
    $('hero-stats').innerHTML = `
      <div class="hp-bar"><div style="width:${(h.hp / h.maxHp) * 100}%"></div><span>${Math.ceil(h.hp)} / ${h.maxHp}</span></div>
      <div class="grid2">
        <span>공격력</span><b>${heroStat.dmg().toFixed(1)}</b>
        <span>공격간격</span><b>${heroStat.rate().toFixed(2)}초</b>
        <span>이동속도</span><b>${Math.round(heroStat.speed())}</b>
        <span>스킬(Space)</span><b>${h.skillCd > 0 ? h.skillCd.toFixed(1) + '초' : '준비됨'}</b>
      </div>`;
    const up = $('btn-up');
    if (up && G.selected) up.disabled = G.gold < upgradeCost(G.selected);
  }

  // ───────────────────────── 모달 ─────────────────────────
  function showModal(title, desc, choices) {
    G.modal = true;
    $('modal-title').textContent = title;
    $('modal-desc').innerHTML = desc;
    const box = $('modal-choices');
    box.innerHTML = '';
    for (const ch of choices) {
      const b = document.createElement('button');
      b.className = ch.cls || '';
      b.innerHTML = ch.html;
      b.onclick = () => { hideModal(); ch.onClick(); };
      box.appendChild(b);
    }
    $('modal').hidden = false;
  }

  function hideModal() {
    $('modal').hidden = true;
    if (G) G.modal = false;
  }

  function showRewardModal(bonus, interest) {
    const pool = [...RELICS].sort(() => Math.random() - 0.5).slice(0, 3);
    const choices = pool.map(r => ({
      cls: 'card',
      html: `<span class="c-icon">${r.icon}</span><b>${r.name}</b><span>${r.desc}</span>`,
      onClick: () => addRelic(r.id),
    }));
    choices.push({ cls: 'skip', html: `건너뛰고 +${CFG.SKIP_REWARD_GOLD} 골드`, onClick: () => { G.gold += CFG.SKIP_REWARD_GOLD; } });
    showModal(`웨이브 ${G.wave} 클리어!`,
      `보상 골드 +${bonus}${interest ? `, 이자 +${interest}` : ''}. 유물을 하나 고르세요.`, choices);
  }

  function readBest() {
    try { return JSON.parse(localStorage.getItem('mazeHeroTD.best')) || { wave: 0 }; } catch { return { wave: 0 }; }
  }

  function gameOver(win) {
    G.phase = 'over';
    const best = readBest();
    const cleared = win ? G.wave : G.wave - 1;
    const isBest = cleared > best.wave;
    if (isBest) { try { localStorage.setItem('mazeHeroTD.best', JSON.stringify({ wave: cleared })); } catch { /* 저장 불가 환경 */ } }
    showModal(win ? '승리!' : '기지 함락',
      `클리어한 웨이브: <b>${cleared}</b> · 처치 ${G.kills} · 유물 ${G.relics.reduce((s, r) => s + r.count, 0)}개<br>` +
      (isBest ? '🎉 최고 기록 갱신!' : `최고 기록: ${best.wave} 웨이브`),
      [{ cls: 'primary', html: '새 런 시작', onClick: newGame }]);
  }

  // ───────────────────────── 입력 ─────────────────────────
  function canvasPos(ev) {
    const rect = canvas.getBoundingClientRect();
    return { x: (ev.clientX - rect.left) * (W / rect.width), y: (ev.clientY - rect.top) * (H / rect.height) };
  }

  canvas.addEventListener('mousemove', ev => {
    const p = canvasPos(ev);
    G.hover = { c: Math.floor(p.x / T), r: Math.floor(p.y / T) };
  });
  canvas.addEventListener('mouseleave', () => { G.hover = null; });
  canvas.addEventListener('contextmenu', ev => ev.preventDefault());
  canvas.addEventListener('mousedown', ev => {
    if (G.modal || G.phase === 'over') return;
    const p = canvasPos(ev);
    if (ev.button === 2) { heroMoveTo(p.x, p.y); return; }
    if (ev.button !== 0) return;
    const c = Math.floor(p.x / T), r = Math.floor(p.y / T);
    const { board } = G;
    if (!board.inside(c, r)) return;
    const t = board.towers[board.idx(c, r)];
    if (t) { G.selected = t; refreshSelPanel(); return; }
    if (G.tool) placeTower(c, r);
    else { G.selected = null; refreshSelPanel(); }
  });

  window.addEventListener('keydown', ev => {
    if (ev.target.tagName === 'INPUT') return;
    keys.add(ev.code);
    if (G.modal) return;
    const tool = Object.entries(TOWERS).find(([, d]) => d.key === ev.key);
    if (tool) { selectTool(tool[0]); return; }
    switch (ev.code) {
      case 'Space': ev.preventDefault(); useSkill(); break;
      case 'Enter': case 'KeyN': startWave(); break;
      case 'KeyP': G.paused = !G.paused; break;
      case 'KeyF': cycleSpeed(); break;
      case 'Escape': G.tool = null; G.selected = null; refreshSelPanel(); break;
      case 'KeyU': if (G.selected) { upgradeTower(G.selected); refreshSelPanel(); } break;
      case 'KeyX': case 'Delete': if (G.selected) sellTower(G.selected); break;
    }
    if (ev.code.startsWith('Arrow')) ev.preventDefault();
  });
  window.addEventListener('keyup', ev => keys.delete(ev.code));
  window.addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => { if (document.hidden && G) G.paused = true; });

  function cycleSpeed() { G.speed = G.speed === 1 ? 2 : G.speed === 2 ? 3 : 1; }
  $('btn-wave').onclick = startWave;
  $('btn-pause').onclick = () => { G.paused = !G.paused; };
  $('btn-speed').onclick = cycleSpeed;

  // ───────────────────────── 루프 ─────────────────────────
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!G.paused && !G.modal && G.phase !== 'over') {
      for (let i = 0; i < G.speed; i++) update(dt);
    }
    render();
    hudTimer -= dt;
    if (hudTimer <= 0) { hudTimer = 0.1; updateHUD(); }
    requestAnimationFrame(frame);
  }

  newGame();
  const best = readBest();
  showModal('미로 영웅 TD (가제)',
    `타워로 <b>미로</b>를 짜서 적의 길을 늘리고, <b>영웅</b>을 직접 움직여 싸우세요.<br>
     적이 떨어뜨린 <b>아이템</b>을 주워 강해지고, 웨이브마다 <b>유물</b>을 골라 런을 완성하세요.<br><br>
     <span class="muted">WASD/방향키 이동 · 우클릭 지점 이동 · Space 스킬 · 1~4 건설 · Enter 웨이브 시작</span>` +
     (best.wave ? `<br><span class="muted">최고 기록: ${best.wave} 웨이브</span>` : ''),
    [{ cls: 'primary', html: '런 시작', onClick: () => {} }]);
  requestAnimationFrame(frame);
})();
