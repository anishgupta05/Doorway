// Usage: npm run texture -w @doorway/orchestrator -- --id booth1 [--in scene.v0.json] [--out scene.v0.json]
// Paints surface images onto parts that asked for them (run `detail` first). Needs ffmpeg and runs/<id>/video.mp4.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Scene } from "@doorway/schema";
import { readDescription, textureScene } from "./texture.js";

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const id = arg("id");
if (!id) throw new Error("pass --id <run id>");
const dir = resolve(import.meta.dirname, "../../../runs", id);
const scene = Scene.parse(JSON.parse(readFileSync(join(dir, arg("in", "scene.v0.json")!), "utf8")));
const t0 = Date.now();
const { scene: out, made, skipped } = await textureScene(scene, id, dir, readDescription(dir));
writeFileSync(join(dir, arg("out", "scene.v0.json")!), JSON.stringify(out, null, 2));
console.log(`textures: ${made.length} made, ${skipped.length} skipped, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const m of made) console.log("  +", m);
for (const m of skipped) console.log("  -", m);
