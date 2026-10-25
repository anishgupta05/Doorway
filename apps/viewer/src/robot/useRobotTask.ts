// The robot demo's logic: plan a task in the one-pass room, replay that plan in the
// verified room to see whether it would have crashed, then plan again in the verified room.
import { useMemo } from "react";
import type { Scene } from "@doorway/schema";
import { useApp } from "../store";
import { buildGrid, firstCollision, nearestObstacle, plan } from "./planner";
import { tasksFor } from "./tasks";
import type { SimRun } from "./RobotSim";

export function useRobotTask(before: Scene | null, after: Scene | null) {
  const taskId = useApp((s) => s.robotTask);
  const step = useApp((s) => s.robotStep);
  const done = useApp((s) => s.robotDone);
  const tasks = useMemo(() => (after ? tasksFor(after) : []), [after]);
  const task = tasks.find((t) => t.id === taskId) ?? tasks[0] ?? null;

  const r = useMemo(() => {
    if (!before || !after || !task) return null;
    // Plan with doors as they are; if a closed door is the only thing in the way, the robot opens it first.
    const withDoors = (scene: Scene) => {
      const closed = buildGrid(scene);
      const p = plan(closed, task.start, task.goal);
      if (p.ok) return { grid: closed, plan: p, opened: [] as string[] };
      const doors = scene.objects.filter((o) => o.type === "door" && o.articulation?.kind === "hinge").map((o) => o.id);
      if (!doors.length) return { grid: closed, plan: p, opened: [] as string[] };
      const open = buildGrid(scene, new Set(doors));
      const q = plan(open, task.start, task.goal);
      return q.ok ? { grid: open, plan: q, opened: doors } : { grid: closed, plan: p, opened: [] as string[] };
    };
    const a = withDoors(before);
    const b = withDoors(after);
    const g0 = a.grid;
    const g1 = b.grid;
    const p0 = a.plan;
    const p1 = b.plan;
    // Replay v0's route in the verified room with the same doors open that v0's plan used.
    const replay = a.opened.length ? buildGrid(after, new Set(a.opened)) : buildGrid(after);
    const hit = p0.ok ? firstCollision(replay, p0.path) : null;
    // What stands between the robot and the goal when there's no path in the verified room.
    const blocker = p1.ok ? null : (hit?.what ?? nearestObstacle(g1, task.goal));
    return { g0, g1, p0, p1, hit, blocker, opened0: a.opened, opened1: b.opened };
  }, [before, after, task]);

  const sim = useMemo(() => {
    if (!r || !task) return null;
    const key = `${task.id}-${step}`;
    if (step <= 1) {
      const run: SimRun | null = step === 1 && r.p0.ok ? { key, path: r.p0.path, stopAt: null, color: "accent", open: r.opened0 } : null;
      return { grid: r.g0, run, collision: null };
    }
    if (step === 2) {
      const run: SimRun | null = r.p0.ok ? { key, path: r.p0.path, stopAt: r.hit?.distance ?? null, color: r.hit ? "bad" : "accent", open: r.opened0 } : null;
      return { grid: r.g1, run, collision: r.hit && done[key] ? r.hit : null };
    }
    const run: SimRun | null = r.p1.ok ? { key, path: r.p1.path, stopAt: null, color: "accent", open: r.opened1 } : null;
    return { grid: r.g1, run, collision: null };
  }, [r, task, step, done]);

  return { tasks, task, step, plans: r, sim, finished: task ? !!done[`${task.id}-${step}`] : false };
}

/** Moves the demo to a step, switching which version of the room is on stage. */
export function goToStep(step: 0 | 1 | 2 | 3) {
  const s = useApp.getState();
  s.setVersion(step <= 1 ? "v0" : "latest");
  // Each step starts from closed doors; the robot opens what it needs as it sets off.
  useApp.setState({ robotStep: step, mode: "overview", split: false, tests: false, joints: {} });
}
