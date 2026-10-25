// Presses through every demo hotkey and reports any page errors per step.
// A clean run prints only "ok" lines. Usage: npx tsx scripts/smoke-ui.ts [url]
import { chromium } from "playwright-core";
import { chromePath } from "./chrome";

const url = process.argv[2] ?? "http://localhost:5173";
const steps: [string, string[], number][] = [
  ["compare", ["Digit1"], 2500],
  ["next iteration", ["ArrowRight"], 1500],
  ["next iteration", ["ArrowRight"], 1500],
  ["prev iteration", ["ArrowLeft"], 1500],
  ["convergence", ["Digit2"], 6000],
  ["overview", ["Digit0"], 1500],
  ["before/after", ["KeyF"], 2000],
  ["before/after off", ["KeyF"], 1500],
  ["build", ["KeyB"], 3000],
  ["tests", ["KeyT"], 4000],
  ["tests off", ["KeyT"], 1000],
  ["night", ["KeyN"], 1500],
  ["export", ["KeyX"], 1500],
  ["export off", ["KeyX"], 800],
  ["backup", ["Digit3"], 1500],
  ["walk", ["Digit4"], 2000],
  ["overview", ["Escape"], 1500],
];

const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
let errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(url);
await page.waitForTimeout(4000);
let failed = 0;
for (const [name, keys, wait] of steps) {
  errors = [];
  for (const k of keys) await page.keyboard.press(k);
  await page.waitForTimeout(wait);
  if (errors.length) {
    failed++;
    console.log(`FAIL  ${name}\n      ${errors.join("\n      ")}`);
  } else console.log(`ok    ${name}`);
}
await browser.close();
process.exit(failed ? 1 : 0);
