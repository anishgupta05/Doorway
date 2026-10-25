// Screenshots a page after a key sequence. Usage: npx tsx scripts/shot.ts <url> <out.png> [keys,comma,separated]
import { chromium } from "playwright-core";
import { chromePath } from "./chrome";
const [url, out, keys = ""] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 850 }, deviceScaleFactor: Number(process.env.DSF ?? 1) });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
page.on("console", (m) => m.type() === "error" && console.error("[console]", m.text()));
await page.goto(url);
await page.waitForFunction("window.__ready === true", null, { timeout: 60000 }).catch(() => console.error("not ready"));
await page.waitForTimeout(2500);
for (const k of keys.split(",").filter(Boolean)) { await page.keyboard.press(k); await page.waitForTimeout(1500); }
await page.screenshot({ path: out });
await browser.close();
