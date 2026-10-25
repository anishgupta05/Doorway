// Serves the repo-level runs/ directory at /runs/* in both `vite` and `vite preview`,
// so the viewer always reads whatever the orchestrator last wrote (no copy step).
// Supports HTTP Range so <video> can seek.
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import type { Connect, Plugin } from "vite";

const TYPES: Record<string, string> = {
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

/** `runsDir` is resolved against the Vite project root (apps/viewer), not this file. */
export function serveRuns(runsDir = "../../runs"): Plugin {
  let root = "";
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url?.startsWith("/runs/")) return next();
    const rel = decodeURIComponent(req.url.split("?")[0].slice("/runs/".length));
    // Raw uploads and build logs are private: the viewer never needs them, and this server can be public.
    if (/(^|\/)(upload\.[^/]*|job\.log)$/.test(rel)) {
      res.statusCode = 404;
      return res.end("not found");
    }
    const file = resolve(join(root, rel));
    if (!file.startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) {
      res.statusCode = 404;
      return res.end("not found");
    }
    const size = statSync(file).size;
    res.setHeader("Content-Type", TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Accept-Ranges", "bytes");
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
      res.setHeader("Content-Length", end - start + 1);
      return createReadStream(file, { start, end }).pipe(res);
    }
    res.setHeader("Content-Length", size);
    createReadStream(file).pipe(res);
  };
  return {
    name: "doorway-serve-runs",
    configResolved: (config) => void (root = resolve(config.root, runsDir)),
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}
