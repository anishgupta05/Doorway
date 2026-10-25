// Usage: npm run loop -w @doorway/orchestrator -- --id room1 [--iters 3] [--branches 3] [--frames 5] [--live] [--backup] [--fake]
// Needs runs/<id>/scene.v0.json (generate) and runs/<id>/video.mp4 (describe), plus the viewer
// running at VIEWER_URL (default http://localhost:5173) for rendering.
//   --live    point runs/index.json "live" at this run, so the viewer follows it as it runs
//   --backup  also point "backup" at it
//   --fake    test the plumbing against runs/<id>/truth.json instead of calling Argon
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUNS, runLoop } from "./loop.js";

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const id = arg("id");
if (!id) throw new Error("pass --id <run id>");

if (flag("live") || flag("backup")) {
  const path = join(RUNS, "index.json");
  const index = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { live: id, backup: id };
  if (flag("live")) index.live = id;
  if (flag("backup")) index.backup = id;
  writeFileSync(path, JSON.stringify(index, null, 2) + "\n");
}

const t0 = Date.now();
const m = await runLoop({
  id,
  iters: Number(arg("iters", "3")),
  branches: Number(arg("branches", "3")),
  frames: Number(arg("frames", "5")),
  fake: flag("fake"),
});
const last = m.iterations[m.iterations.length - 1];
console.log(
  `done in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${m.iterations.length - 1} iterations, score ${m.iterations[0].branches[0].score} → ${last.branches[last.selected].score}`,
);
