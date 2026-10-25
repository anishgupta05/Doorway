// Robot tasks beside the viewer (dev and preview), the same way api-runs.ts starts room builds:
//   GET  /api/tasks?run=<id>   the room's tasks (runs/<run>/tasks/index.json), [] if it has none
//   POST /api/tasks   { run, request } -> { id }; starts the task CLI (clarify -> train -> verify)
// Progress is plain files the viewer polls: runs/<run>/tasks/<id>/job.json, attempt_<n>/train_log.json.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Connect, Plugin } from "vite";
import { taskId } from "../../packages/orchestrator/src/task/id.ts";

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const running = new Set<string>();

export function apiTasks(runsDir = "../../runs"): Plugin {
  let runs = "";
  let repo = "";

  const json = (res: import("node:http").ServerResponse, code: number, body: unknown) => {
    res.statusCode = code;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  };

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const [url, query = ""] = (req.url ?? "").split("?");
    if (url !== "/api/tasks") return next();
    if (req.method === "GET") {
      const run = new URLSearchParams(query).get("run") ?? "";
      const index = join(runs, run, "tasks", "index.json");
      if (!ID.test(run) || !existsSync(index)) return json(res, 200, []);
      try {
        return json(res, 200, JSON.parse(readFileSync(index, "utf8")));
      } catch {
        return json(res, 200, []);
      }
    }
    if (req.method !== "POST") return json(res, 405, { error: "GET or POST" });
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let run = "";
      let request = "";
      try {
        ({ run, request } = JSON.parse(body));
        request = String(request ?? "").trim().slice(0, 200);
      } catch {
        return json(res, 400, { error: "Bad request." });
      }
      if (!ID.test(run) || !existsSync(join(runs, run))) return json(res, 404, { error: "No such room." });
      if (!request) return json(res, 400, { error: "Tell the robot what to do." });
      if (!existsSync(join(repo, "packages/sim/.venv/bin/python")))
        return json(res, 503, { error: "The robot simulator isn't set up on this computer yet (see packages/sim/README.md)." });
      const id = taskId(request);
      const key = `${run}/${id}`;
      if (running.has(key)) return json(res, 200, { id });
      running.add(key);
      const dir = join(runs, run, "tasks", id);
      mkdirSync(dir, { recursive: true });
      const log = createWriteStream(join(dir, "task.log"));
      const child = spawn("npm", ["run", "task", "-w", "@doorway/orchestrator", "--", "--id", run, request], { cwd: repo, env: process.env });
      child.stdout.pipe(log);
      child.stderr.pipe(log);
      child.on("close", () => running.delete(key));
      json(res, 200, { id });
    });
  };

  return {
    name: "doorway-api-tasks",
    configResolved(c) {
      runs = resolve(c.root, runsDir);
      repo = resolve(c.root, "../..");
    },
    configureServer: (s) => void s.middlewares.use(handler),
    configurePreviewServer: (s) => void s.middlewares.use(handler),
  };
}
