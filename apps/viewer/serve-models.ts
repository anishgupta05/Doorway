// Serves the repo-level assets/models directory (CC0 furniture from Poly Haven) at /models/*
// in both `vite` and `vite preview`, so the viewer and the realism page share one copy.
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import type { Connect, Plugin } from "vite";

const TYPES: Record<string, string> = {
  ".gltf": "model/gltf+json",
  ".glb": "model/gltf-binary",
  ".bin": "application/octet-stream",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

export function serveModels(dir = "../../assets/models"): Plugin {
  let root = "";
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url?.startsWith("/models/")) return next();
    const file = resolve(join(root, decodeURIComponent(req.url.split("?")[0].slice("/models/".length))));
    if (!file.startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) {
      res.statusCode = 404;
      return res.end("not found");
    }
    res.setHeader("Content-Type", TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Content-Length", statSync(file).size);
    createReadStream(file).pipe(res);
  };
  return {
    name: "doorway-serve-models",
    configResolved: (config) => void (root = resolve(config.root, dir)),
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}
