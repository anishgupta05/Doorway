// Stage 4: Argon proposes N different small patches that address the issues.
import { z } from "zod";
import { MAX_PATCH_OPS, ObjectType, Patch, type Scene } from "@doorway/schema";
import { callJson, models, type UploadedVideo } from "./model.js";
import type { Comparison } from "./compare.js";

export interface Proposal {
  hypothesis: string;
  patch: Patch;
}

// The value travels as a JSON string so one response schema fits numbers, arrays and whole objects
// (adding a missing object needs the latter). The real Patch schema validates afterwards.
const Proposals = z.object({
  proposals: z.array(
    z.object({
      hypothesis: z.string().describe("One short sentence: what this branch tries and why it may fix the issues."),
      patch: z
        .array(
          z.object({
            op: z.enum(["add", "replace", "remove"]),
            path: z.string().describe("JSON pointer into scene.json, e.g. /objects/3/position/0 or /objects/- to append"),
            value_json: z.string().optional().describe("The new value, JSON-encoded (omit for remove), e.g. \"-1.2\" or \"[0.5, 0, 1]\" or a whole object."),
          }),
        )
        .min(1)
        .max(MAX_PATCH_OPS),
    }),
  ),
});

const PROMPT = (n: number) => `You are repairing a 3D scene so it matches real footage. You are given the scene JSON, a list of reviewed issues, and notes on earlier attempts that failed.

Propose exactly ${n} DIFFERENT repairs. Each is an RFC 6902 JSON patch (ops add / replace / remove) of AT MOST 12 operations, and each op edits a single leaf value, for example:
  { "op": "replace", "path": "/objects/3/position/0", "value": -1.2 }
Rules:
- Paths index into the scene JSON exactly as given (objects are addressed by array index, so count carefully).
- Never remove an object and never remove an articulation, physics or interactions entry. Do not change object ids.
- To add a missing object, use { "op": "add", "path": "/objects/-", "value_json": "<full object JSON>" } with every field the existing objects have (id, type, position, rotationY, size, color as "#rrggbb", ...). "type" MUST be one of: ${ObjectType.options.join(", ")}. Small items with no matching type (laptop, jacket, can, sandals) use "other" with a descriptive label. Add its interaction too if it can be used.
- Whiteboards, murals, posters, windows and brick are wall SURFACES, not objects: change a wall colour or material or add a thin (<= 0.1 m) wall-mounted panel under 2 m long. Never add anything longer than 75% of the room or taller than the room.
- Objects with "decor": true are purely visual: never add or change "articulation" or "physics" on them. To make something usable or movable, leave decor false (do not flip it to true on an object that has articulation or physics).
- Paths contain no spaces: "/objects/3/position/0", never "/ objects ...".
- If an issue says an interaction test fails (a door hits a wall, a drawer is blocked), fix that first: flip the hinge side/pivot, shrink the range, or move what is in the way.
- Keep objects inside the room and off each other. Positions are the footprint centre at the base.
- Keep every repair SMALL: touch at most 3 objects, and move an object by at most 0.4 m unless an issue says it is in the wrong place entirely. A repair that rearranges the whole room is rejected. The room is small: moving one object into another's space, or into the 0.45 m clear zone in front of a door, is rejected too (tiny overlaps are nudged apart automatically).
- The ${n} repairs must take different approaches: the first fixes only the single worst issue precisely; each other one targets a DIFFERENT issue (different object) from the list. Do not submit near-duplicates, and do not bundle every issue into one patch.
- Do not repeat anything listed under FAILED ATTEMPTS.`;

export async function proposeFixes(
  scene: Scene,
  comparison: Comparison,
  n: number,
  lessons: string[] = [],
  video?: UploadedVideo,
): Promise<Proposal[]> {
  const r = await callJson({
    model: models.argon(),
    prompt: PROMPT(n),
    temperature: process.env.DOORWAY_TEMP ? Number(process.env.DOORWAY_TEMP) : undefined,
    schema: Proposals,
    video,
    context: [
      "SCENE:\n" + JSON.stringify(scene),
      "ISSUES:\n" + JSON.stringify(comparison.issues),
      "FAILED ATTEMPTS:\n" + (lessons.length ? lessons.map((l) => `- ${l}`).join("\n") : "(none yet)"),
    ],
  });
  return r.proposals.slice(0, n).map((p) => {
    try {
      const ops = p.patch.map((o) => ({ op: o.op, path: o.path, ...(o.value_json !== undefined ? { value: coerceAdded(o.path, JSON.parse(o.value_json)) } : {}) }));
      return { hypothesis: p.hypothesis, patch: Patch.parse(ops) };
    } catch (e) {
      // Surface as an unusable patch the loop will reject with a readable reason.
      return { hypothesis: p.hypothesis, patch: [{ op: "replace" as const, path: "/__unparseable__", value: String((e as Error).message).slice(0, 80) }] };
    }
  });
}

/** A model-invented object type would fail the whole patch; fall back to "other" instead. */
function coerceAdded(path: string, value: unknown): unknown {
  if (path === "/objects/-" && value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (!ObjectType.safeParse(v.type).success) return { ...v, label: v.label ?? String(v.type ?? "item"), type: "other" };
  }
  return value;
}
