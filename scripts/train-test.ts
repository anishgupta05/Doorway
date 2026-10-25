// Opens the robot panel, picks a physics-trained task from "Tasks in this room", and
// screenshots the replay as it plays (robot, door, pushed objects moving as in MuJoCo).
// Usage: npx tsx scripts/train-test.ts [url] [outDir] [task text, e.g. "Push the door open"]
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { chromePath } from "./chrome";

const [url = "http://localhost:5173", outDir = "shots", taskText = "Push the door open"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${new URL(r.url()).pathname}`));
await page.goto(url);
await page.waitForTimeout(5000);
await page.keyboard.press("KeyP");
await page.waitForTimeout(1500);
await page.screenshot({ path: join(outDir, "train-0-panel.png") });
await page.getByRole("button", { name: taskText }).last().click();
for (const [i, wait] of [[1, 1200], [2, 1200], [3, 1500], [4, 2500]] as const) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: join(outDir, `train-${i}.png`) });
  // Dev builds expose the store: report what the replay is driving (doors open 0..1, pushed objects).
  const state = await page.evaluate(() => {
    const s = (window as unknown as { __app?: { getState: () => { joints: Record<string, number>; pushes: Record<string, number[]> } } }).__app?.getState();
    return s ? { joints: s.joints, pushes: s.pushes } : null;
  });
  console.log(`train-${i}`, JSON.stringify(state, (_, v) => (typeof v === "number" ? Number(v.toFixed(2)) : v)));
}
console.log(errors.length ? `page errors:\n  ${[...new Set(errors)].join("\n  ")}` : "no page errors");
await browser.close();
