// Usage: npm run generate -w @doorway/orchestrator -- --id room1     (reads runs/room1/description.json and runs/room1/video.mp4)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { uploadVideo } from "./model.js";
import { generateScene } from "./generate.js";
import type { Description } from "./describe.js";

const i = process.argv.indexOf("--id");
const id = i > 0 ? process.argv[i + 1] : undefined;
if (!id) throw new Error("pass --id <run id>");
const dir = resolve(import.meta.dirname, "../../../runs", id);
const description: Description = JSON.parse(readFileSync(join(dir, "description.json"), "utf8"));
const videoPath = join(dir, "video.mp4");

const t0 = Date.now();
const video = existsSync(videoPath) ? await uploadVideo(videoPath) : undefined;
const { scene, problems } = await generateScene(description, video);
writeFileSync(join(dir, "scene.v0.json"), JSON.stringify(scene, null, 2));
console.log(`scene: ${scene.objects.length} objects, ${scene.camera_path.length} camera keys, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(problems.length ? `PROBLEMS:\n  - ${problems.join("\n  - ")}` : "checkScene: clean");
console.log(`-> runs/${id}/scene.v0.json`);
