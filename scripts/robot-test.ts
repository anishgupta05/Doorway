// Steps through the robot task demo and screenshots each step.
// Usage: npx tsx scripts/robot-test.ts [url] [outDir] [task button text]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromePath } from "./chrome";

const [url = "http://localhost:5173", outDir = "shots", taskText = ""] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url);
await page.waitForTimeout(5000);
await page.keyboard.press("KeyP");
await page.waitForTimeout(1500);
if (taskText) await page.getByRole("button", { name: taskText }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: join(outDir, "robot-0.png") });
for (const [step, wait] of [[1, 9000], [2, 7000], [3, 7000]] as const) {
  await page.keyboard.press("Enter");
  await page.waitForTimeout(wait);
  await page.screenshot({ path: join(outDir, `robot-${step}.png`) });
}
console.log(errors.length ? `page errors:\n  ${errors.join("\n  ")}` : "no page errors");
await browser.close();
