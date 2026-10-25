// Runs packages/sim (Python, MuJoCo + PPO) as a child process. Results are files the sim
// writes into the attempt folder: train_log.json, policy.zip, verdict.json, trajectory.json.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const SIM = resolve(import.meta.dirname, "../../../sim");
const PYTHON = join(SIM, ".venv/bin/python");

export type Verdict = {
  id: string;
  success_rate: number;
  pass: boolean;
  mode: "deterministic" | "stochastic";
  per_episode: { success: boolean; final_distance?: number; final_angle?: number; time_s: number; collisions: number; moved_other_objects: string[] }[];
};

function run(module: string, args: string[], log: (line: string) => void): Promise<void> {
  if (!existsSync(PYTHON)) throw new Error(`no sim venv at ${PYTHON}: see packages/sim/README.md`);
  return new Promise((ok, fail) => {
    const p = spawn(PYTHON, ["-m", module, ...args], { cwd: SIM, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const read = (b: Buffer) => {
      tail = (tail + b).slice(-4000);
      for (const line of b.toString().split("\n").filter(Boolean)) log(line);
    };
    p.stdout.on("data", read);
    p.stderr.on("data", read);
    p.on("error", fail);
    p.on("close", (code) => (code === 0 ? ok() : fail(new Error(`${module} exited ${code}:\n${tail}`))));
  });
}

export const train = (spec: string, out: string, log: (l: string) => void) => run("sim.train", ["--spec", spec, "--out", out], log);
export const verify = (spec: string, out: string, log: (l: string) => void) =>
  run("sim.verify", ["--spec", spec, "--policy", join(out, "policy.zip"), "--out", out], log);
