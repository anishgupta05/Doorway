// Usage: npm run detail -w @doorway/orchestrator -- --id booth1 [--in scene.v0.json] [--out scene.v0.json]
// Reads the accepted layout, rebuilds object looks from the footage, writes the result (keeps a copy of the input).
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Scene } from "@doorway/schema";
import { uploadVideo } from "./model.js";
import { detailScene } from "./detail.js";

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const id = arg("id");
if (!id) throw new Error("pass --id <run id>");
const dir = resolve(import.meta.dirname, "../../../runs", id);
const inFile = join(dir, arg("in", "scene.v0.json")!);
const outFile = join(dir, arg("out", "scene.v0.json")!);
const scene = Scene.parse(JSON.parse(readFileSync(inFile, "utf8")));
const videoPath = join(dir, "video.mp4");
const t0 = Date.now();
const video = existsSync(videoPath) ? await uploadVideo(videoPath) : undefined;
const { scene: out, notes } = await detailScene(scene, video);
if (inFile === outFile) copyFileSync(inFile, inFile.replace(/\.json$/, ".nodetail.json"));
writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(`detail: ${out.objects.filter((o, i) => o.parts !== scene.objects[i].parts).length} objects rebuilt, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const n of notes) console.log("  -", n);
console.log(`-> ${outFile}`);
