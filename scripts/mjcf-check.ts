// Exports rooms with the sim robot and checks their physics in MuJoCo: nothing moves at
// rest, nothing starts inside anything else, and the robot can push each door open from
// its push side. Needs the sim venv (packages/sim/.venv).
// Usage: npx tsx scripts/mjcf-check.ts [scene.json …]   (default: mock final + room1 v0)
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Scene } from "@doorway/schema";
import { doorPush, toMJCF } from "@doorway/export";

const python = "packages/sim/.venv/bin/python";
const scenes = process.argv.slice(2);
if (!scenes.length) {
  const m = JSON.parse(readFileSync("runs/mock/manifest.json", "utf8"));
  const last = m.iterations[m.iterations.length - 1];
  scenes.push(`runs/mock/${last.branches[last.selected].scene}`, "runs/room1/scene.v0.json");
}

mkdirSync("runs/.cache/mjcf", { recursive: true });
let failed = 0;
for (const path of scenes) {
  const scene = Scene.parse(JSON.parse(readFileSync(path, "utf8")));
  const out = join("runs/.cache/mjcf", `${basename(dirname(path))}_${basename(path, ".json")}.xml`);
  writeFileSync(out, toMJCF(scene, { robot: true }));
  // Scene (x, z) → MuJoCo (x, -z). Start a little further out than the approach point, facing the door.
  const cases = scene.objects.flatMap((o) => {
    const p = doorPush(o);
    if (!p || o.type !== "door") return [];
    const [sx, sz] = [p.approach[0] - p.swing[0] * 0.15, p.approach[1] - p.swing[1] * 0.15];
    const dir = [p.swing[0], -p.swing[1]];
    return [{ door: o.id, start: [sx, -sz, Math.atan2(dir[1], dir[0])], dir }];
  });
  console.log(`\n${path} → ${out}`);
  try {
    process.stdout.write(execFileSync(python, ["scripts/mjcf_check.py", out, JSON.stringify(cases)], { encoding: "utf8" }));
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    process.stdout.write(err.stdout ?? "");
    process.stderr.write(err.stderr ?? "");
    failed++;
  }
}
process.exit(failed ? 1 : 0);
