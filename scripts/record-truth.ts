// Records stand-in "phone footage" for a mock run: the ground-truth scene rendered
// along its camera path with handheld shake, captured in-page with MediaRecorder.
// Writes fixtures/room.webm; `npm run mock` then copies it into runs/mock/video.webm.
// Needs the viewer dev server running (npm run dev).
// Usage: npx tsx scripts/record-truth.ts [baseUrl=http://localhost:5173] [runId=mock]
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromePath } from "./chrome";

const [base = "http://localhost:5173", runId = "mock"] = process.argv.slice(2);
const out = join(import.meta.dirname, "..", "fixtures", "room.webm");

const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(`${base}/?render=1&record=1&phone=1&scene=/runs/${runId}/truth.json`);
await page.waitForFunction(() => window.doorway?.recording !== undefined, null, { timeout: 30000 });
const duration = await page.evaluate(() => window.doorway!.duration);
console.log(`recording ${duration}s…`);
const dataUrl = await page.evaluate(() => window.doorway!.recording!, null);
writeFileSync(out, Buffer.from(dataUrl.split(",")[1], "base64"));
console.log(`wrote ${out}`);
await browser.close();
