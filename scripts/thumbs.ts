// Renders a dollhouse thumbnail for every branch of a run and records it in the manifest.
// Needs the viewer dev server running. Usage: npx tsx scripts/thumbs.ts [runId=mock] [baseUrl]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { RunManifest } from "@doorway/schema";
import { chromePath } from "./chrome";

const [runId = "mock", base = "http://localhost:5173"] = process.argv.slice(2);
const dir = join(import.meta.dirname, "..", "runs", runId);
const manifest = RunManifest.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));

const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 432, height: 312 }, deviceScaleFactor: 1 });
for (const it of manifest.iterations) {
  for (const b of it.branches) {
    const rel = b.scene.replace(/scene\.json$/, "thumb.png");
    await page.goto(`${base}/?render=1&view=overview&scene=/runs/${runId}/${b.scene}`);
    await page.waitForFunction(() => window.doorway?.ready, null, { timeout: 30000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(dir, rel) });
    b.thumb = rel;
    console.log(rel);
  }
}
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await browser.close();
