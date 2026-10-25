// Free floor for the sim robot: a grid over the room marking where a robot of a
// given radius fits, and a start pose clear of furniture and the door's swing.
// Scene coordinates (x, z), y-up, origin at the room's floor center.
import type { Scene, SceneObject } from "@doorway/schema";

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

/** True if scene point (x, z) is within `pad` of the object's rotated footprint. */
export function inFootprint(o: SceneObject, x: number, z: number, pad = 0) {
  const dx = x - o.position[0];
  const dz = z - o.position[2];
  const c = Math.cos(o.rotationY);
  const s = Math.sin(o.rotationY);
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
