// A small local API beside the viewer (dev and preview), so "New video" can really start a run:
//   POST  /api/runs          raw video body (headers: x-filename, x-name) -> { id }; starts the builder
//   GET   /api/runs          every room on disk: id, name, status, when
//   PATCH /api/runs/:id      { name } -> runs/<id>/meta.json (the room's display name)
//   POST  /api/command       { text, room, actions, objects } -> { steps, reply } (plain language → robot job)
// The builder is the orchestrator's own CLIs run in order: describe -> generate -> loop.
// Progress is plain files the viewer polls: runs/<id>/job.json (this file) and progress.json (the loop).
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { Connect, Plugin } from "vite";

const MAX_BYTES = 600 * 1024 * 1024;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EXT = new Set([".mp4", ".mov", ".m4v", ".webm"]);

type Step = { script: string; stage: "watching" | "drawing" | "checking"; args: (id: string, upload: string) => string[] };
const STEPS: Step[] = [
  { script: "describe", stage: "watching", args: (id, upload) => ["--video", upload, "--id", id] },
  { script: "generate", stage: "drawing", args: (id) => ["--id", id] },
  { script: "loop", stage: "checking", args: (id) => ["--id", id, "--iters", "3", "--branches", "3"] },
];

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const readJson = (p: string) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

/** What went wrong, in words a visitor can act on. */
function friendly(log: string, stage: string) {
  if (/GEMINI_API_KEY|API key|API_KEY|\.env|env-file/i.test(log)) return "The room builder isn't set up on this computer yet (it needs an API key).";
  if (/ffmpeg/i.test(log) && /not found|ENOENT/i.test(log)) return "The room builder needs ffmpeg installed to read videos.";
  if (/quota|429|rate/i.test(log)) return "The model is busy right now. Try again in a minute.";
  return stage === "watching" ? "We couldn't make sense of that video. Try a slower walk-around." : "Something went wrong while building the room.";
}

export function apiRuns(runsDir = "../../runs"): Plugin {
  /** When set, uploads must send this code (header x-access-code): the builder spends model credits. */
  const code = process.env.ACCESS_CODE ?? "";
  let runs = "";
  let repo = "";
  const jobPath = (id: string) => join(runs, id, "job.json");
  const setJob = (id: string, patch: Record<string, unknown>) => {
    const next = { ...(readJson(jobPath(id)) ?? {}), ...patch, updatedAt: Date.now() };
    writeFileSync(jobPath(id), JSON.stringify(next, null, 2));
  };

  function runJob(id: string, upload: string, origin: string) {
    const log = join(runs, id, "job.log");
    if (!existsSync(join(repo, ".env")) && !process.env.GEMINI_API_KEY) {
      return setJob(id, { stage: "error", message: "The room builder isn't set up on this computer yet (it needs an API key in the .env file)." });
    }
    let i = 0;
    const next = () => {
      const step = STEPS[i];
      if (!step) return setJob(id, { stage: "done", message: "Your room is ready." });
      setJob(id, { stage: step.stage, step: i });
      const out = createWriteStream(log, { flags: "a" });
      const child = spawn("npm", ["run", step.script, "-w", "@doorway/orchestrator", "--", ...step.args(id, upload)], { cwd: repo, env: { ...process.env, VIEWER_URL: process.env.VIEWER_URL ?? origin } }); // the loop renders through this same server
      let tail = "";
      const take = (b: Buffer) => {
        out.write(b);
        tail = (tail + b.toString()).slice(-4000);
      };
      child.stdout.on("data", take);
      child.stderr.on("data", take);
      child.on("error", (e) => {
        setJob(id, { stage: "error", message: friendly(String(e), step.stage) });
      });
      child.on("close", (code) => {
        out.end();
        if (code === 0) {
          i++;
          next();
        } else if (step.stage === "checking" && existsSync(join(runs, id, "scene.v0.json"))) {
          // The first draft exists even if refinement failed: show it rather than nothing.
          setJob(id, { stage: "done", message: "Your room is ready (the extra checking step didn't finish)." });
        } else setJob(id, { stage: "error", message: friendly(tail, step.stage), detail: tail.trim().split("\n").slice(-3).join("\n") });
      });
    };
    next();
  }

  const json = (res: import("node:http").ServerResponse, code: number, body: unknown) => {
    res.statusCode = code;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  };

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? "").split("?")[0];
    if (!url.startsWith("/api/")) return next();
    // The static copy of the site (another origin) talks to this server directly.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "x-filename, x-name, x-access-code, content-type");
    res.setHeader("Access-Control-Expose-Headers", "x-needs-code");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    // POST /api/command { text, room, actions, objects } -> { steps, reply }: plain language → robot steps.
    if (req.method === "POST" && url === "/api/command") {
      if (code && req.headers["x-access-code"] !== code) return json(res, 401, { error: "That access code isn't right." });
      let body = "";
      req.on("data", (c: Buffer) => (body += c));
      req.on("end", () => {
        const child = spawn("npx", ["tsx", "--env-file-if-exists=.env", "packages/orchestrator/src/cli-command.ts"], { cwd: repo, env: process.env });
        let out = "";
        child.stdout.on("data", (c: Buffer) => (out += c));
        child.on("close", () => {
          try {
            const r = JSON.parse(out);
            json(res, r.error ? 500 : 200, r);
          } catch {
            json(res, 500, { error: "The robot couldn't understand that." });
          }
        });
        child.stdin.end(body);
      });
      return;
    }

    if (!url.startsWith("/api/runs")) return next();

    if (req.method === "GET" && url === "/api/runs") {
      if (code) res.setHeader("x-needs-code", "1");
      const list = existsSync(runs)
        ? readdirSync(runs)
            .filter((d) => ID.test(d) && existsSync(join(runs, d, "manifest.json")) || existsSync(jobPath(d)))
            .map((d) => {
              const m = readJson(join(runs, d, "manifest.json"));
              const meta = readJson(join(runs, d, "meta.json"));
              const job = readJson(jobPath(d));
              return { id: d, name: meta?.name ?? m?.title ?? d, status: job && job.stage !== "done" ? job.stage : m?.status ?? "done", when: statSync(join(runs, d)).mtimeMs };
            })
            .sort((a, b) => b.when - a.when)
        : [];
      return json(res, 200, list);
    }

    if (req.method === "POST" && url === "/api/runs") {
      if (code && req.headers["x-access-code"] !== code) return json(res, 401, { error: "That access code isn't right." });
      const ext = extname(String(req.headers["x-filename"] ?? "video.mp4")).toLowerCase();
      if (!EXT.has(ext)) return json(res, 400, { error: "Please choose an MP4, MOV or WebM video." });
      const name = decodeURIComponent(String(req.headers["x-name"] ?? "")).slice(0, 80).trim();
      const id = `room-${stamp()}`;
      const dir = join(runs, id);
      mkdirSync(dir, { recursive: true });
      const upload = join(dir, `upload${ext}`);
      const file = createWriteStream(upload);
      let size = 0;
      let failed = false;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES && !failed) {
          failed = true;
          file.destroy();
          json(res, 413, { error: "That video is too large (600 MB max)." });
          req.destroy();
        }
      });
      req.pipe(file);
      file.on("finish", () => {
        if (failed) return;
        if (name) writeFileSync(join(dir, "meta.json"), JSON.stringify({ name }));
        setJob(id, { stage: "watching", step: 0, startedAt: Date.now() });
        runJob(id, upload, `http://${req.headers.host ?? "localhost:5173"}`);
        json(res, 200, { id });
      });
      file.on("error", () => !failed && json(res, 500, { error: "Couldn't save the video." }));
      return;
    }

    const m = /^\/api\/runs\/([a-z0-9-]+)$/.exec(url);
    if (req.method === "PATCH" && m && ID.test(m[1])) {
      if (code && req.headers["x-access-code"] !== code) return json(res, 401, { error: "That access code isn't right." });
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (!existsSync(join(runs, m[1]))) return json(res, 404, { error: "No such room." });
        try {
          const name = String(JSON.parse(body).name ?? "").trim().slice(0, 80);
          if (!name) return json(res, 400, { error: "Give the room a name." });
          writeFileSync(join(runs, m[1], "meta.json"), JSON.stringify({ name }));
          json(res, 200, { name });
        } catch {
          json(res, 400, { error: "Bad request." });
        }
      });
      return;
    }
    json(res, 404, { error: "not found" });
  };

  return {
    name: "doorway-api-runs",
    configResolved(c) {
      runs = resolve(c.root, runsDir);
      repo = resolve(c.root, "../..");
    },
    configureServer: (s) => void s.middlewares.use(handler),
    configurePreviewServer: (s) => void s.middlewares.use(handler),
  };
}
