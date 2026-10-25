// The single adapter for every Gemini call. All calls are cached by content hash, so
// rehearsals and re-runs cost nothing and a demo run can replay with no network.
import { GoogleGenAI, createPartFromUri, type Part } from "@google/genai";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

const ROOT = resolve(import.meta.dirname, "../../..");
const CACHE_DIR = join(ROOT, "runs", ".cache");

export const models = {
  argon: () => process.env.ARGON_MODEL ?? "gemini-4-argon",
  image: () => process.env.IMAGE_MODEL ?? "gemini-3.1-flash-image",
};

let client: GoogleGenAI | undefined;
const ai = () => (client ??= new GoogleGenAI({ apiKey: need("GEMINI_API_KEY") }));
function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is empty: fill in .env`);
  return v;
}

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

function cached(key: string, fn: () => Promise<string>): Promise<string> {
  // DOORWAY_NOCACHE=1 measures the model itself (e.g. score repeatability): no reads, no writes.
  if (process.env.DOORWAY_NOCACHE) return fn();
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, `${key}.txt`);
  if (existsSync(file)) return Promise.resolve(readFileSync(file, "utf8"));
  return fn().then((text) => (writeFileSync(file, text), text));
}

/** Shrinks any phone video (vertical or horizontal) to a small, steady-fps mp4 for upload. */
export type VideoQuality = "default" | "hq" | "raw";
const QUALITY: Record<VideoQuality, { shortSide: number; fps: number | null; crf: number }> = {
  default: { shortSide: 720, fps: 6, crf: 28 },
  hq: { shortSide: 1080, fps: 10, crf: 22 },
  raw: { shortSide: 0, fps: null, crf: 18 }, // original resolution and frame rate
};

export function compressVideo(input: string, outDir: string, quality: VideoQuality = "default"): string {
  const { shortSide, fps, crf } = QUALITY[quality];
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, "video.mp4");
  // No ffmpeg on this machine: a modest mp4 can go up as is.
  if (!hasFfmpeg() && /\.mp4$/i.test(input) && statSync(input).size < 60e6) {
    copyFileSync(input, out);
    return out;
  }
  // ffmpeg applies the phone's rotation flag automatically; scale keeps aspect, short side = shortSide.
  const filters = [shortSide ? `scale='if(gt(iw,ih),-2,${shortSide})':'if(gt(iw,ih),${shortSide},-2)'` : "", fps ? `fps=${fps}` : ""].filter(Boolean);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", input, ...(filters.length ? ["-vf", filters.join(",")] : []), "-an", "-c:v", "libx264", "-crf", String(crf), "-pix_fmt", "yuv420p", out]);
  return out;
}

function hasFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export interface UploadedVideo { uri: string; mimeType: string; hash: string }

/** Uploads through the Files API and waits until the file is ACTIVE. Cached by file hash. */
export async function uploadVideo(path: string): Promise<UploadedVideo> {
  const hash = sha(readFileSync(path));
  const memo = join(CACHE_DIR, `upload-${hash}.json`);
  mkdirSync(CACHE_DIR, { recursive: true });
  if (existsSync(memo)) {
    const m = JSON.parse(readFileSync(memo, "utf8"));
    // Files expire after ~48h; re-check it still exists.
    try { const f = await ai().files.get({ name: m.name }); if (f.state === "ACTIVE") return { uri: m.uri, mimeType: m.mimeType, hash }; } catch {}
  }
  let f = await ai().files.upload({ file: path, config: { mimeType: "video/mp4" } });
  while (f.state === "PROCESSING") {
    await new Promise((r) => setTimeout(r, 2000));
    f = await ai().files.get({ name: f.name! });
  }
  if (f.state !== "ACTIVE") throw new Error(`video upload failed: ${f.state}`);
  writeFileSync(memo, JSON.stringify({ name: f.name, uri: f.uri, mimeType: f.mimeType }));
  return { uri: f.uri!, mimeType: f.mimeType ?? "video/mp4", hash };
}

export interface JsonCall<T extends z.ZodType> {
  model: string;
  prompt: string;
  schema: T;
  video?: UploadedVideo;
  /** Extra text parts, e.g. the current scene JSON. */
  context?: string[];
  /** Inline images (e.g. rendered frames), each preceded by its caption. */
  images?: { caption: string; mimeType: string; data: Buffer }[];
  temperature?: number;
}

/** Structured-output call: the zod schema steers the model, then validates the result. */
export async function callJson<T extends z.ZodType>(c: JsonCall<T>): Promise<z.infer<T>> {
  const jsonSchema = z.toJSONSchema(c.schema, { target: "draft-7" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  flattenTuples(jsonSchema);
  const imgs = (c.images ?? []).map((i) => ({ c: i.caption, h: sha(i.data) }));
  const key = sha(JSON.stringify({ m: c.model, p: c.prompt, s: jsonSchema, v: c.video?.hash, x: c.context, i: imgs, t: c.temperature ?? 0 }));
  const parts: Part[] = [];
  if (c.video) parts.push(createPartFromUri(c.video.uri, c.video.mimeType));
  for (const x of c.context ?? []) parts.push({ text: x });
  for (const img of c.images ?? []) {
    parts.push({ text: img.caption });
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data.toString("base64") } });
  }
  parts.push({ text: c.prompt });

  const run = async (extra?: string) => {
    const p = extra ? [...parts, { text: extra }] : parts;
    const r = await withTimeout(() => ai().models.generateContent({
      model: c.model,
      contents: [{ role: "user", parts: p }],
      config: { responseMimeType: "application/json", responseJsonSchema: jsonSchema, temperature: c.temperature ?? 0 },
    }));
    return r.text ?? "";
  };

  const text = await cached(key, () => run());
  const first = c.schema.safeParse(safeJson(text));
  if (first.success) return first.data;
  // One retry with the validation error in the prompt.
  const err = first.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
  const retry = await cached(key + "-retry", () => run(`Your previous answer failed validation:\n${err}\nReturn corrected JSON only.`));
  return c.schema.parse(safeJson(retry));
}

/**
 * A hung request must never stall a live run: give up after CALL_TIMEOUT_MS
 * (default 120 s) and try once more before failing.
 */
async function withTimeout<T>(fn: () => Promise<T>): Promise<T> {
  const ms = Number(process.env.CALL_TIMEOUT_MS ?? 120_000);
  const once = () =>
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`model call timed out after ${ms / 1000}s`)), ms);
      fn().then(
        (v) => (clearTimeout(t), resolve(v)),
        (e) => (clearTimeout(t), reject(e)),
      );
    });
  try {
    return await once();
  } catch (e) {
    if (!/timed out/.test((e as Error).message)) throw e;
    console.warn(`${(e as Error).message}; retrying once`);
    return once();
  }
}

function safeJson(t: string): unknown {
  try { return JSON.parse(t); } catch { return undefined; }
}

export const fileSize = (p: string) => statSync(p).size;

/** Gemini rejects tuple schemas (`items: [a, b, c]`); express them as a fixed-length array instead. */
function flattenTuples(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(flattenTuples);
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  if (Array.isArray(n.items)) {
    const items = n.items as unknown[];
    n.items = items[0];
    n.minItems = n.maxItems = items.length;
  }
  Object.values(n).forEach(flattenTuples);
}

/** Image generation: a reference photo plus an instruction in, a PNG out (cached by both, as base64 text). */
export async function callImage(c: { prompt: string; reference?: Buffer; mimeType?: string }): Promise<Buffer> {
  const key = sha(JSON.stringify({ m: models.image(), p: c.prompt, r: c.reference ? sha(c.reference) : null }));
  const b64 = await cached(key, async () => {
    const parts: Part[] = [];
    if (c.reference) parts.push({ inlineData: { mimeType: c.mimeType ?? "image/jpeg", data: c.reference.toString("base64") } });
    parts.push({ text: c.prompt });
    const r = await ai().models.generateContent({ model: models.image(), contents: [{ role: "user", parts }], config: { responseModalities: ["IMAGE"] } });
    const img = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!img) throw new Error("image model returned no image");
    return img.inlineData!.data!;
  });
  return Buffer.from(b64, "base64");
}
