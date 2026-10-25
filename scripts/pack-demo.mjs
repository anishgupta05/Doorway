// Copies the rooms the hosted demo shows into the built viewer (apps/viewer/dist/runs).
// Only what the viewer reads: index.json, each run's manifest, scenes, issues, thumbnails and the compressed video.
// Raw uploads, logs and job files stay out.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const src = join(root, "runs");
const dst = join(root, "apps/viewer/dist/runs");
const index = JSON.parse(readFileSync(join(src, "index.json"), "utf8"));
const ids = [...new Set([index.live, index.backup])];
const SKIP = /^(upload\.|job\.|progress\.json|description\.json|truth\.json|scene\.v0\.json)|\.log$/;

mkdirSync(dst, { recursive: true });
cpSync(join(src, "index.json"), join(dst, "index.json"));
for (const id of ids) {
  if (!existsSync(join(src, id))) throw new Error(`runs/${id} is listed in runs/index.json but missing`);
  cpSync(join(src, id), join(dst, id), { recursive: true, filter: (p) => !SKIP.test(p.split("/").pop() ?? "") });
  console.log(`packed runs/${id}`);
}
const size = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(join(d, e.name)) : statSync(join(d, e.name)).size), 0);
console.log(`demo data: ${(size(dst) / 1e6).toFixed(1)} MB`);
