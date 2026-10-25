// Usage: npm run affordance -w @doorway/orchestrator -- --id room3 [--in scene.v0.json] [--out scene.v0.json]
// Finds drawers and cabinet doors on furniture and turns them into separate openable objects. Run before `detail`.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Scene } from "@doorway/schema";
import { uploadVideo } from "./model.js";
import { affordanceScene } from "./affordance.js";

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const id = arg("id");
if (!id) throw new Error("pass --id <run id>");
const dir = resolve(import.meta.dirname, "../../../runs", id);
const inFile = join(dir, arg("in", "scene.v0.json")!), outFile = join(dir, arg("out", "scene.v0.json")!);
const scene = Scene.parse(JSON.parse(readFileSync(inFile, "utf8")));
const videoPath = join(dir, "video.mp4");
const video = existsSync(videoPath) ? await uploadVideo(videoPath) : undefined;
const { scene: out, notes } = await affordanceScene(scene, video);
if (inFile === outFile) copyFileSync(inFile, inFile.replace(/\.json$/, ".noaff.json"));
writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(`affordances: ${out.objects.length - scene.objects.length} openable parts added`);
for (const n of notes) console.log("  -", n);
