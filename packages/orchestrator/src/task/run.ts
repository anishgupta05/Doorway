// A robot task, end to end: clarify → export the room → (train → verify) × up to 3 attempts.
// Everything lands in runs/<run>/tasks/<task>/, and job.json says where it's up to so the
// viewer can poll it (the same way it follows a loop run):
//   job.json  request.json  clarify.json  room.xml  attempt_<n>/{spec.json, plan.json, train_log.json,
//   policy.zip, verdict.json, judgement.json, trajectory.json}
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toMJCF } from "@doorway/export";
import { clarify, type Clarification } from "./clarify.js";
import { compile, runScene } from "./compile.js";
import { planTraining, type Feedback, type Plan } from "./trainer.js";
import { judge, type Judgement } from "./verifier.js";
import * as sim from "./sim.js";
import { taskId } from "./id.js";

export const MAX_ATTEMPTS = 3;

export type Attempt = { n: number; plan: Plan; judgement?: Judgement };
export type Job = {
  id: string;
  run: string;
  request: string;
  status: "clarifying" | "training" | "verifying" | "done" | "failed" | "rejected" | "asking" | "error";
  /** One line for the UI: what's happening now. */
  message: string;
  clarification?: Clarification;
  attempts: Attempt[];
  /** attempt_<n>/trajectory.json of the passing attempt. */
  trajectory?: string;
  updated: string;
};

export { taskId };

/** runs/<run>/tasks/index.json: every task in the room, newest first, so a static host can list them too. */
function index(tasksDir: string, job: Job) {
  const path = join(tasksDir, "index.json");
  const list: { id: string; request: string; status: Job["status"]; summary?: string; updated: string }[] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  const summary = job.clarification?.decision === "do" ? job.clarification.summary : undefined;
  writeJson(path, [{ id: job.id, request: job.request, status: job.status, summary, updated: job.updated }, ...list.filter((t) => t.id !== job.id)]);
}

function writeJson(path: string, obj: unknown) {
  // Atomic, so a polling viewer never reads half a file.
  writeFileSync(path + ".tmp", JSON.stringify(obj, null, 1));
  renameSync(path + ".tmp", path);
}

export async function runTask(runsDir: string, run: string, request: string, log = console.log): Promise<Job> {
  const id = taskId(request);
  const dir = join(runsDir, run, "tasks", id);
  mkdirSync(dir, { recursive: true });
  const job: Job = { id, run, request, status: "clarifying", message: "Reading the request…", attempts: [], updated: "" };
  const save = (patch: Partial<Job>) => {
    Object.assign(job, patch, { updated: new Date().toISOString() });
    writeJson(join(dir, "job.json"), job);
    index(join(runsDir, run, "tasks"), job);
    log(`[${job.status}] ${job.message}`);
  };
  writeJson(join(dir, "request.json"), { request, run });
  save({});

  try {
    const scene = runScene(runsDir, run);
    const c = await clarify(scene, request);
    writeJson(join(dir, "clarify.json"), c);
    if (c.decision === "reject") return (save({ status: "rejected", clarification: c, message: c.reason }), job);
    if (c.decision === "ask") return (save({ status: "asking", clarification: c, message: c.question }), job);
    save({ clarification: c, message: `Task: ${c.summary}` });

    writeFileSync(join(dir, "room.xml"), toMJCF(scene, { robot: true }));
    const base = compile(scene, c, id, "../room.xml");
    const history: Feedback[] = [];
    for (let n = 1; n <= MAX_ATTEMPTS; n++) {
      const out = join(dir, `attempt_${n}`);
      mkdirSync(out, { recursive: true });
      const plan = await planTraining(base, c.summary, history);
      writeJson(join(out, "plan.json"), plan);
      writeJson(join(out, "spec.json"), { ...base, train_steps: plan.train_steps, max_seconds: plan.max_seconds, reward: plan.reward, seed: n - 1 });
      const attempt: Attempt = { n, plan };
      save({ status: "training", attempts: [...job.attempts, attempt], message: `Training, attempt ${n}: ${plan.note}` });
      await sim.train(join(out, "spec.json"), out, (l) => log(`  ${l}`));

      save({ status: "verifying", message: `Testing attempt ${n} from 10 different starting spots…` });
      await sim.verify(join(out, "spec.json"), out, (l) => log(`  ${l}`));
      const verdict: sim.Verdict = JSON.parse(readFileSync(join(out, "verdict.json"), "utf8"));
      const j = await judge(verdict, c.summary);
      writeJson(join(out, "judgement.json"), j);
      attempt.judgement = j;
      if (j.pass) return (save({ status: "done", attempts: [...job.attempts], trajectory: `attempt_${n}/trajectory.json`, message: j.text }), job);
      history.push({ attempt: n, success_rate: j.success_rate, feedback: j.feedback });
      save({ attempts: [...job.attempts], message: `Attempt ${n} didn't pass: ${j.text}` });
    }
    return (save({ status: "failed", message: `Didn't pass after ${MAX_ATTEMPTS} attempts. ${job.message}` }), job);
  } catch (e) {
    save({ status: "error", message: (e as Error).message.split("\n")[0] });
    throw e;
  }
}
