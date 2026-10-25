// The single adapter for every Gemini call. All calls are cached by content hash, so
// rehearsals and re-runs cost nothing and a demo run can replay with no network.
import { GoogleGenAI, createPartFromUri, type Part } from "@google/genai";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

const ROOT = resolve(import.meta.dirname, "../../..");
const CACHE_DIR = join(ROOT, "runs", ".cache");

export const models = {
  argon: () => process.env.ARGON_MODEL ?? "gemini-4-argon",
  flash: () => process.env.FLASH_MODEL ?? "gemini-3.8-flash",
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
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, `${key}.txt`);
  if (existsSync(file)) return Promise.resolve(readFileSync(file, "utf8"));
  return fn().then((text) => (writeFileSync(file, text), text));
}

/** Shrinks any phone video (vertical or horizontal) to a small, steady-fps mp4 for upload. */
export function compressVideo(input: string, outDir: string, shortSide = 720, fps = 6): string {
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, "video.mp4");
  // ffmpeg applies the phone's rotation flag automatically; scale keeps aspect, short side = shortSide.
  const scale = `scale='if(gt(iw,ih),-2,${shortSide})':'if(gt(iw,ih),${shortSide},-2)'`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-vf", `${scale},fps=${fps}`, "-an", "-c:v", "libx264", "-crf", "28", out]);
  return out;
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
  temperature?: number;
}

/** Structured-output call: the zod schema steers the model, then validates the result. */
export async function callJson<T extends z.ZodType>(c: JsonCall<T>): Promise<z.infer<T>> {
  const jsonSchema = z.toJSONSchema(c.schema, { target: "draft-7" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  flattenTuples(jsonSchema);
  const key = sha(JSON.stringify({ m: c.model, p: c.prompt, s: jsonSchema, v: c.video?.hash, x: c.context, t: c.temperature ?? 0 }));
  const parts: Part[] = [];
  if (c.video) parts.push(createPartFromUri(c.video.uri, c.video.mimeType));
  for (const x of c.context ?? []) parts.push({ text: x });
  parts.push({ text: c.prompt });

  const run = async (extra?: string) => {
    const p = extra ? [...parts, { text: extra }] : parts;
    const r = await ai().models.generateContent({
      model: c.model,
      contents: [{ role: "user", parts: p }],
      config: { responseMimeType: "application/json", responseJsonSchema: jsonSchema, temperature: c.temperature ?? 0 },
    });
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
