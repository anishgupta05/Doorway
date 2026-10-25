// Screenshots the viewer's render mode at given video times. Usage:
//   npx tsx scripts/viewer-shot.ts <viewerUrl> <sceneUrl> <outPrefix> <t1,t2,...|overview>
import { chromium } from "playwright-core";
import { chromePath } from "./chrome";

const [base, scene, out, times = "0"] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
const overview = times === "overview";
await page.goto(`${base}/?render=1&scene=${encodeURIComponent(scene)}${overview ? "&view=overview" : ""}`);
await page.waitForFunction("window.doorway && window.doorway.ready", null, { timeout: 90000 });
for (const t of overview ? ["overview"] : times.split(",")) {
  if (!overview) { await page.evaluate(`window.doorway.setTime(${Number(t)})`); await page.waitForTimeout(700); }
  await page.screenshot({ path: `${out}_${t}.png` });
}
await browser.close();
