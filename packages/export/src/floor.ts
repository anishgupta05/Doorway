// Free floor for the sim robot: a grid over the room marking where a robot of a
// given radius fits, and a start pose clear of furniture and the door's swing.
// Scene coordinates (x, z), y-up, origin at the room's floor center.
import type { Scene, SceneObject, Vec3 } from "@doorway/schema";

/** Sim robot footprint radius and height (mast top), in meters. Matches the viewer robot. */
export const ROBOT_RADIUS = 0.17; // same as the viewer planner (apps/viewer/src/robot/planner.ts)
export const ROBOT_HEIGHT = 1.2;

export type FloorGrid = {
  cell: number;
  /** Scene x, z of cell [0][0]'s center. */
  origin: [number, number];
  cols: number;
  rows: number;
  /** free[row][col]: the robot's center can stand here. Row runs along +z, col along +x. */
  free: boolean[][];
};

/** Things the robot bumps into: anything that collides in the export and reaches below the mast top. Doors move, so they're handled apart. */
export const blocks = (o: SceneObject) =>
  o.type !== "door" && o.type !== "rug" && !o.decor && o.physics?.collider !== "none" && o.position[1] < ROBOT_HEIGHT;

/**
 * Where an object really is at rest: a hinge or slide at its closed value (articulation.range[0]),
 * as the viewer draws it. Usually that's its base pose; the model sometimes gives a nonzero
 * closed angle (RoomC hinges whole cabinets at -1.2 rad), which turns the body about its pivot.
 * Vertical hinge axes only, which is all the scene uses. Scene-space position and yaw.
 */
export function restPose(o: SceneObject): { pos: Vec3; yaw: number } {
  const a = o.articulation;
  const [x, y, z] = o.position;
  const c0 = Math.cos(o.rotationY);
  const s0 = Math.sin(o.rotationY);
  const world = ([lx, ly, lz]: number[]): Vec3 => [x + c0 * lx + s0 * lz, y + ly, z - s0 * lx + c0 * lz];
  if (a?.kind === "hinge" && a.range[0] !== 0 && Math.abs(a.axis[1]) > 0.99) {
    const t = Math.sign(a.axis[1]) * a.range[0];
    const [px, , pz] = a.pivot;
    const [ct, st] = [Math.cos(t), Math.sin(t)];
    // Turned by t about the pivot: the origin moves to p - R(t)·p in the object's frame.
    return { pos: world([px - (ct * px + st * pz), 0, pz - (-st * px + ct * pz)]), yaw: o.rotationY + t };
  }
  if (a?.kind === "slide" && a.range[0] !== 0) {
    const n = Math.hypot(...a.axis) || 1;
    return { pos: world(a.axis.map((u) => (u / n) * a.range[0])), yaw: o.rotationY };
  }
  return { pos: o.position, yaw: o.rotationY };
}

/** True if scene point (x, z) is within `pad` of the object's rotated footprint at rest. */
export function inFootprint(o: SceneObject, x: number, z: number, pad = 0) {
  const { pos, yaw } = restPose(o);
  const dx = x - pos[0];
  const dz = z - pos[2];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Inverse of a rotation about +y: world → object-local.
  const lx = c * dx - s * dz;
  const lz = s * dx + c * dz;
  return Math.abs(lx) < o.size[0] / 2 + pad && Math.abs(lz) < o.size[2] / 2 + pad;
}

export function floorGrid(scene: Scene, radius = ROBOT_RADIUS, cell = 0.1): FloorGrid {
  const { width: w, depth: d } = scene.room;
  const cols = Math.floor(w / cell);
  const rows = Math.floor(d / cell);
  const origin: [number, number] = [-w / 2 + cell / 2, -d / 2 + cell / 2];
  const solid = scene.objects.filter(blocks);
  const free = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const x = origin[0] + c * cell;
      const z = origin[1] + r * cell;
      if (Math.abs(x) > w / 2 - radius || Math.abs(z) > d / 2 - radius) return false;
      return !solid.some((o) => inFootprint(o, x, z, radius));
    }),
  );
  return { cell, origin, cols, rows, free };
}

/** World pivot of a hinged object, scene coords. */
export function hingePivot(o: SceneObject): [number, number] | null {
  if (o.articulation?.kind !== "hinge") return null;
  const [px, , pz] = o.articulation.pivot;
  const c = Math.cos(o.rotationY);
  const s = Math.sin(o.rotationY);
  return [o.position[0] + c * px + s * pz, o.position[2] - s * px + c * pz];
}

/**
 * Which way a hinged door swings, and where a pushing robot has to stand. A pushing robot
 * can only open it from the side it swings away from. Scene coords: `swing` is the unit
 * direction the free edge moves as it opens; `approach` is a spot 0.6 m in front of the
 * door's center on the push side; `inward` is true if it opens into the room.
 */
export function doorPush(o: SceneObject): { swing: [number, number]; approach: [number, number]; inward: boolean } | null {
  const a = o.articulation;
  if (a?.kind !== "hinge") return null;
  // Free edge relative to the pivot, local frame: the far side of the door's width.
  const rx = (a.pivot[0] <= 0 ? o.size[0] / 2 : -o.size[0] / 2) - a.pivot[0];
  const rz = -a.pivot[2];
  // Velocity of the free edge for a positive turn about the axis: axis × r (y-up axis assumed vertical).
  const sign = Math.sign(a.axis[1]) * Math.sign(a.range[1] - a.range[0]);
  const [lx, lz] = [rz * sign, -rx * sign];
  const c = Math.cos(o.rotationY);
  const s = Math.sin(o.rotationY);
  const n = Math.hypot(lx, lz) || 1;
  const swing: [number, number] = [(c * lx + s * lz) / n, (-s * lx + c * lz) / n];
  const [cx, , cz] = o.position;
  const approach: [number, number] = [cx - swing[0] * 0.6, cz - swing[1] * 0.6];
  // Into the room if the door swings toward the room's center.
  const inward = swing[0] * -cx + swing[1] * -cz > 0;
  return { swing, approach, inward };
}

/**
 * Free cell nearest the room center, preferring one outside every door's swing. Scene [x, z], facing +x.
 * Only `door` objects count: the model sometimes hinges a whole cabinet, and a 2 m "swing" would cover a small room.
 */
export function robotStart(scene: Scene, grid = floorGrid(scene)): [number, number] {
  const swings = scene.objects.flatMap((o) => {
    const p = o.type === "door" ? hingePivot(o) : null;
    return p ? [{ p, reach: o.size[0] + ROBOT_RADIUS + 0.05 }] : [];
  });
  let best: [number, number] | null = null;
  let bestD = Infinity;
  let fallback: [number, number] | null = null;
  let fallbackD = Infinity;
  grid.free.forEach((row, r) =>
    row.forEach((ok, c) => {
      if (!ok) return;
      const x = grid.origin[0] + c * grid.cell;
      const z = grid.origin[1] + r * grid.cell;
      const dist = Math.hypot(x, z);
      if (dist < fallbackD) [fallback, fallbackD] = [[x, z], dist];
      if (swings.some(({ p, reach }) => Math.hypot(x - p[0], z - p[1]) < reach)) return;
      if (dist < bestD) [best, bestD] = [[x, z], dist];
    }),
  );
  const start = best ?? fallback;
  if (!start) throw new Error("no free floor for the robot");
  return start;
}

/**
 * How far a hinged door can swing open before its leaf hits something standing in the room
 * (rest poses, anything lower than the door's top). Degrees from closed, and what stops it.
 * The same question the MuJoCo check answers, but cheap enough for the task clarifier.
 */
export function doorClearance(scene: Scene, door: SceneObject): { deg: number; blocker: string | null } {
  const a = door.articulation;
  if (a?.kind !== "hinge") return { deg: 0, blocker: null };
  const [closed, open] = a.range;
  const sgn = Math.sign(a.axis[1]) || 1;
  const [px, , pz] = a.pivot;
  const [w, h] = door.size;
  const others = scene.objects.filter((o) => o.id !== door.id && !o.decor && o.type !== "rug" && o.physics?.collider !== "none" && o.position[1] < h);
  const c0 = Math.cos(door.rotationY);
  const s0 = Math.sin(door.rotationY);
  const steps = Math.max(1, Math.ceil(Math.abs(open - closed) / (Math.PI / 180)));
  for (let k = 1; k <= steps; k++) {
    const ang = sgn * (closed + ((open - closed) * k) / steps);
    const [ct, st] = [Math.cos(ang), Math.sin(ang)];
    // Sample the leaf from the pivot out to its free edge, skipping the strip at the hinge itself.
    const far = px <= 0 ? w / 2 : -w / 2;
    for (let u = 0.15; u <= 1.0001; u += 0.05) {
      const lx = u * (far - px);
      const lz = -pz;
      const [qx, qz] = [px + ct * lx + st * lz, pz - st * lx + ct * lz];
      const x = door.position[0] + c0 * qx + s0 * qz;
      const z = door.position[2] - s0 * qx + c0 * qz;
      const hit = others.find((o) => inFootprint(o, x, z));
      if (hit) return { deg: (Math.abs(open - closed) * (k - 1)) / steps * (180 / Math.PI), blocker: hit.id };
    }
  }
  return { deg: (Math.abs(open - closed) * 180) / Math.PI, blocker: null };
}
