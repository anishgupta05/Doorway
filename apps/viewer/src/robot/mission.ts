// Turns a list of actions into legs the robot can drive: for each action, plan from where the
// robot is to where it must stand, in the room as it is (closed doors block; opened ones don't).
import type { Scene } from "@doorway/schema";
import { buildGrid, plan, type Grid, type Plan, type Vec2 } from "./planner";
import { handleHeight, standPoint, type Action } from "./actions";
import type { RobotProfile } from "./profiles";

export type Leg = { action: Action; stand: Vec2 | null; plan: Plan; from: Vec2 };
export type Mission = { legs: Leg[]; grid: Grid; scene: Scene; total: number; failed: number };

export function planMission(scene: Scene, actions: Action[], start: Vec2, robot: RobotProfile): Mission {
  // The robot opens doors it needs to get through, so plan with room doors open.
  const doors = new Set(scene.objects.filter((o) => o.type === "door").map((o) => o.id));
  const grid = buildGrid(scene, doors);
  let at = start;
  const legs: Leg[] = [];
  for (const action of actions) {
    const stand = standPoint(scene, action, robot.radius);
    const none = (reason: string) => ({ ok: false, path: [] as Vec2[], length: 0, minGap: 0, expanded: 0, ms: 0, reason });
    // Can this robot reach the handle at all? If not, don't drive there.
    const hh = handleHeight(scene, action);
    const p =
      hh !== null && (hh > robot.reach[1] || hh < robot.reach[0])
        ? none(`out of reach: handle at ${hh.toFixed(2)} m, ${robot.name} reaches ${robot.reach[0].toFixed(2)}–${robot.reach[1].toFixed(2)} m`)
        : stand
          ? plan(grid, at, stand, robot.radius)
          : none("unknown target");
    legs.push({ action, stand, plan: p, from: at });
    if (p.ok) at = p.path[p.path.length - 1];
  }
  return { legs, grid, scene, total: legs.reduce((s, l) => s + (l.plan.ok ? l.plan.length : 0), 0), failed: legs.filter((l) => !l.plan.ok).length };
}
