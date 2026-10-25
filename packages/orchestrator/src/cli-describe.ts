// Usage: npm run describe -w @doorway/orchestrator -- --video path/to/video.mov [--id myrun] [--quality default|hq|raw]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compressVideo, fileSize, uploadVideo, type VideoQuality } from "./model.js";
import { describeFootage } from "./describe.js";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const input = arg("video");
if (!input) throw new Error("pass --video <file>");
const id = arg("id") ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const dir = resolve(import.meta.dirname, "../../../runs", id);

const t0 = Date.now();
// npm runs workspace scripts from the package folder; INIT_CWD is where the user typed the command.
const small = compressVideo(resolve(process.env.INIT_CWD ?? process.cwd(), input), dir, (arg("quality") ?? "default") as VideoQuality);
console.log(`compressed -> ${(fileSize(small) / 1e6).toFixed(1)} MB`);
const video = await uploadVideo(small);
console.log(`uploaded (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
const desc = await describeFootage(video);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "description.json"), JSON.stringify(desc, null, 2));
console.log(`description: ${desc.objects.length} objects, ${desc.room.openings.length} openings, ${((Date.now() - t0) / 1000).toFixed(0)}s total`);
console.log(`-> runs/${id}/description.json`);
if (desc.uncertain.length) console.log("uncertain:", desc.uncertain.join("; "));
