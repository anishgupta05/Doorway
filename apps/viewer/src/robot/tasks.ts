// Tasks the robot can be given in a room, derived from what the scene contains.
import type { Scene, SceneObject } from "@doorway/schema";
import { ROBOT_RADIUS, type Vec2 } from "./planner";

export type Task = { id: string; label: string; start: Vec2; goal: Vec2; target?: string };

const TARGETS = new Set<SceneObject["type"]>(["table", "cabinet", "shelf", "sofa", "bed", "chair"]);

/**
 * Where the robot starts: outside the first doorway, far enough back that a door
 * swinging out toward it can't hit it. The room centre if there is no doorway.
 */
export function startPoint(scene: Scene): Vec2 {
  const d = scene.room.openings.find((o) => o.kind === "door");
  if (!d) return [0, 0];
  const out = Math.max(0.6, d.width + ROBOT_RADIUS + 0.12);
  const { width: w, depth: dp } = scene.room;
  switch (d.wall) {
    case "north": return [d.offset, -dp / 2 - out];
    case "south": return [d.offset, dp / 2 + out];
    case "east": return [w / 2 + out, d.offset];
    case "west": return [-w / 2 - out, d.offset];
  }
}

/** A spot in front of an object (its local +z side), where a robot would stop to use it. */
export function approachPoint(o: SceneObject): Vec2 {
  const reach = o.size[2] / 2 + ROBOT_RADIUS + 0.08;
  return [o.position[0] + Math.sin(o.rotationY) * reach, o.position[2] + Math.cos(o.rotationY) * reach];
}

export function tasksFor(scene: Scene): Task[] {
  const start = startPoint(scene);
  const order: SceneObject["type"][] = ["table", "cabinet", "shelf", "sofa", "bed", "chair"];
  return scene.objects
    .filter((o) => TARGETS.has(o.type))
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
    .slice(0, 4)
    .map((o) => ({ id: `goto-${o.id}`, label: `Drive in and reach ${o.label ?? o.id}`, start, goal: approachPoint(o), target: o.id }));
}
