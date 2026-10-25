import { z } from "zod";
import { Scene } from "./index.js";

// RFC 6902 subset. Fixes are patches, never full rewrites, so guards can diff them.
export const PatchOp = z.object({
  op: z.enum(["add", "replace", "remove"]),
  path: z.string(), // JSON pointer, e.g. /objects/2/pose/position/0
  value: z.unknown().optional(),
});
// Small by design: a fix is a handful of leaf edits (a coordinate, a size, a colour),
// so guards can review it and a bad guess can only do bounded damage.
export const MAX_PATCH_OPS = 12;
export const Patch = z.array(PatchOp).min(1).max(MAX_PATCH_OPS);
export type Patch = z.infer<typeof Patch>;

const unescape = (s: string) => s.replace(/~1/g, "/").replace(/~0/g, "~");

export function applyPatch(scene: Scene, patch: Patch): Scene {
  const next = structuredClone(scene) as any;
  for (const { op, path, value } of patch) {
    const keys = path.split("/").slice(1).map(unescape);
    const last = keys.pop();
    if (last === undefined) throw new Error(`bad path: ${path}`);
    let node = next;
    for (const k of keys) {
      node = node?.[k];
      if (node === undefined) throw new Error(`path not found: ${path}`);
    }
    if (Array.isArray(node)) {
      const i = last === "-" ? node.length : Number(last);
      if (op === "add") node.splice(i, 0, value);
      else if (op === "replace") node[i] = value;
      else node.splice(i, 1);
    } else if (op === "remove") delete node[last];
    else node[last] = value;
  }
  return Scene.parse(next); // throws if the patch breaks the schema
}

// Object ids present in `parent` but missing from `child` (a guard hook uses this).
export function deletedIds(parent: Scene, child: Scene): string[] {
  const kept = new Set(child.objects.map((o) => o.id));
  return parent.objects.map((o) => o.id).filter((id) => !kept.has(id));
}
