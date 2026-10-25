// Saves one frame of a video as PNG, to check orientation and content. Usage: npx tsx scripts/video-frame.ts <url> <out.png> [seconds]
import { chromium } from "playwright-core";
import { chromePath } from "./chrome";
const [url, out, at = ""] = process.argv.slice(2);
const b = await chromium.launch({ headless: true, executablePath: chromePath() });
const p = await b.newPage({ viewport: { width: 900, height: 900 } });
await p.setContent(`<video id=v src="${url}" muted style="max-width:880px;max-height:880px"></video>`);
// Passed as a string: tsx's transform would inject helpers the page doesn't have.
await p.evaluate(`new Promise((r) => {
  const v = document.getElementById("v");
  const seek = () => { v.addEventListener("seeked", () => r(), { once: true }); v.currentTime = ${at ? Number(at) : "Math.min(6, (v.duration || 12) / 2)"}; };
  if (v.readyState >= 2) seek(); else v.addEventListener("loadeddata", seek, { once: true });
})`);
await p.locator("#v").screenshot({ path: out });
await b.close();
