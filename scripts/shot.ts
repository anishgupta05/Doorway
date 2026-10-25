// Screenshots the viewer for visual review (and PR attachments).
// Usage: npx tsx scripts/shot.ts <url> <outDir> [name[=Key,Key...][@waitMs] ...]
//   e.g. npx tsx scripts/shot.ts http://localhost:5173 /tmp/shots overview compare=Digit1@4000
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [url = "http://localhost:5173", outDir = "shots", ...steps] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on("console", (m) => m.type() === "error" && console.error("[page]", m.text()));
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(url);
await page.waitForFunction(() => document.querySelector("canvas") !== null, null, { timeout: 30000 });
await page.waitForTimeout(4000);

for (const step of steps.length ? steps : ["overview"]) {
  const [head, wait] = step.split("@");
  const [name, keys] = head.split("=");
  for (const k of keys ? keys.split(",") : []) {
    await page.keyboard.press(k);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(wait ? Number(wait) : 2500);
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}
await browser.close();
