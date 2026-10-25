// Renders a scene with every articulated object opened / switched on, to check the moving parts.
// Usage: npx tsx scripts/open-all.ts <scene url under /runs> <out.png> [viewer url]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { Scene } from "@doorway/schema";
import { chromePath } from "./chrome";

const [sceneUrl, out, base = "http://localhost:5173"] = process.argv.slice(2);
const scene = Scene.parse(JSON.parse(readFileSync(join(import.meta.dirname, "..", sceneUrl), "utf8")));
const ids = scene.objects.filter((o) => o.articulation && o.articulation.kind !== "free").map((o) => o.id);
const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(`${base}/?render=1&view=overview&scene=${encodeURIComponent(sceneUrl)}`);
await page.waitForFunction("window.doorway && window.doorway.ready", null, { timeout: 45000 });
for (const id of ids) await page.evaluate(`window.doorway.open(${JSON.stringify(id)}, 1)`);
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
console.log(`opened ${ids.length}: ${ids.join(", ")}`);
await browser.close();
