import { chromium } from "playwright-core";
import { chromePath } from "./chrome";
const b = await chromium.launch({ headless: true, executablePath: chromePath(), args: ["--use-angle=metal","--enable-gpu","--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1440, height: 810 } });
p.on("pageerror", e => console.log("[err]", e.message));
await p.goto("http://localhost:5176/");
await p.waitForTimeout(5000);
if (process.argv[3]) { await p.getByText(process.argv[3], { exact: true }).first().click(); await p.waitForTimeout(3500); }
await p.screenshot({ path: process.argv[2] });
await b.close();
