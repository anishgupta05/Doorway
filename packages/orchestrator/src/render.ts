// Renders scenes through the viewer's headless render mode (/?render=1), so the frames
// Argon critiques come from exactly the renderer the judges see. Needs the viewer
// running (npm run dev, or npm run demo) at VIEWER_URL.
import { chromium, type Browser, type Page } from "playwright-core";
import { chromePath } from "../../../scripts/chrome.ts";

const VIEWER_URL = () => process.env.VIEWER_URL ?? "http://localhost:5173";

declare global {
  interface Window {
    doorway?: { ready: boolean; duration: number; setTime: (t: number) => void };
  }
}

export class Renderer {
  private browser?: Browser;

  async start() {
    this.browser = await chromium.launch({
      headless: true,
      executablePath: chromePath(),
      args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
    });
    return this;
  }

  async stop() {
    await this.browser?.close();
  }

  private async open(sceneUrl: string, opts: { overview?: boolean; width: number; height: number }): Promise<Page> {
    if (!this.browser) throw new Error("renderer not started");
    const page = await this.browser.newPage({ viewport: { width: opts.width, height: opts.height } });
    const q = new URLSearchParams({ render: "1", scene: sceneUrl });
    if (opts.overview) q.set("view", "overview");
    await page.goto(`${VIEWER_URL()}/?${q}`);
    await page.waitForFunction(() => window.doorway?.ready, null, { timeout: 45_000 });
    return page;
  }

  /** Frames along the camera path at the given times (seconds into the footage). JPEG buffers. */
  async frames(runId: string, sceneRel: string, times: number[]): Promise<Buffer[]> {
    const page = await this.open(`/runs/${runId}/${sceneRel}`, { width: 960, height: 540 });
    const out: Buffer[] = [];
    for (const t of times) {
      await page.evaluate((x) => window.doorway!.setTime(x), t);
      await page.waitForTimeout(350);
      out.push(await page.screenshot({ type: "jpeg", quality: 82 }));
    }
    await page.close();
    return out;
  }

  /** Dollhouse thumbnail for the convergence panel. */
  async thumb(runId: string, sceneRel: string, outPath: string) {
    const page = await this.open(`/runs/${runId}/${sceneRel}`, { overview: true, width: 432, height: 312 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: outPath });
    await page.close();
  }
}

/** Evenly spaced sample times across the camera path, skipping the very ends. */
export function sampleTimes(duration: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => Number((((i + 0.5) / n) * duration).toFixed(2)));
}
