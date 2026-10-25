// Finds a Chromium for playwright-core: $CHROME_PATH, the newest Playwright-cached
// Chromium, or a system Chrome. Lets scripts run without `playwright install`.
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function chromePath(): string | undefined {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(cache)) {
    const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      for (const p of [
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-linux/chrome",
      ]) {
        const full = join(cache, d, p);
        if (existsSync(full)) return full;
      }
    }
  }
  const system = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return existsSync(system) ? system : undefined;
}
