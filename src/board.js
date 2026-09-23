'use strict';
// 격자 맵 + 길찾기. 적은 목표 지점에서 역방향 BFS로 만든 거리장(flow field)을 따라 움직인다.

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const CELL_EMPTY = 0, CELL_ROCK = 1, CELL_TOWER = 2;

class Board {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.cells = new Uint8Array(cols * rows);
    this.towers = new Array(cols * rows).fill(null);
    const mid = Math.floor(rows / 2);
    this.spawn = { c: 0, r: mid };
    this.goal = { c: cols - 1, r: mid };
  }

  idx(c, r) { return r * this.cols + c; }
  inside(c, r) { return c >= 0 && r >= 0 && c < this.cols && r < this.rows; }
  isOpen(c, r) { return this.inside(c, r) && this.cells[this.idx(c, r)] === CELL_EMPTY; }
  isSpecial(c, r) {
    return (c === this.spawn.c && r === this.spawn.r) || (c === this.goal.c && r === this.goal.r);
  }

  // 목표까지의 칸 수. -1 = 도달 불가. extraBlock: 해당 칸을 막았다고 가정하고 계산.
  computeField(extraBlock = -1) {
    const n = this.cols * this.rows;
    const dist = new Int32Array(n).fill(-1);
    const q = new Int32Array(n);
    let h = 0, t = 0;
    const g = this.idx(this.goal.c, this.goal.r);
    dist[g] = 0;
    q[t++] = g;
    while (h < t) {
      const i = q[h++];
      const c = i % this.cols, r = (i / this.cols) | 0;
      for (const [dc, dr] of DIRS) {
        const nc = c + dc, nr = r + dr;
        if (!this.inside(nc, nr)) continue;
        const j = this.idx(nc, nr);
        if (dist[j] !== -1 || this.cells[j] !== CELL_EMPTY || j === extraBlock) continue;
        dist[j] = dist[i] + 1;
        q[t++] = j;
      }
    }
    return dist;
  }

  // 거리장을 따라가는 다음 칸. prefer: 직진 방향을 우선해 경로가 덜 지그재그하게.
  nextStep(field, c, r, prefer) {
    const cur = field[this.idx(c, r)];
    if (cur <= 0) return null;
    let best = null;
    for (const [dc, dr] of DIRS) {
      const nc = c + dc, nr = r + dr;
      if (!this.inside(nc, nr)) continue;
      if (field[this.idx(nc, nr)] !== cur - 1) continue;
      if (prefer && dc === prefer[0] && dr === prefer[1]) return { c: nc, r: nr, dir: [dc, dr] };
      if (!best) best = { c: nc, r: nr, dir: [dc, dr] };
    }
    return best;
  }

  pathFrom(field, c, r) {
    if (field[this.idx(c, r)] < 0) return null;
    const path = [{ c, r }];
    let dir = [1, 0];
    let step;
    while ((step = this.nextStep(field, c, r, dir))) {
      c = step.c; r = step.r; dir = step.dir;
      path.push({ c, r });
    }
    return path;
  }

  // 영웅 이동용 BFS (시작 → 도착 칸 목록, 시작 칸 제외).
  findPath(from, to) {
    if (!this.isOpen(to.c, to.r)) return null;
    const n = this.cols * this.rows;
    const prev = new Int32Array(n).fill(-2);
    const s = this.idx(from.c, from.r), e = this.idx(to.c, to.r);
    const q = [s];
    prev[s] = -1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      if (i === e) break;
      const c = i % this.cols, r = (i / this.cols) | 0;
      for (const [dc, dr] of DIRS) {
        const nc = c + dc, nr = r + dr;
        if (!this.isOpen(nc, nr)) continue;
        const j = this.idx(nc, nr);
        if (prev[j] !== -2) continue;
        prev[j] = i;
        q.push(j);
      }
    }
    if (prev[e] === -2) return null;
    const out = [];
    for (let i = e; i !== s && i !== -1; i = prev[i]) {
      out.push({ c: i % this.cols, r: (i / this.cols) | 0 });
    }
    return out.reverse();
  }

  generateRocks(count) {
    const spawnIdx = this.idx(this.spawn.c, this.spawn.r);
    let placed = 0, tries = 0;
    while (placed < count && tries++ < 500) {
      const c = 2 + Math.floor(Math.random() * (this.cols - 4));
      const r = Math.floor(Math.random() * this.rows);
      const i = this.idx(c, r);
      if (this.cells[i] !== CELL_EMPTY) continue;
      this.cells[i] = CELL_ROCK;
      if (this.computeField()[spawnIdx] < 0) { this.cells[i] = CELL_EMPTY; continue; }
      placed++;
    }
  }
}
