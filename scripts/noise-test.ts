// Measures frame-to-frame noise of a still scene: two screenshots 0.8 s apart, compared with PSNR.
// Higher PSNR = steadier image. Usage: DSF=2 npx tsx scripts/noise-test.ts <url> [keys,comma,separated] [label]
import { chromium } from "playwright-core";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromePath } from "./chrome";

const [url, keys = "", label = url] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), "noise-"));
const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 850 }, deviceScaleFactor: Number(process.env.DSF ?? 2) });
await page.goto(url);
await page.waitForFunction("window.__ready === true", null, { timeout: 60000 });
await page.waitForTimeout(2500);
for (const k of keys.split(",").filter(Boolean)) { await page.keyboard.press(k); await page.waitForTimeout(1200); }
const shots = [];
for (let i = 0; i < 3; i++) { const p = join(dir, `s${i}.png`); await page.screenshot({ path: p }); shots.push(p); await page.waitForTimeout(800); }
await browser.close();
const run = (a: string, b: string) => spawnSync("ffmpeg", ["-i", a, "-i", b, "-lavfi", "psnr", "-f", "null", "-"], { encoding: "utf8" }).stderr;
const text = run(shots[0], shots[1]) + run(shots[1], shots[2]);
const vals = [...text.matchAll(/average:(inf|[\d.]+)/g)].map((m) => (m[1] === "inf" ? Infinity : Number(m[1])));
console.log(`${label.padEnd(34)} PSNR between frames: ${vals.map((v) => (v === Infinity ? "identical" : v.toFixed(1) + " dB")).join(", ")}`);
