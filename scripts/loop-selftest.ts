// Runs the whole verification loop with the fake model (no API key needed): the mock
// run's flawed v0 is the starting scene and its ground truth plays "the footage".
// Checks guards, interaction tests, rendering, scoring and the run layout end to end.
// Needs the viewer running (npm run dev). Usage: npx tsx scripts/loop-selftest.ts [--live]
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const dir = join(root, "runs", "loop-test");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
cpSync(join(root, "runs/mock/iter_0/branch_0/scene.json"), join(dir, "scene.v0.json"));
cpSync(join(root, "runs/mock/truth.json"), join(dir, "truth.json"));
cpSync(join(root, "runs/mock/video.webm"), join(dir, "video.webm"));
execFileSync("npm", ["run", "-s", "loop", "--", "--id", "loop-test", "--iters", "4", "--branches", "3", "--fake", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
});
