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
    const g0 = buildGrid(before);
    const g1 = buildGrid(after);
    const p0 = plan(g0, task.start, task.goal);
    const p1 = plan(g1, task.start, task.goal);
    const hit = p0.ok ? firstCollision(g1, p0.path) : null;
    // What stands between the robot and the goal when there's no path in the verified room.
    const blocker = p1.ok ? null : (hit?.what ?? nearestObstacle(g1, task.goal));
    return { g0, g1, p0, p1, hit, blocker };
  }, [before, after, task]);

  const sim = useMemo(() => {
    if (!r || !task) return null;
    const key = `${task.id}-${step}`;
    if (step <= 1) {
      const run: SimRun | null = step === 1 && r.p0.ok ? { key, path: r.p0.path, stopAt: null, color: "accent" } : null;
      return { grid: r.g0, run, collision: null };
    }
    if (step === 2) {
      const run: SimRun | null = r.p0.ok ? { key, path: r.p0.path, stopAt: r.hit?.distance ?? null, color: r.hit ? "bad" : "accent" } : null;
      return { grid: r.g1, run, collision: r.hit && done[key] ? r.hit : null };
    }
    const run: SimRun | null = r.p1.ok ? { key, path: r.p1.path, stopAt: null, color: "accent" } : null;
    return { grid: r.g1, run, collision: null };
  }, [r, task, step, done]);

  return { tasks, task, step, plans: r, sim, finished: task ? !!done[`${task.id}-${step}`] : false };
}

/** Moves the demo to a step, switching which version of the room is on stage. */
export function goToStep(step: 0 | 1 | 2 | 3) {
  const s = useApp.getState();
  s.setVersion(step <= 1 ? "v0" : "latest");
  useApp.setState({ robotStep: step, mode: "overview", split: false, tests: false });
}
