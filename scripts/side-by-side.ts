// Records a room's final scene along its camera path and joins it with the original footage,
// footage on the left and the replica on the right, into docs/media/<runId>.mp4.
// Needs the viewer dev server running (npm run dev) and ffmpeg.
// Usage: npx tsx scripts/side-by-side.ts <runId> [baseUrl=http://localhost:5173]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromePath } from "./chrome";

const [runId, base = "http://localhost:5173"] = process.argv.slice(2);
if (!runId) throw new Error("usage: side-by-side.ts <runId> [baseUrl]");
const root = join(import.meta.dirname, "..");
const dir = join(root, "runs", runId);
const footage = ["video.mp4", "video.webm"].map((f) => join(dir, f)).find(existsSync);
if (!footage) throw new Error(`runs/${runId} has no video`);

const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const last = m.iterations[m.iterations.length - 1];
const scene = last.branches.find((b: { i: number }) => b.i === last.selected).scene;
console.log(`final scene: runs/${runId}/${scene}`);

const out = join(root, "docs", "media");
mkdirSync(out, { recursive: true });
const render = join(out, `${runId}.render.webm`);

const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(`${base}/?render=1&record=1&scene=/runs/${runId}/${scene}`);
await page.waitForFunction(() => window.doorway?.recording !== undefined, null, { timeout: 120000 });
const dataUrl = await page.evaluate(() => window.doorway!.recording!, null);
writeFileSync(render, Buffer.from(dataUrl.split(",")[1], "base64"));
await browser.close();

// Both halves scaled to the same height; the shorter one holds its last frame.
const mp4 = join(out, `${runId}.mp4`);
execFileSync(
  "ffmpeg",
  [
    "-y", "-v", "error", "-i", footage, "-i", render,
    "-filter_complex",
    "[0:v]scale=-2:540,setsar=1,tpad=stop_mode=clone:stop_duration=5[a];[1:v]scale=-2:540,setsar=1,tpad=stop_mode=clone:stop_duration=5[b];[a][b]hstack=inputs=2:shortest=1",
    "-an", "-c:v", "libx264", "-crf", "28", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4,
  ],
  { stdio: "inherit" },
);
console.log(`wrote ${mp4}`);
