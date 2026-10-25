// End-to-end check of the judge's moment: enter walk mode, take control, walk to
// the door, press E, and confirm the door opens and the robot starts moving.
// Usage: npx tsx scripts/walk-test.ts [url] [outDir]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromePath } from "./chrome";

const [url = "http://localhost:5173", outDir = "shots"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(url);
await page.waitForTimeout(4000);
await page.keyboard.press("Digit4");
await page.waitForTimeout(2000);
await page.mouse.click(800, 450);
await page.waitForTimeout(500);
const locked = await page.evaluate(() => document.pointerLockElement !== null);
console.log("pointer locked:", locked);
await page.keyboard.down("KeyW");
await page.waitForTimeout(900);
await page.keyboard.up("KeyW");
await page.waitForTimeout(600);
await page.screenshot({ path: join(outDir, "walk-at-door.png") });
await page.keyboard.press("KeyE");
await page.waitForTimeout(2500);
await page.screenshot({ path: join(outDir, "walk-door-open.png") });
// Step back and to the side to watch the robot come through.
await page.keyboard.down("KeyS");
await page.keyboard.down("KeyA");
await page.waitForTimeout(900);
await page.keyboard.up("KeyS");
await page.keyboard.up("KeyA");
await page.waitForTimeout(2500);
await page.screenshot({ path: join(outDir, "walk-robot.png") });
await browser.close();
