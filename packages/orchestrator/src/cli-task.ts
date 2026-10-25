// Usage: npm run task -- --id roomc "push the door open"
// Clarify → train → verify a robot task in a run's verified room (runs/<id>/tasks/<task>/).
// Uses Argon when GEMINI_API_KEY is set, the offline stand-ins otherwise.
import { resolve } from "node:path";
import { runTask } from "./task/run.js";

const args = process.argv.slice(2);
const i = args.indexOf("--id");
const id = i >= 0 ? args[i + 1] : undefined;
const request = args.filter((_, k) => k !== i && k !== i + 1).join(" ").trim();
if (!id || !request) throw new Error('usage: task --id <run id> "<what the robot should do>"');

const job = await runTask(resolve(import.meta.dirname, "../../../runs"), id, request);
console.log(`\n${job.status.toUpperCase()}: ${job.message}\n-> runs/${id}/tasks/${job.id}/`);
process.exit(job.status === "done" ? 0 : 1);
