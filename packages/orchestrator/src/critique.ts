// Stage 3 (compare): Argon watches the real footage next to frames rendered from our
// scene along the same camera path, and lists concrete mismatches.
// Stage 4 (propose): Argon writes N *different* candidate fixes as small JSON patches,
// so the loop can try them in parallel and let guards + scores pick the survivor.
import { z } from "zod";
import { Issue, MAX_PATCH_OPS, type Patch, type Scene } from "@doorway/schema";
import { callJson, models, type UploadedVideo } from "./model.js";

const IGNORE = `Ignore: lighting, shadows, textures and material realism (the render is deliberately stylised);
anything seen through a window or glass (it is outside the room); differences under ~10 cm; clutter smaller than a book.`;

export const Critique = z.object({
  issues: z.array(Issue).max(12),
  match: z.number().min(0).max(1).describe("How closely the reconstruction matches the room overall, 0..1"),
});
export type Critique = z.infer<typeof Critique>;

export async function compare(opts: { video: UploadedVideo; scene: Scene; frames: Buffer[]; times: number[] }): Promise<Critique> {
  const prompt = `You are checking a 3D reconstruction of the room in this video.
The images above are renders of our reconstruction, taken from the same camera path as the footage at the stated timestamps.
Compare each render with what the footage shows at that moment, and the room as a whole.

List concrete mismatches only: wrong position (say how far and which way), wrong size, wrong orientation,
wrong colour, a missing object (give it a new snake_case id like chair_3), an object that should not be there,
or a door/drawer hinged or sliding the wrong way. Use the scene's object ids. Most important first.
${IGNORE}
"match" is your overall 0..1 judgement of how faithful the reconstruction is.`;
  return callJson({
    model: models.argon(),
    prompt,
    schema: Critique,
    video: opts.video,
    context: ["CURRENT SCENE (scene.json):\n" + JSON.stringify(opts.scene)],
    images: opts.frames.map((data, i) => ({ caption: `RENDER at t=${opts.times[i]}s:`, mimeType: "image/jpeg", data })),
  });
}

/** Model-facing patch op: the value travels as a JSON string so any shape fits one schema. */
const ProposedOp = z.object({
  op: z.enum(["add", "replace", "remove"]),
  path: z.string().describe("JSON pointer into scene.json, e.g. /objects/3/position or /objects/-"),
  value_json: z.string().optional().describe("The new value, JSON-encoded. Omit for remove."),
});
const Proposal = z.object({
  fixes: z.array(
    z.object({
      hypothesis: z.string().describe("One line: what this fix changes and why, e.g. 'Move desk_1 0.4 m west to sit against the wall'"),
      ops: z.array(ProposedOp).min(1).max(MAX_PATCH_OPS),
    }),
  ),
});

export type Candidate = { hypothesis: string; patch: Patch | null; error?: string };

export async function propose(opts: { scene: Scene; issues: Issue[]; n: number; video?: UploadedVideo; seed?: number }): Promise<Candidate[]> {
  const index = opts.scene.objects.map((o, i) => `/objects/${i} = ${o.id} (${o.type})`).join("\n");
  const prompt = `Propose ${opts.n} DIFFERENT candidate fixes for this scene, given the issues found when comparing it to the footage.
Each fix is a small JSON patch (RFC 6902 subset: add / replace / remove, at most ${MAX_PATCH_OPS} ops) over scene.json.
Make the fixes genuinely different: tackle different issues, or the same issue in different ways, so they can be tried in parallel.

Rules (patches that break these are rejected automatically):
- Never remove an object, and never remove or change the kind of an articulation.
- To add a missing object use { "op": "add", "path": "/objects/-", "value_json": "<full object JSON>" } and also add its interaction if it can be used.
- Paths use array indices; the index map is below. Prefer replacing whole small values, e.g. /objects/3/position with "[x, y, z]".
- Keep the scene conventions: metres, y-up, position = footprint centre at the object's base, front faces +z before rotationY.
- Every value_json must be valid JSON.

OBJECT INDEX:
${index}`;
  const res = await callJson({
    model: models.argon(),
    prompt,
    schema: Proposal,
    video: opts.video,
    context: ["CURRENT SCENE (scene.json):\n" + JSON.stringify(opts.scene), "ISSUES:\n" + JSON.stringify(opts.issues)],
    temperature: 0.7,
  });
  return res.fixes.slice(0, opts.n).map((f) => {
    try {
      const patch = f.ops.map((o) => ({ op: o.op, path: o.path, ...(o.value_json !== undefined ? { value: JSON.parse(o.value_json) } : {}) }));
      return { hypothesis: f.hypothesis, patch };
    } catch (e) {
      return { hypothesis: f.hypothesis, patch: null, error: `unparseable value_json (${(e as Error).message})` };
    }
  });
}

/**
 * The number the loop optimises. Argon's own judgement, discounted by the open issues so a
 * branch can't score well while leaving serious problems. Higher is better; 1 is perfect.
 */
export function score(c: Critique): number {
  const penalty = c.issues.reduce((p, i) => p + (i.severity === "high" ? 0.08 : i.severity === "medium" ? 0.04 : 0.015), 0);
  return Math.max(0, Math.min(1, Number((c.match - penalty * 0.5).toFixed(3))));
}
