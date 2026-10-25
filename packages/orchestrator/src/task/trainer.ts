// Agent 2, the trainer: chooses how to train (budget, episode length, reward weights) and,
// after a failed attempt, what to change given the verifier's feedback. Argon picks within
// hard limits set here; the reward itself is a fixed template in packages/sim (no generated code).
import { z } from "zod";
import { callJson, models } from "../model.js";
import type { SimSpec, TaskType } from "./compile.js";

/** The template's cost names and default weights (packages/sim/sim/rewards.py). */
export const REWARD: Record<TaskType, Record<string, number>> = {
  go_to: { dist: 2.0, disturb: 2.0 },
  push_door: { reach: 1.0, angle: 4.0, disturb: 2.0 },
  push_object: { reach: 1.0, dist: 4.0, disturb: 2.0 },
};
const COSTS: Record<string, string> = {
  dist: "metres between the robot (or pushed object) and the goal",
  reach: "metres between the robot and where it has to be to push (the door's face, or behind the object)",
  angle: "radians the door is short of the goal angle",
  disturb: "metres other loose objects (not the task's) have been shoved from where they were (a growing cost, so a penalty)",
};
const LIMITS = { steps: [50_000, 1_500_000], seconds: [8, 30], weight: [0.25, 4] } as const;

export type Plan = { train_steps: number; max_seconds: number; reward: Record<string, number>; note: string; by: "argon" | "offline" };
export type Feedback = { attempt: number; success_rate: number; feedback: string };

const clamp = (n: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, n));

/** Keeps a plan inside the limits: budget, episode length, and each weight within 0.25-4x its template value. */
function bound(spec: SimSpec, p: Omit<Plan, "by">): Omit<Plan, "by"> {
  const t = REWARD[spec.type];
  const reward = Object.fromEntries(Object.keys(t).map((k) => [k, Number(clamp((p.reward[k] ?? t[k]) / t[k], LIMITS.weight).toFixed(2)) * t[k]]));
  return { train_steps: Math.round(clamp(p.train_steps, LIMITS.steps)), max_seconds: clamp(p.max_seconds, LIMITS.seconds), reward, note: p.note };
}

export async function planTraining(spec: SimSpec, summary: string, history: Feedback[]): Promise<Plan> {
  const p = process.env.GEMINI_API_KEY ? await withArgon(spec, summary, history) : offline(spec, history);
  return { ...bound(spec, p), by: process.env.GEMINI_API_KEY ? "argon" : "offline" };
}

function offline(spec: SimSpec, history: Feedback[]): Omit<Plan, "by"> {
  const last = history[history.length - 1];
  const reward = { ...REWARD[spec.type] };
  if (!last) return { train_steps: spec.train_steps, max_seconds: spec.max_seconds, reward, note: "Default budget and reward for this kind of task." };
  // Knocking things over: make it cost more. Far off: lean harder on getting into position. Either way, more practice.
  const n = history.length;
  const knocks = /knock|shov|moved other/i.test(last.feedback);
  if (knocks) reward.disturb *= 2 ** (n + 1);
  if (last.success_rate < 0.4 && "reach" in reward) reward.reach *= 2;
  return {
    train_steps: spec.train_steps * 2 ** n,
    max_seconds: spec.max_seconds + 5 * n,
    reward,
    note: knocks
      ? `It was knocking other things around: ${2 ** (n + 1)}x the penalty for moving them, and twice the budget.`
      : last.success_rate < 0.4
        ? "Mostly failing: doubling the budget, longer episodes, and twice the reward for getting into position."
        : "Close: doubling the budget and lengthening episodes.",
  };
}

async function withArgon(spec: SimSpec, summary: string, history: Feedback[]): Promise<Omit<Plan, "by">> {
  const t = REWARD[spec.type];
  const schema = z.object({
    train_steps: z.number().int(),
    max_seconds: z.number(),
    reward: z.object(Object.fromEntries(Object.keys(t).map((k) => [k, z.number()]))),
    note: z.string(),
  });
  const r = await callJson({
    model: models.argon(),
    prompt: `You configure PPO training for a small mobile robot in a MuJoCo room. Task: "${summary}" (type ${spec.type}).
The reward is fixed: each step it pays weight × (decrease in each cost), plus +10 on success, minus small time, effort and hard-collision penalties.
Costs and default weights: ${Object.entries(t).map(([k, w]) => `${k}=${w} (${COSTS[k]})`).join("; ")}.
Defaults: train_steps=${spec.train_steps}, max_seconds=${spec.max_seconds}. Training stops early once 97% of episodes succeed, so a generous budget costs nothing when the task is easy. CPU only: about 2,000 steps per second.
Limits: train_steps ${LIMITS.steps.join("-")}, max_seconds ${LIMITS.seconds.join("-")}, each weight ${LIMITS.weight.join("-")}x its default.
${history.length ? "Earlier attempts failed verification; change what the feedback points at, and say what you changed and why in note." : "This is the first attempt: start from the defaults unless the task gives a reason not to; note says what you chose in one sentence."}`,
    schema,
    context: history.map((h) => `ATTEMPT ${h.attempt}: success ${Math.round(h.success_rate * 100)}%. Verifier: ${h.feedback}`),
  });
  return r as Omit<Plan, "by">;
}
