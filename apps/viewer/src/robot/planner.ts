// A small but real mobile-robot planner over a reconstructed room:
//   occupancy grid from furniture footprints → clearance (distance) field →
//   A* over cells the robot's body fits through → line-of-sight smoothing.
// Pure TypeScript (no three.js) so it can be tested headless against real runs.
import type { Opening, Scene, SceneObject } from "@doorway/schema";

export const CELL = 0.04; // metres per grid cell
export const ROBOT_RADIUS = 0.17;
const OUTSIDE = 1.0; // how far past a doorway the grid extends, so "leave the room" has a goal

/** Furniture that blocks a floor robot. Rugs are driven over; lamps/monitors sit on tables. */
const BLOCKS = new Set<SceneObject["type"]>(["table", "chair", "cabinet", "shelf", "sofa", "bed", "plant", "box", "other", "drawer"]);
export const blocksRobot = (o: SceneObject) => BLOCKS.has(o.type) && o.position[1] < 0.3;

export type Vec2 = [number, number]; // world x, z

export type Grid = {
  nx: number;
  nz: number;
  x0: number; // world x of cell (0, 0) centre
  z0: number;
  /** 1 = occupied (wall or furniture footprint), 0 = free floor. */
  occ: Uint8Array;
  /** Which object occupies each cell (index into ids), 255 = wall, 0 = none (ids are 1-based). */
  owner: Uint8Array;
  ids: string[];
  /** Distance in metres from each cell centre to the nearest occupied cell. */
  dist: Float32Array;
};

const idx = (g: Grid, i: number, k: number) => k * g.nx + i;
export const cellOf = (g: Grid, [x, z]: Vec2): [number, number] => [Math.round((x - g.x0) / CELL), Math.round((z - g.z0) / CELL)];
export const worldOf = (g: Grid, i: number, k: number): Vec2 => [g.x0 + i * CELL, g.z0 + k * CELL];
const inGrid = (g: Grid, i: number, k: number) => i >= 0 && k >= 0 && i < g.nx && k < g.nz;

function insideBox(o: SceneObject, x: number, z: number, pad = 0) {
  const c = Math.cos(-o.rotationY);
  const s = Math.sin(-o.rotationY);
  const lx = (x - o.position[0]) * c + (z - o.position[2]) * s;
  const lz = -(x - o.position[0]) * s + (z - o.position[2]) * c;
  return Math.abs(lx) <= o.size[0] / 2 + pad && Math.abs(lz) <= o.size[2] / 2 + pad;
}

/** World-space rectangle of floor that a doorway adds outside the room. */
function doorwayRect(room: Scene["room"], o: Opening): [number, number, number, number] {
  const hw = room.width / 2;
  const hd = room.depth / 2;
  const a = o.offset - o.width / 2;
  const b = o.offset + o.width / 2;
  switch (o.wall) {
    case "north": return [a, b, -hd - OUTSIDE, -hd];
    case "south": return [a, b, hd, hd + OUTSIDE];
    case "east": return [hw, hw + OUTSIDE, a, b];
    case "west": return [-hw - OUTSIDE, -hw, a, b];
  }
}

/**
 * Builds the grid. Closed doors block their doorway; `openDoors` lists door ids the robot
 * has opened. A door opening with no door object is a free passage.
 */
export function buildGrid(scene: Scene, openDoors: Set<string> = new Set()): Grid {
  const { width, depth } = scene.room;
  const span = OUTSIDE + 0.2;
  const x0 = -width / 2 - span;
  const z0 = -depth / 2 - span;
  const nx = Math.ceil((width + 2 * span) / CELL) + 1;
  const nz = Math.ceil((depth + 2 * span) / CELL) + 1;
  const g: Grid = { nx, nz, x0, z0, occ: new Uint8Array(nx * nz), owner: new Uint8Array(nx * nz), ids: [], dist: new Float32Array(nx * nz) };
  const doorways = scene.room.openings.filter((o) => o.kind === "door").map((o) => doorwayRect(scene.room, o));
  const blockers = scene.objects.filter(blocksRobot);
  // A closed door blocks the doorway it sits in, and is treated as a thin slab in the opening.
  const closedDoors = scene.objects.filter((o) => o.type === "door" && !openDoors.has(o.id));
  g.ids = [...blockers, ...closedDoors].map((o) => o.id);
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const [x, z] = worldOf(g, i, k);
      const inRoom = Math.abs(x) < width / 2 && Math.abs(z) < depth / 2;
      const inDoorway = doorways.some(([xa, xb, za, zb]) => x > xa && x < xb && z > za && z < zb);
      let owner = 0;
      if (!inRoom && !inDoorway) owner = 255;
      else {
        const hit = blockers.findIndex((o) => insideBox(o, x, z));
        if (hit >= 0) owner = hit + 1;
        const door = closedDoors.findIndex((o) => insideBox(o, x, z, 0.06));
        if (door >= 0 && inDoorway) owner = blockers.length + door + 1;
      }
      g.owner[idx(g, i, k)] = owner;
      g.occ[idx(g, i, k)] = owner ? 1 : 0;
    }
  }
  distanceField(g);
  return g;
}

/** Two-pass chamfer distance transform (metres to the nearest occupied cell). */
function distanceField(g: Grid) {
  const INF = 1e6;
  const d = g.dist;
  for (let n = 0; n < d.length; n++) d[n] = g.occ[n] ? 0 : INF;
  const a = CELL;
  const b = CELL * Math.SQRT2;
  for (let k = 0; k < g.nz; k++)
    for (let i = 0; i < g.nx; i++) {
      const n = idx(g, i, k);
      if (i > 0) d[n] = Math.min(d[n], d[n - 1] + a);
      if (k > 0) {
        d[n] = Math.min(d[n], d[n - g.nx] + a);
        if (i > 0) d[n] = Math.min(d[n], d[n - g.nx - 1] + b);
        if (i < g.nx - 1) d[n] = Math.min(d[n], d[n - g.nx + 1] + b);
      }
    }
  for (let k = g.nz - 1; k >= 0; k--)
    for (let i = g.nx - 1; i >= 0; i--) {
      const n = idx(g, i, k);
      if (i < g.nx - 1) d[n] = Math.min(d[n], d[n + 1] + a);
      if (k < g.nz - 1) {
        d[n] = Math.min(d[n], d[n + g.nx] + a);
        if (i < g.nx - 1) d[n] = Math.min(d[n], d[n + g.nx + 1] + b);
        if (i > 0) d[n] = Math.min(d[n], d[n + g.nx - 1] + b);
      }
    }
}

export const clearanceAt = (g: Grid, p: Vec2) => {
  const [i, k] = cellOf(g, p);
  return inGrid(g, i, k) ? g.dist[idx(g, i, k)] : 0;
};

/** Which object (or "the wall") is closest to a point, by searching outward in the grid. */
export function nearestObstacle(g: Grid, p: Vec2): string {
  const [ci, ck] = cellOf(g, p);
  for (let r = 0; r < 40; r++)
    for (let dk = -r; dk <= r; dk++)
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dk)) !== r) continue;
        const i = ci + di;
        const k = ck + dk;
        if (!inGrid(g, i, k)) continue;
        const o = g.owner[idx(g, i, k)];
        if (o === 255) return "the wall";
        if (o) return g.ids[o - 1];
      }
  return "an obstacle";
}

export type Plan = {
  ok: boolean;
  path: Vec2[];
  length: number;
  /** Smallest gap between the robot's body and anything, along the path (metres). */
  minGap: number;
  expanded: number;
  ms: number;
  reason?: string;
};

/** A* from start to the goal cell nearest `goal` that the robot fits in. */
export function plan(g: Grid, start: Vec2, goal: Vec2, radius = ROBOT_RADIUS): Plan {
  const t0 = performance.now();
  const fits = (n: number) => g.dist[n] >= radius;
  const s = snapFree(g, start, radius);
  const e = snapFree(g, goal, radius);
  if (s === null) return { ok: false, path: [], length: 0, minGap: 0, expanded: 0, ms: 0, reason: "no room for the robot at the start" };
  if (e === null) return { ok: false, path: [], length: 0, minGap: 0, expanded: 0, ms: 0, reason: "the goal is too tight for the robot" };
  const N = g.nx * g.nz;
  const gScore = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new MinHeap();
  const [ei, ek] = [e % g.nx, Math.floor(e / g.nx)];
  const h = (n: number) => Math.hypot((n % g.nx) - ei, Math.floor(n / g.nx) - ek) * CELL;
  gScore[s] = 0;
  heap.push(s, h(s));
  let expanded = 0;
  const steps = [
    [1, 0, CELL], [-1, 0, CELL], [0, 1, CELL], [0, -1, CELL],
    [1, 1, CELL * Math.SQRT2], [1, -1, CELL * Math.SQRT2], [-1, 1, CELL * Math.SQRT2], [-1, -1, CELL * Math.SQRT2],
  ] as const;
  while (heap.size) {
    const n = heap.pop();
    if (closed[n]) continue;
    closed[n] = 1;
    expanded++;
    if (n === e) break;
    const i = n % g.nx;
    const k = Math.floor(n / g.nx);
    for (const [di, dk, c] of steps) {
      const ni = i + di;
      const nk = k + dk;
      if (!inGrid(g, ni, nk)) continue;
      const m = idx(g, ni, nk);
      if (closed[m] || !fits(m)) continue;
      // Prefer to keep a little more space than strictly needed.
      const tight = Math.max(0, radius + 0.12 - g.dist[m]) * 0.6;
      const cand = gScore[n] + c + tight;
      if (cand < gScore[m]) {
        gScore[m] = cand;
        came[m] = n;
        heap.push(m, cand + h(m));
      }
    }
  }
  const ms = performance.now() - t0;
  if (!closed[e]) return { ok: false, path: [], length: 0, minGap: 0, expanded, ms, reason: "no path: the way is blocked" };
  const cells: number[] = [];
  for (let n = e; n !== -1; n = came[n]) cells.push(n);
  cells.reverse();
  const raw = cells.map((n) => worldOf(g, n % g.nx, Math.floor(n / g.nx)));
  const path = smooth(g, raw, radius);
  return { ok: true, path, length: pathLength(path), minGap: minGapAlong(g, path, radius), expanded, ms };
}

function snapFree(g: Grid, p: Vec2, radius: number): number | null {
  const [ci, ck] = cellOf(g, p);
  for (let r = 0; r < 30; r++)
    for (let dk = -r; dk <= r; dk++)
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dk)) !== r) continue;
        const i = ci + di;
        const k = ck + dk;
        if (inGrid(g, i, k) && g.dist[idx(g, i, k)] >= radius) return idx(g, i, k);
      }
  return null;
}

/** Shortcut corners whenever the straight segment keeps the robot clear. */
function smooth(g: Grid, pts: Vec2[], radius: number): Vec2[] {
  if (pts.length < 3) return pts;
  const out: Vec2[] = [pts[0]];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    while (b > a + 1 && !segmentClear(g, pts[a], pts[b], radius)) b--;
    out.push(pts[b]);
    a = b;
  }
  return out;
}

function segmentClear(g: Grid, a: Vec2, b: Vec2, radius: number) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL / 2));
  for (let t = 0; t <= n; t++) {
    const p: Vec2 = [a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n];
    if (clearanceAt(g, p) < radius) return false;
  }
  return true;
}

export const pathLength = (p: Vec2[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);

function minGapAlong(g: Grid, path: Vec2[], radius: number) {
  let m = Infinity;
  for (const p of densify(path)) m = Math.min(m, clearanceAt(g, p) - radius);
  return m;
}

export function densify(path: Vec2[], step = CELL / 2): Vec2[] {
  const out: Vec2[] = [];
  for (let s = 0; s < path.length - 1; s++) {
    const [a, b] = [path[s], path[s + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let t = 0; t < n; t++) out.push([a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n]);
  }
  if (path.length) out.push(path[path.length - 1]);
  return out;
}

/**
 * Replays a path planned in one model of the room against another (e.g. v0's plan in the
 * verified room): where would the robot's body first touch something, and what?
 */
export function firstCollision(g: Grid, path: Vec2[], radius = ROBOT_RADIUS): { at: Vec2; distance: number; what: string } | null {
  let travelled = 0;
  const pts = densify(path);
  for (let n = 0; n < pts.length; n++) {
    if (n) travelled += Math.hypot(pts[n][0] - pts[n - 1][0], pts[n][1] - pts[n - 1][1]);
    if (clearanceAt(g, pts[n]) < radius - 0.01) return { at: pts[n], distance: travelled, what: nearestObstacle(g, pts[n]) };
  }
  return null;
}

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    this.k.push(key);
    this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.v[p] <= this.v[i]) break;
      [this.k[p], this.k[i]] = [this.k[i], this.k[p]];
      [this.v[p], this.v[i]] = [this.v[i], this.v[p]];
      i = p;
    }
  }
  pop(): number {
    const top = this.k[0];
    const lk = this.k.pop()!;
    const lv = this.v.pop()!;
    if (this.k.length) {
      this.k[0] = lk;
      this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.k.length && this.v[l] < this.v[m]) m = l;
        if (r < this.k.length && this.v[r] < this.v[m]) m = r;
        if (m === i) break;
        [this.k[m], this.k[i]] = [this.k[i], this.k[m]];
        [this.v[m], this.v[i]] = [this.v[i], this.v[m]];
        i = m;
      }
    }
    return top;
  }
}
