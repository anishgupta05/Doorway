// What a robot can be told to do in a room, and where it has to stand to do it.
// Actions come from the scene itself: every door, cabinet door, locker, drawer and switch.
import type { Scene, SceneObject } from "@doorway/schema";
import { gridOf } from "../scene/Fronts";
import { wholeBodyJoint } from "../scene/Placed";
import { ROBOT_RADIUS, type Vec2 } from "./planner";

export type Action = {
  id: string;
  kind: "open" | "switch" | "goto";
  target: string;
  /** Which cabinet leaf / locker door, if the action is about one part. */
  part?: number;
  label: string;
  /** Group for the picker UI. */
  group: "Lockers" | "Doors & cabinets" | "Devices" | "Go to";
};

const isLockers = (o: SceneObject) => !!o.cells || /locker|pigeon|cubby/i.test(`${o.label ?? ""} ${o.id}`);
const name = (o: SceneObject) => (o.label ?? o.id).replace(/_/g, " ");
const LEAF_MAX = 0.6;

export function actionsFor(scene: Scene): Action[] {
  const out: Action[] = [];
  for (const o of scene.objects) {
    if (o.decor) continue;
    const a = o.articulation;
    if (a?.kind === "hinge" && !wholeBodyJoint(o) && isLockers(o)) {
      const [cols, rows] = gridOf(o);
      for (let i = 0; i < cols * rows; i++) out.push({ id: `${o.id}#${i}`, kind: "open", target: o.id, part: i, label: `Open locker ${i + 1}`, group: "Lockers" });
    } else if (a?.kind === "hinge" && !wholeBodyJoint(o)) {
      const n = Math.max(1, Math.ceil(o.size[0] / LEAF_MAX));
      for (let i = 0; i < n; i++) out.push({ id: `${o.id}#${i}`, kind: "open", target: o.id, part: i, label: `Open ${name(o)}, door ${i + 1}`, group: "Doors & cabinets" });
    } else if (a?.kind === "hinge" || a?.kind === "slide") {
      out.push({ id: o.id, kind: "open", target: o.id, label: `Open ${name(o)}`, group: "Doors & cabinets" });
    } else if (a?.kind === "switch") {
      out.push({ id: o.id, kind: "switch", target: o.id, label: `Turn on ${name(o)}`, group: "Devices" });
    }
    if (o.position[1] < 0.3 && ["table", "chair", "cabinet", "shelf", "sofa", "bed", "other", "box"].includes(o.type)) {
      out.push({ id: `goto:${o.id}`, kind: "goto", target: o.id, label: `Go to ${name(o)}`, group: "Go to" });
    }
  }
  return out;
}

/**
 * Where the robot stands to do an action: in front of the exact door it will open, far
 * enough back that the door can swing open without hitting it.
 */
export function standPoint(scene: Scene, action: Action, radius = ROBOT_RADIUS): Vec2 | null {
  const o = scene.objects.find((x) => x.id === action.target);
  if (!o) return null;
  const [w, , d] = o.size;
  let lx = 0;
  let clear = 0.15;
  if (action.part !== undefined && o.articulation?.kind === "hinge") {
    if (isLockers(o)) {
      const [cols] = gridOf(o);
      const c = action.part % cols;
      const cw = w / cols;
      lx = -w / 2 + cw * (c + 0.5);
      clear = cw + 0.05;
    } else {
      const n = Math.max(1, Math.ceil(w / LEAF_MAX));
      const leaf = w / n;
      lx = -w / 2 + leaf * (action.part + 0.5);
      clear = leaf + 0.05;
    }
  } else if (o.articulation?.kind === "slide") {
    clear = Math.max(...o.articulation.range.map(Math.abs)) + 0.08;
  } else if (o.type === "door") {
    clear = w * 0.5 + 0.2;
  }
  // Wall-mounted things (y > 0) are reached from the floor below them.
  const lz = d / 2 + radius + clear;
  const c = Math.cos(o.rotationY);
  const s = Math.sin(o.rotationY);
  return [o.position[0] + lx * c + lz * s, o.position[2] - lx * s + lz * c];
}

/** Joint key the action toggles. */
export const actionJoint = (a: Action) => (a.part !== undefined ? `${a.target}#${a.part}` : a.target);

/** Height of the handle (or switch) the robot has to reach for this action, metres from the floor. */
export function handleHeight(scene: Scene, action: Action): number | null {
  const o = scene.objects.find((x) => x.id === action.target);
  if (!o || action.kind === "goto") return null;
  const [, h] = o.size;
  const y = o.position[1];
  const bottom = h < 1.2 ? 0.08 : 0.03;
  const top = h < 1.2 ? 0.05 : 0.03;
  if (action.part !== undefined && o.articulation?.kind === "hinge") {
    if (isLockers(o)) {
      const [cols, rows] = gridOf(o);
      const r = Math.floor(action.part / cols);
      const ch = (h - bottom - top) / rows;
      return y + bottom + (rows - 1 - r) * ch + ch * 0.55;
    }
    const lh = h - bottom - top;
    return y + bottom + lh * (h < 1.2 ? 0.8 : 0.5);
  }
  if (o.type === "door") return y + 1.0;
  if (o.articulation?.kind === "slide") return y + h - 0.1;
  return y + Math.min(h * 0.9, h - 0.03);
}
