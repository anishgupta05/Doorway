// Agent 3, the verifier: judges a trained policy from 10 test rollouts (packages/sim verify).
// The pass/fail rule is code, like the scene guards; Argon only explains the result in plain
// words and tells the trainer what to change.
import { z } from "zod";
import { callJson, models } from "../model.js";
import type { Verdict } from "./sim.js";

export type Judgement = { pass: boolean; success_rate: number; text: string; feedback: string; by: "argon" | "offline" };

/** Pass: >= 80% success, and the robot didn't knock other things around or keep crashing on the way. */
export function rule(v: Verdict) {
  const n = v.per_episode.length || 1;
  const knocked = v.per_episode.filter((e) => e.moved_other_objects.length).length / n;
  const crashes = v.per_episode.reduce((s, e) => s + e.collisions, 0) / n;
  const problems = [
    v.success_rate < 0.8 && `succeeded in ${Math.round(v.success_rate * 100)}% of test runs (needs 80%)`,
    knocked > 0.2 && `knocked other objects in ${Math.round(knocked * 100)}% of runs`,
    crashes > 2 && `hit walls or furniture hard ${crashes.toFixed(1)} times per run`,
  ].filter(Boolean) as string[];
  return { pass: problems.length === 0, problems, knocked, crashes };
}

export async function judge(v: Verdict, summary: string): Promise<Judgement> {
  const r = rule(v);
  const base = { pass: r.pass, success_rate: v.success_rate };
  if (!process.env.GEMINI_API_KEY) return { ...base, ...offline(v, r), by: "offline" };
  const schema = z.object({ text: z.string(), feedback: z.string() });
  const out = await callJson({
    model: models.argon(),
    prompt: `You check a robot's trained behaviour for the task "${summary}". The pass rule already decided: ${r.pass ? "PASS" : `FAIL (${r.problems.join("; ")})`}.
text: one or two plain sentences for a visitor watching the demo: what the robot does and how reliably. No jargon (no "policy", "episode", "PPO").
feedback: for the training agent, what most likely went wrong and what to change (more training, longer episodes, more weight on getting into position, ...). If it passed, say so in a few words.`,
    schema,
    context: ["TEST RUNS (10, jittered starts):\n" + JSON.stringify(v.per_episode)],
  });
  return { ...base, ...out, by: "argon" };
}

function offline(v: Verdict, r: ReturnType<typeof rule>) {
  const ok = v.per_episode.filter((e) => e.success);
  const secs = ok.length ? ok.reduce((s, e) => s + e.time_s, 0) / ok.length : 0;
  const pct = `${Math.round(v.success_rate * 100)}%`;
  if (r.pass)
    return { text: `It works: the robot did it in ${pct} of 10 test runs from different starting spots, in about ${secs.toFixed(1)} s each.`, feedback: "Passed." };
  const near = v.per_episode.some((e) => !e.success && (e.final_distance ?? 99) < 0.6);
  return {
    text: `Not reliable yet: it ${r.problems.join(", and ")}.`,
    feedback: v.success_rate === 0 && !near ? "It never gets close: it probably isn't getting into position. More weight on reach and more training." : "It gets close but doesn't finish reliably: more training and longer episodes.",
  };
}
