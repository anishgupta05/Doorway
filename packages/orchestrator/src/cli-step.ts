// One manual step of the loop, for inspection. Usage: npm run step -w @doorway/orchestrator -- --id room1 [--branches 3]
// Reads runs/<id>/{description.json,scene.v0.json,video.mp4}; prints issues, proposals and each branch's verdict.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Scene } from "@doorway/schema";
import { uploadVideo } from "./model.js";
import { compareScene } from "./compare.js";
import { proposeFixes } from "./fixes.js";
import { evaluateBranch } from "./branch.js";
import type { Description } from "./describe.js";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const id = arg("id");
if (!id) throw new Error("pass --id <run id>");
const n = Number(arg("branches") ?? 3);
const dir = resolve(import.meta.dirname, "../../../runs", id);
const description: Description = JSON.parse(readFileSync(join(dir, "description.json"), "utf8"));
const scene = Scene.parse(JSON.parse(readFileSync(join(dir, arg("scene") ?? "scene.v0.json"), "utf8")));
const video = existsSync(join(dir, "video.mp4")) ? await uploadVideo(join(dir, "video.mp4")) : undefined;

const t0 = Date.now();
const base = await compareScene(scene, description, video);
console.log(`v0 score ${base.score.toFixed(2)}  (${((Date.now() - t0) / 1000).toFixed(0)}s)  ${base.issues.length} issues`);
for (const i of base.issues) console.log(`  [${i.severity}] ${i.objectId}: ${i.message}`);

const proposals = await proposeFixes(scene, base, n, [], video);
console.log(`\n${proposals.length} proposals (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
const results = await Promise.all(proposals.map((p) => evaluateBranch(scene, p, description, video)));
results.forEach((r, i) => {
  console.log(`\nbranch ${i}: ${r.hypothesis}`);
  console.log(`  ops: ${proposals[i].patch.map((o) => `${o.op} ${o.path}${o.value !== undefined ? "=" + JSON.stringify(o.value) : ""}`).join("; ")}`);
  console.log(r.ok ? `  PASS score ${r.comparison!.score.toFixed(2)} (v0 ${base.score.toFixed(2)})` : `  FAIL ${r.reason}`);
});
console.log(`\ntotal ${((Date.now() - t0) / 1000).toFixed(0)}s`);
