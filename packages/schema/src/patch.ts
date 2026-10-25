// Fixes are RFC 6902 patches over a Scene, never full rewrites, so guards can diff them.
import { z } from "zod";
import { Scene } from "./index.js";

export const PatchOp = z.object({
  op: z.enum(["add", "replace", "remove"]),
  /** JSON pointer, e.g. /objects/2/position/0 */
  path: z.string(),
  value: z.unknown().optional(),
});

/**
 * Small by design: a fix is a handful of leaf edits (a coordinate, a size, a colour),
 * so guards can review it and a bad guess does bounded damage.
 */
export const MAX_PATCH_OPS = 12;
export const Patch = z.array(PatchOp).min(1).max(MAX_PATCH_OPS);
export type Patch = z.infer<typeof Patch>;

const unescape = (s: string) => s.replace(/~1/g, "/").replace(/~0/g, "~");
// Patch paths come from a model, so never let them reach the prototype chain.
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Decor is cheap to draw but should stay a garnish, not the scene. */
export const MAX_DECOR = 60;

/** Largest coordinate or size we accept, in metres. A room is never this big. */
const MAX_EXTENT = 100;

/**
 * Checks the things the zod shape cannot: unique ids, sane sizes and positions,
 * interactions that point at real objects, and verbs that match what the object can do.
 * Returns human-readable problems (empty = fine); guards show these as the reject reason.
 */
export function checkScene(scene: Scene): string[] {
  const problems: string[] = [];
  const badColours = collectColours(scene).filter((c) => !/^#[0-9a-f]{3,8}$/i.test(c));
  if (badColours.length) problems.push(`invalid colour value ${JSON.stringify(badColours[0])} (use #rrggbb)`);
  const byId = new Map<string, Scene["objects"][number]>();
  for (const o of scene.objects) {
    if (byId.has(o.id)) problems.push(`duplicate object id ${o.id}`);
    byId.set(o.id, o);
    if (o.size.some((n) => !(n > 0 && n <= MAX_EXTENT))) problems.push(`${o.id}: size must be in (0, ${MAX_EXTENT}] m`);
    if (o.position.some((n) => Math.abs(n) > MAX_EXTENT)) problems.push(`${o.id}: position out of range`);
    if (o.articulation?.kind === "hinge" && o.articulation.range[0] === o.articulation.range[1]) {
      problems.push(`${o.id}: hinge range is zero, it could never open`);
    }
  }
  if (scene.objects.filter((o) => o.decor).length > MAX_DECOR) problems.push(`more than ${MAX_DECOR} decor objects`);
  for (const o of scene.objects) {
    if (o.decor && (o.articulation || o.physics)) problems.push(`${o.id}: decor cannot be articulated or have physics`);
  }
  for (const it of scene.interactions) {
    const target = byId.get(it.target);
    if (!target) problems.push(`interaction ${it.verb} targets missing object ${it.target}`);
    else if (it.verb === "open" && !["hinge", "slide"].includes(target.articulation?.kind ?? "")) {
      problems.push(`${it.target}: cannot open without a hinge or slide`);
    } else if (it.verb === "toggle" && target.articulation?.kind !== "switch") {
      problems.push(`${it.target}: cannot toggle without a switch`);
    }
  }
  problems.push(...checkLayout(scene));
  return problems;
}

// ---- layout geometry (floor plan, metres) ----
type Obj = Scene["objects"][number];
interface Rect { x: number; z: number; hx: number; hz: number; rot: number }

/** Footprint of an object on the floor; its local x axis is (cos, -sin), local z is (sin, cos) in world x,z (three.js rotation about y). */
const footprint = (o: Obj): Rect => ({ x: o.position[0], z: o.position[2], hx: o.size[0] / 2, hz: o.size[2] / 2, rot: o.rotationY });

/** Minimum translation that separates a from b (SAT on two rotated rectangles); null if they do not overlap. depth = how far they interpenetrate. */
export function separation(a: Rect, b: Rect): { depth: number; dx: number; dz: number } | null {
  const axes = [a.rot, b.rot].flatMap((r) => [[Math.cos(r), -Math.sin(r)], [Math.sin(r), Math.cos(r)]]);
  const radius = (r: Rect, [ax, az]: number[]) => {
    const c = Math.cos(r.rot), s = Math.sin(r.rot);
    return r.hx * Math.abs(ax * c - az * s) + r.hz * Math.abs(ax * s + az * c);
  };
  let best: { depth: number; dx: number; dz: number } | null = null;
  for (const [ax, az] of axes) {
    const d = (b.x - a.x) * ax + (b.z - a.z) * az;
    const depth = radius(a, [ax, az]) + radius(b, [ax, az]) - Math.abs(d);
    if (depth <= 0) return null;
    if (!best || depth < best.depth) best = { depth, dx: ax * Math.sign(d || 1), dz: az * Math.sign(d || 1) };
  }
  return best; // push b along (dx, dz) by depth to clear a
}

/** Objects that take up floor space and block walking; rugs lie flat, drawers sit inside furniture, decor is garnish, doors are checked separately. */
const solid = (o: Obj) => !o.decor && o.type !== "rug" && o.type !== "door" && o.type !== "drawer";
/** A door a person walks through, as opposed to a cabinet door (also type "door", but small). */
export const isRoomDoor = (o: Obj) => o.type === "door" && o.size[1] >= 1.6;
const OVERLAP_TOLERANCE = 0.1; // chairs tuck under tables a little
export const DOOR_CLEARANCE = 0.45; // metres kept free on each side of a door
/** The patch of floor a door needs clear on both sides, as a rectangle in the door's frame. */
export const doorZone = (d: Obj): Rect => ({ x: d.position[0], z: d.position[2], hx: d.size[0] / 2, hz: DOOR_CLEARANCE, rot: d.rotationY });

/** Layout problems that are physically impossible: overlapping furniture, blocked doors, objects outside the room, runaway parts. */
export function checkLayout(scene: Scene): string[] {
  const problems: string[] = [];
  const { width: W, depth: D } = scene.room;
  const objs = scene.objects.filter(solid);
  for (let i = 0; i < objs.length; i++) {
    const a = objs[i];
    const r = footprint(a);
    const c = Math.cos(r.rot), s = Math.sin(r.rot);
    const reachX = r.hx * Math.abs(c) + r.hz * Math.abs(s), reachZ = r.hx * Math.abs(s) + r.hz * Math.abs(c);
    if (Math.abs(r.x) + reachX > W / 2 + 0.05 || Math.abs(r.z) + reachZ > D / 2 + 0.05) problems.push(`${a.id}: sticks out of the room`);
    for (let j = i + 1; j < objs.length; j++) {
      const b = objs[j];
      const lo = Math.max(a.position[1], b.position[1]), hi = Math.min(a.position[1] + a.size[1], b.position[1] + b.size[1]);
      if (hi - lo < 0.05) continue; // one rests on the other
      const sep = separation(r, footprint(b));
      if (sep && sep.depth > OVERLAP_TOLERANCE) problems.push(`${a.id} and ${b.id} overlap by ${sep.depth.toFixed(2)} m`);
    }
    for (const d of scene.objects.filter(isRoomDoor)) {
      if (a.position[1] > 1.8) continue;
      const sep = separation(doorZone(d), r);
      if (sep && sep.depth > 0.02) problems.push(`${a.id} blocks ${d.id} (needs ${DOOR_CLEARANCE} m clear in front of it)`);
    }
  }
  for (const o of scene.objects) {
    if (o.type === "door" || !o.parts?.length) continue;
    const [w, h, d] = o.size;
    const bad = o.parts.filter((p) => Math.abs(p.offset[0]) + p.size[0] / 2 > w * 0.75 || Math.abs(p.offset[2]) + p.size[2] / 2 > d * 0.75 || p.offset[1] + p.size[1] / 2 > h * 1.3);
    if (bad.length) problems.push(`${o.id}: ${bad.length} part(s) stick far outside its ${w}x${h}x${d} box`);
  }
  return problems;
}

/** Applies the patch to a copy and re-validates; throws if the result is not a valid Scene. */
export function applyPatch(scene: Scene, patch: Patch): Scene {
  const next = structuredClone(scene) as any;
  for (const { op, path, value } of Patch.parse(patch)) {
    const keys = path.split("/").slice(1).map(unescape);
    if (keys.some((k) => FORBIDDEN_KEYS.has(k))) throw new Error(`forbidden path: ${path}`);
    const last = keys.pop();
    if (last === undefined) throw new Error(`bad path: ${path}`);
    let node = next;
    for (const k of keys) {
      node = node?.[k];
      if (node === undefined) throw new Error(`path not found: ${path}`);
    }
    if (Array.isArray(node)) {
      const i = last === "-" ? node.length : Number(last);
      if (op === "add") node.splice(i, 0, value);
      else if (op === "replace") node[i] = value;
      else node.splice(i, 1);
    } else if (op === "remove") delete node[last];
    else node[last] = value;
  }
  const result = Scene.parse(next);
  const problems = checkScene(result);
  if (problems.length) throw new Error(problems.join("; "));
  return result;
}

/** Object ids in `parent` that are missing from `child` (used by the no-deletion guard). */
export function deletedIds(parent: Scene, child: Scene): string[] {
  const kept = new Set(child.objects.map((o) => o.id));
  return parent.objects.map((o) => o.id).filter((id) => !kept.has(id));
}

function collectColours(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectColours(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (/color$/i.test(k) && typeof v === "string") out.push(v);
      else collectColours(v, out);
    }
  }
  return out;
}
