// Fixes are RFC 6902 patches over a Scene, never full rewrites, so guards can diff them.
import { z } from "zod";
import { Scene } from "./index.js";

export const PatchOp = z.object({
  op: z.enum(["add", "replace", "remove"]),
  /** JSON pointer, e.g. /objects/2/position/0 */
  path: z.string(),
  value: z.unknown().optional(),
});

/**
 * Small by design: a fix is a handful of leaf edits (a coordinate, a size, a colour),
 * so guards can review it and a bad guess does bounded damage.
 */
export const MAX_PATCH_OPS = 12;
export const Patch = z.array(PatchOp).min(1).max(MAX_PATCH_OPS);
export type Patch = z.infer<typeof Patch>;

const unescape = (s: string) => s.replace(/~1/g, "/").replace(/~0/g, "~");
// Patch paths come from a model, so never let them reach the prototype chain.
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Largest coordinate or size we accept, in metres. A room is never this big. */
const MAX_EXTENT = 100;

/**
 * Checks the things the zod shape cannot: unique ids, sane sizes and positions,
 * interactions that point at real objects, and verbs that match what the object can do.
 * Returns human-readable problems (empty = fine); guards show these as the reject reason.
 */
export function checkScene(scene: Scene): string[] {
  const problems: string[] = [];
  const byId = new Map<string, Scene["objects"][number]>();
  for (const o of scene.objects) {
    if (byId.has(o.id)) problems.push(`duplicate object id ${o.id}`);
    byId.set(o.id, o);
    if (o.size.some((n) => !(n > 0 && n <= MAX_EXTENT))) problems.push(`${o.id}: size must be in (0, ${MAX_EXTENT}] m`);
    if (o.position.some((n) => Math.abs(n) > MAX_EXTENT)) problems.push(`${o.id}: position out of range`);
    if (o.articulation?.kind === "hinge" && o.articulation.range[0] === o.articulation.range[1]) {
      problems.push(`${o.id}: hinge range is zero, it could never open`);
    }
  }
  for (const it of scene.interactions) {
    const target = byId.get(it.target);
    if (!target) problems.push(`interaction ${it.verb} targets missing object ${it.target}`);
    else if (it.verb === "open" && !["hinge", "slide"].includes(target.articulation?.kind ?? "")) {
      problems.push(`${it.target}: cannot open without a hinge or slide`);
    } else if (it.verb === "toggle" && target.articulation?.kind !== "switch") {
      problems.push(`${it.target}: cannot toggle without a switch`);
    }
  }
  return problems;
}

/** Applies the patch to a copy and re-validates; throws if the result is not a valid Scene. */
export function applyPatch(scene: Scene, patch: Patch): Scene {
  const next = structuredClone(scene) as any;
  for (const { op, path, value } of Patch.parse(patch)) {
    const keys = path.split("/").slice(1).map(unescape);
    if (keys.some((k) => FORBIDDEN_KEYS.has(k))) throw new Error(`forbidden path: ${path}`);
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
  const result = Scene.parse(next);
  const problems = checkScene(result);
  if (problems.length) throw new Error(problems.join("; "));
  return result;
}

/** Object ids in `parent` that are missing from `child` (used by the no-deletion guard). */
export function deletedIds(parent: Scene, child: Scene): string[] {
  const kept = new Set(child.objects.map((o) => o.id));
  return parent.objects.map((o) => o.id).filter((id) => !kept.has(id));
}
