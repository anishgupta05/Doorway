// Texture step: for every part that asks for a surface image (textureHint), take the video frame where its
// object is visible and have the image model paint a flat, evenly lit texture of that surface.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Scene } from "@doorway/schema";
import { callImage } from "./model.js";
import type { Description } from "./describe.js";

const MAX_TEXTURES = 8;

export interface TextureResult { scene: Scene; made: string[]; skipped: string[] }

/** A frame of the footage at `t` seconds as JPEG bytes (960 px wide). */
export function frameAt(video: string, t: number): Buffer {
  return execFileSync("ffmpeg", ["-loglevel", "error", "-ss", String(Math.max(0, t)), "-i", video, "-frames:v", "1", "-vf", "scale=960:-2", "-f", "image2pipe", "-vcodec", "mjpeg", "-"], { maxBuffer: 20e6 });
}

/** The moment an object is clearly visible, from the survey; falls back to the start of the camera path. */
export function seenAt(id: string, description: Description | null, scene: Scene): number {
  const t = description?.objects.find((o) => o.id === id)?.seen_at_s ?? [];
  return t.length ? t[Math.floor(t.length / 2)] : scene.camera_path[0].t;
}

const PROMPT = (hint: string) =>
  `Reference photo attached. Produce a flat, orthographic, evenly lit, square texture image of: ${hint}. It must match the real object in the photo (colours, finish, markings). No perspective, no background, no shadows, no border: the surface fills the whole square.`;

export async function textureScene(scene: Scene, runId: string, runDir: string, description: Description | null): Promise<TextureResult> {
  const next = structuredClone(scene);
  const made: string[] = [], skipped: string[] = [];
  const video = join(runDir, "video.mp4");
  mkdirSync(join(runDir, "tex"), { recursive: true });
  let budget = MAX_TEXTURES;
  for (const o of next.objects) {
    for (const [i, p] of (o.parts ?? []).entries()) {
      if (!p.textureHint) continue;
      if (budget-- <= 0) { skipped.push(`${o.id}#${i}: over the ${MAX_TEXTURES}-image budget`); continue; }
      try {
        const png = await callImage({ prompt: PROMPT(p.textureHint), reference: frameAt(video, seenAt(o.id, description, scene)) });
        const rel = `${runId}/tex/${o.id}_${i}.png`;
        writeFileSync(join(runDir, "..", rel), png);
        p.texture = rel;
        made.push(`${o.id}#${i} ${p.textureHint}`);
      } catch (e) {
        skipped.push(`${o.id}#${i}: ${(e as Error).message}`);
      }
    }
  }
  return { scene: next, made, skipped };
}

export const readDescription = (runDir: string): Description | null => {
  try { return JSON.parse(readFileSync(join(runDir, "description.json"), "utf8")); } catch { return null; }
};
