// Is the Argon scorer trustworthy? Scores the same scene several times (repeatability) and
// deliberately damaged copies of a good scene (sensitivity), with the model cache bypassed.
// Needs the viewer running (VIEWER_URL) and a finished run. Usage:
//   VIEWER_URL=http://localhost:5173 npx tsx scripts/scorer-check.ts --id room1 [--repeats 3]
process.env.DOORWAY_NOCACHE = "1";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RunManifest, Scene } from "@doorway/schema";
import { compareScene } from "../packages/orchestrator/src/compare.ts";
import type { Description } from "../packages/orchestrator/src/describe.ts";
import { uploadVideo } from "../packages/orchestrator/src/model.ts";
import { Renderer, sampleTimes } from "../packages/orchestrator/src/render.ts";
import { RUNS } from "../packages/orchestrator/src/loop.ts";

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const id = arg("id")!;
const repeats = Number(arg("repeats", "3"));
const dir = join(RUNS, id);
const manifest = RunManifest.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
const last = manifest.iterations[manifest.iterations.length - 1];
const good = Scene.parse(JSON.parse(readFileSync(join(dir, last.branches[last.selected].scene), "utf8")));
const v0 = Scene.parse(JSON.parse(readFileSync(join(dir, "scene.v0.json"), "utf8")));

const clone = () => structuredClone(good) as Scene;
const solid = good.objects.filter((o) => o.type !== "door" && o.type !== "rug");
const moved = clone(); { const o = moved.objects.find((x) => x.id === solid[0].id)!; o.position[0] += 0.8; o.position[2] += 0.5; }
const rotated = clone(); { const o = rotated.objects.find((x) => x.id === solid[1].id)!; o.rotationY += Math.PI; }
const shrunk = clone(); { const o = shrunk.objects.find((x) => x.id === solid[2].id)!; o.size = [o.size[0] * 0.5, o.size[1] * 0.5, o.size[2] * 0.5]; }
const recoloured = clone(); { const o = recoloured.objects.find((x) => x.id === solid[0].id)!; o.color = "#ff00ff"; }
const cases: [string, Scene][] = [["good (final)", good], ["v0 (start)", v0], ["moved 0.9 m", moved], ["rotated 180°", rotated], ["shrunk to 50%", shrunk], ["recoloured magenta", recoloured]];

const description: Description = JSON.parse(readFileSync(join(dir, "description.json"), "utf8"));
const video = await uploadVideo(join(dir, "video.mp4"));
const renderer = await new Renderer().start();
const times = sampleTimes(good.camera_path[good.camera_path.length - 1].t, 5);
mkdirSync(join(dir, "scorer"), { recursive: true });
console.log(`scorer check on runs/${id}: ${repeats} repeats per case, cache bypassed\n`);
const rows: string[] = [];
try {
  for (const [name, scene] of cases) {
    const rel = `scorer/${name.replace(/\W+/g, "_")}.json`;
    writeFileSync(join(dir, rel), JSON.stringify(scene));
    const frames = await renderer.frames(id, rel, times);
    const scores = await Promise.all(Array.from({ length: repeats }, async () => (await compareScene(scene, description, video, { frames, times })).score));
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    rows.push(`${name.padEnd(22)} ${scores.map((s) => s.toFixed(2)).join("  ")}   mean ${mean.toFixed(2)}  spread ${(Math.max(...scores) - Math.min(...scores)).toFixed(2)}`);
    console.log(rows[rows.length - 1]);
  }
} finally {
  await renderer.stop();
}
