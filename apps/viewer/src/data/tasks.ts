// Client for robot tasks (packages/orchestrator/src/task, apps/viewer/api-tasks.ts): the files a task
// run writes under runs/<run>/tasks/, and the endpoint that starts one.
import { useEffect, useState } from "react";

export type TaskStatus = "clarifying" | "training" | "verifying" | "done" | "failed" | "rejected" | "asking" | "error";
export type TaskEntry = { id: string; request: string; status: TaskStatus; summary?: string; updated: string };
export type Judgement = { pass: boolean; success_rate: number; text: string; by: "argon" | "offline" };
export type TaskJob = {
  id: string;
  run: string;
  request: string;
  status: TaskStatus;
  message: string;
  clarification?: { decision: "do" | "reject" | "ask"; by: string; summary?: string; type?: string; object?: string; near?: string };
  attempts: { n: number; plan: { train_steps: number; note: string; by: string }; judgement?: Judgement }[];
  trajectory?: string;
  updated: string;
};
export type TrainPoint = { steps: number; mean_reward: number; success_rate: number; elapsed_s: number };
/** MuJoCo world coords (z-up): robot [x, y, yaw]; free bodies [x, y, z, qw, qx, qy, qz]; joints in rad or m. */
export type Frame = { t: number; robot: [number, number, number]; bodies: Record<string, number[]>; joints: Record<string, number> };
export type Trajectory = { fps: number; frames: Frame[] };
export type SimSpec = { type: string; target?: { body: string } | { point: [number, number] }; object?: string; door?: string };

export const ACTIVE: TaskStatus[] = ["clarifying", "training", "verifying"];

const j = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
};
const base = (run: string, task: string) => `/runs/${run}/tasks/${task}`;

/** The local API answers [] for a room with no tasks; a static host only has the files, so fall back to them. */
export const listTasks = (run: string) =>
  j<TaskEntry[]>(`/api/tasks?run=${run}`).catch(() => j<TaskEntry[]>(`/runs/${run}/tasks/index.json`)).catch(() => [] as TaskEntry[]);
export const getJob = (run: string, task: string) => j<TaskJob>(`${base(run, task)}/job.json`);
export const getTrainLog = (run: string, task: string, n: number) => j<TrainPoint[]>(`${base(run, task)}/attempt_${n}/train_log.json`).catch(() => [] as TrainPoint[]);
export const getTrajectory = (run: string, task: string, path: string) => j<Trajectory>(`${base(run, task)}/${path}`);
export const getSpec = (run: string, task: string, n: number) => j<SimSpec>(`${base(run, task)}/attempt_${n}/spec.json`);

export async function startTask(run: string, request: string): Promise<{ id: string }> {
  const r = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run, request }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? "Couldn't start the task (is the viewer running with `npm run dev`?).");
  return body;
}

/** Polls a value every `ms` while `active`; fetches once otherwise. */
export function usePoll<T>(load: (() => Promise<T>) | null, active: boolean, ms = 1000): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    if (!load) return setV(null);
    let live = true;
    const tick = () => load().then((x) => live && setV(x), () => {});
    tick();
    const t = active ? setInterval(tick, ms) : undefined;
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [load, active, ms]);
  return v;
}
