// A clarified task → the sim's spec.json, plus the physical checks the clarifier can't be
// trusted with. Scene space is y-up (x, z on the floor); MuJoCo is z-up, so floor (x, z)
// becomes (x, -z). Everything the robot does is computed here, not by the model.
import { Scene, type SceneObject } from "@doorway/schema";
import { doorClearance, doorPush, floorGrid, inFootprint, robotStart, ROBOT_RADIUS } from "@doorway/export";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type TaskType = "go_to" | "push_door" | "push_object";
/** What the clarifier settled on. `object` is the thing to reach, the door, or the thing to push; `near` is where a pushed thing goes. */
export type Clarified = { type: TaskType; object: string; near?: string; summary: string };

/** The sim's spec.json (packages/sim/README.md). Coordinates are MuJoCo world. */
export type SimSpec = {
  id: string;
  type: TaskType;
  mjcf: string;
  target?: { body: string } | { point: [number, number] };
  object?: string;
  door?: string;
  start?: [number, number, number];
  success: { radius: number } | { angle_deg: number };
  max_seconds: number;
  train_steps: number;
  seed: number;
  /** Per-cost reward weights, overriding the template (sim/rewards.py). */
  reward?: Record<string, number>;
};

/** The robot's push force limit (exporter velocity actuators) and floor friction. */
const PUSH_N = 120;
const FLOOR_MU = 0.4;
const G = 9.81;

const mj = ([x, z]: [number, number]): [number, number] => [round(x), round(-z)];
const round = (n: number) => Number(n.toFixed(3));
const name = (o: SceneObject) => o.label ?? o.id.replace(/_\d+$/, "");
/** A door has to swing at least this far for "open" to mean anything; the goal is 60° or just short of whatever stops it. */
const MIN_OPEN_DEG = 35;
const goalDeg = (scene: Scene, door: SceneObject) => Math.min(60, Math.floor(doorClearance(scene, door).deg) - 5);

/** The verified scene of a run: the selected branch of its last iteration, else scene.v0.json. */
export function runScene(runsDir: string, id: string): Scene {
  const dir = join(runsDir, id);
  try {
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    const it = m.iterations[m.iterations.length - 1];
    return Scene.parse(JSON.parse(readFileSync(join(dir, it.branches[it.selected].scene), "utf8")));
  } catch {
    return Scene.parse(JSON.parse(readFileSync(join(dir, "scene.v0.json"), "utf8")));
  }
}

export const movable = (o: SceneObject) => o.articulation?.kind === "free" || (!o.articulation && o.physics?.body === "dynamic");
/** Heaviest thing the robot can slide: friction is the higher of the two surfaces (MuJoCo), with 20% to spare. */
export const maxPushKg = (o: SceneObject) => (0.8 * PUSH_N) / (Math.max(o.physics?.friction ?? 0.5, FLOOR_MU) * G);

/** Why the robot can't do this, in plain words, or null if it can. */
export function infeasible(scene: Scene, c: Clarified): string | null {
  const o = scene.objects.find((x) => x.id === c.object);
  if (!o) return `There's no "${c.object}" in this room.`;
  if (o.decor) return `The ${name(o)} is decoration; the simulator doesn't model it as a solid object.`;
  if (c.type === "push_door") {
    if (o.type !== "door" || o.articulation?.kind !== "hinge") return `The ${name(o)} isn't a hinged door, so there's nothing to push open.`;
    const { deg, blocker } = doorClearance(scene, o);
    if (deg < MIN_OPEN_DEG) return `The ${name(o)} only opens ${Math.round(deg)}° before it hits the ${name(scene.objects.find((x) => x.id === blocker)!)}.`;
    return null;
  }
  if (c.type === "push_object") {
    if (!movable(o)) return `The ${name(o)} is fixed in place in this room; the robot can only push loose things like chairs.`;
    const kg = o.physics?.mass;
    if (kg && kg > maxPushKg(o)) return `The ${name(o)} is about ${Math.round(kg)} kg; the robot can push about ${Math.round(maxPushKg(o))} kg.`;
    if (!c.near) return "Push it where? Name something to push it next to.";
    if (!scene.objects.some((x) => x.id === c.near)) return `There's no "${c.near}" in this room.`;
    if (!pushTarget(scene, o, c.near)) return `There's no clear floor next to the ${name(scene.objects.find((x) => x.id === c.near)!)} for the ${name(o)}.`;
    return null;
  }
  if (o.type === "door") return null;
  if (!reachable(scene, o)) return `The robot can't fit anywhere next to the ${name(o)}.`;
  return null;
}

/** Some free floor cell within 0.4 m of the object's footprint (the go_to success radius). */
function reachable(scene: Scene, o: SceneObject) {
  const g = floorGrid(scene);
  return g.free.some((row, r) => row.some((ok, c) => ok && inFootprint(o, g.origin[0] + c * g.cell, g.origin[1] + r * g.cell, ROBOT_RADIUS + 0.4)));
}

/** Free floor nearest `near`'s footprint where the pushed object itself fits. Scene [x, z]. */
function pushTarget(scene: Scene, o: SceneObject, nearId: string): [number, number] | null {
  const near = scene.objects.find((x) => x.id === nearId)!;
  const half = Math.hypot(o.size[0], o.size[2]) / 2;
  // A grid sized for the object (not the robot), without the object itself in the way.
  const g = floorGrid({ ...scene, objects: scene.objects.filter((x) => x.id !== o.id) }, half);
  let best: [number, number] | null = null;
  let bestD = Infinity;
  g.free.forEach((row, r) =>
    row.forEach((ok, c) => {
      if (!ok) return;
      const x = g.origin[0] + c * g.cell;
      const z = g.origin[1] + r * g.cell;
      // Distance from this spot to the edge of `near`'s footprint, roughly: grow the box until it covers the spot.
      let d = 0;
      while (d < 3 && !inFootprint(near, x, z, d)) d += 0.05;
      const fromHere = Math.hypot(x - o.position[0], z - o.position[2]);
      // Next to it (just clear of it), and not where the object already is.
      if (d < half + 0.05 || fromHere < 0.6) return;
      if (d < bestD) [best, bestD] = [[x, z], d];
    }),
  );
  return best;
}

/** The sim spec for a clarified, feasible task. `mjcf` is the exported room (written by the caller). */
export function compile(scene: Scene, c: Clarified, id: string, mjcf: string): SimSpec {
  const base = { id, type: c.type, mjcf, max_seconds: 15, train_steps: 300_000, seed: 0 };
  const o = scene.objects.find((x) => x.id === c.object)!;
  if (c.type === "push_door") {
    const p = doorPush(o)!;
    // A little behind the approach point, facing the way the door swings.
    const at: [number, number] = [p.approach[0] - p.swing[0] * 0.15, p.approach[1] - p.swing[1] * 0.15];
    const dir = mj(p.swing);
    return { ...base, door: o.id, start: [...mj(at), round(Math.atan2(dir[1], dir[0]))], success: { angle_deg: goalDeg(scene, o) } };
  }
  const start = mj(robotStart(scene));
  if (c.type === "push_object") {
    return { ...base, object: o.id, target: { point: mj(pushTarget(scene, o, c.near!)!) }, start: [...start, 0], success: { radius: 0.3 }, train_steps: 500_000 };
  }
  return { ...base, target: { body: o.id }, start: [...start, 0], success: { radius: 0.4 }, train_steps: 200_000 };
}

/** One line per object the robot could be asked about, for the clarifier's context. */
export function describeForRobot(scene: Scene): string {
  return scene.objects
    .filter((o) => !o.decor && o.type !== "rug")
    .map((o) => {
      const can =
        o.type === "door" && o.articulation?.kind === "hinge"
          ? `door: robot can push it open (opens ${doorPush(o)!.inward ? "into" : "out of"} the room, up to ${Math.round(doorClearance(scene, o).deg)}°)`
          : movable(o)
            ? (o.physics?.mass ?? 0) > maxPushKg(o) ? `loose but too heavy to push (${o.physics?.mass} kg)` : `loose: robot can push it (${o.physics?.mass ?? "?"} kg)`
            : o.articulation?.kind === "switch" ? "switch: robot has no arm, can't press it"
            : o.articulation?.kind === "slide" ? "drawer/slider: robot has no arm, can't pull it"
            : "fixed: robot can drive to it";
      return `${o.id} (${o.type}${o.label ? `, "${o.label}"` : ""}) at x=${o.position[0].toFixed(1)} z=${o.position[2].toFixed(1)}: ${can}`;
    })
    .join("\n");
}
