// Task folder names, shared with the viewer's task API (apps/viewer/api-tasks.ts). No other imports, so Vite's config can load it.
import { createHash } from "node:crypto";

/** "Push the chair next to the sofa!" -> "push-the-chair-next-to-the-sofa-3f2a" */
export const taskId = (request: string) =>
  `${request.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${createHash("sha256").update(request.trim()).digest("hex").slice(0, 4)}`;
