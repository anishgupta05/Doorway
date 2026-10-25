// Types a plain-language job into the robot panel and screenshots the robot doing it.
// Usage: npx tsx scripts/ask-test.ts [url] [outDir] "instruction"
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromePath } from "./chrome";

const [url = "http://localhost:5173", outDir = "shots", text = "open the top left locker, then turn on the printer"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url);
await page.waitForTimeout(5000);
await page.keyboard.press("KeyP");
await page.waitForTimeout(1500);
await page.getByPlaceholder("Tell the robot what to do…").fill(text);
await page.getByRole("button", { name: "Go" }).click();
await page.waitForFunction("![...document.querySelectorAll('button')].some((b) => b.textContent === 'Thinking…')", null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: join(outDir, "ask-1.png") });
await page.waitForTimeout(18000);
await page.screenshot({ path: join(outDir, "ask-2.png") });
console.log(errors.length ? `page errors:\n  ${errors.join("\n  ")}` : "no page errors");
await browser.close();
