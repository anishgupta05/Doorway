// Measures frames per second in walk mode while moving, at Retina scale.
// Usage: npx tsx scripts/fps-bench.ts [url]   (viewer dev server must be running)
import { chromium } from "playwright-core";
import { chromePath } from "./chrome";

const url = process.argv[2] ?? "http://localhost:5173";
const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(url);
if (process.env.NOBLUR) await page.addStyleTag({ content: "*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}" });
await page.waitForTimeout(5000);
await page.keyboard.press("Digit4");
await page.waitForTimeout(3000);
await page.mouse.click(720, 450);
await page.waitForTimeout(500);

// A plain string, because tsx injects helpers into compiled functions that do not exist in the page.
const sample = (ms: number) => page.evaluate<number>(`new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; performance.now() - t0 < ${ms} ? requestAnimationFrame(tick) : res(n / ((performance.now() - t0) / 1000)); };
  requestAnimationFrame(tick);
})`);

await page.keyboard.down("KeyW");
const moving = await sample(4000);
await page.keyboard.up("KeyW");
const idle = await sample(3000);
console.log(`walk fps  moving: ${moving.toFixed(1)}   still: ${idle.toFixed(1)}`);
await browser.close();
