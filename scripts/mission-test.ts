// Queues a robot job through the panel, runs it, and screenshots it mid-way and at the end.
// Usage: npx tsx scripts/mission-test.ts [url] [outDir] [item …]  (items: "locker:7", or chip text)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromePath } from "./chrome";

const [url = "http://localhost:5173", outDir = "shots", ...items] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url);
await page.waitForTimeout(5000);
await page.keyboard.press("KeyP");
await page.waitForTimeout(1500);
for (const it of items) {
  if (it.startsWith("locker:")) await page.getByTitle(`Open locker ${it.slice(7)}`).first().click();
  else await page.getByRole("button", { name: it }).first().click();
  await page.waitForTimeout(250);
}
await page.screenshot({ path: join(outDir, "mission-0-queued.png") });
await page.getByRole("button", { name: /Run the job|Run again/ }).click();
for (const [n, wait] of [[1, 9000], [2, 12000], [3, 14000]] as const) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: join(outDir, `mission-${n}.png`) });
}
console.log(errors.length ? `page errors:\n  ${errors.join("\n  ")}` : "no page errors");
await browser.close();
