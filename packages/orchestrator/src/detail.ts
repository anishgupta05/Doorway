// Detail pass: after layout is accepted, Argon rebuilds how each object LOOKS (parts, colours, surface
// pattern) from the footage. It cannot move or resize anything: the schema it answers has no position,
// rotation or size, and applyDetail also refuses parts that stray outside the object's box.
import { z } from "zod";
import { Look, MaterialKind, Part, Scene, checkScene } from "@doorway/schema";
import { callJson, models, type UploadedVideo } from "./model.js";
import { normalizeColors } from "./generate.js";

const DetailPart = Part.extend({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe("hex of this part, exactly #rrggbb, e.g. #1d2a44; every part needs its own") });

export const DetailUpdates = z.object({
  updates: z.array(z.object({
    id: z.string(),
    parts: z.array(DetailPart).max(14).describe("The object rebuilt from boxes, cylinders and spheres, in its own frame: origin at the centre of its base, front toward +z, metres."),
    look: Look.optional(),
    material: MaterialKind.optional().describe("Main material of the object."),
  })),
});
export type DetailUpdates = z.infer<typeof DetailUpdates>;

const PROMPT = `The 3D scene below already has the right layout. Do NOT change any position, rotation or size. Your job is only how objects look.
For every object that is NOT a door, drawer or lamp, return "parts": that object rebuilt from a handful of boxes, cylinders and spheres so it reads as the real thing in the footage.
- Frame: origin at the centre of the object's base, front toward +z, metres, y up. Every part must stay inside the object's size box (size is [width, height, depth]).
- Colours are "#rrggbb" hex, taken from the footage. Never colour words, never pure white.
- Be specific. A laptop is a thin base slab plus a tilted thin lid with a dark screen. A sandal is a flat sole plus two straps over it. A jacket or hoodie on a chair is 6 to 10 lumpy boxes and spheres of different sizes, slightly rotated looking, never one slab. A can is a cylinder with a lid ring and a label band. A stool is a round top on a pedestal with a base. An upholstered chair is a seat, a back, two arms and four legs with rounded proportions (use spheres or cylinders to soften edges).
- Use "look" when a surface has a pattern: weave for upholstery, plush for soft fabric or toys, paper for notebooks and signs.
- Skip objects you cannot see well. Return one update per object you improve, keyed by its id.`;

export async function detailScene(scene: Scene, video?: UploadedVideo): Promise<{ scene: Scene; notes: string[] }> {
  const res = await callJson({ model: models.argon(), prompt: PROMPT, schema: DetailUpdates, video, context: ["SCENE:\n" + JSON.stringify(scene)] });
  return applyDetail(scene, res);
}

/** Applies the updates to a copy. Anything that would move geometry or break a rule is skipped, with a note. */
export function applyDetail(scene: Scene, res: DetailUpdates): { scene: Scene; notes: string[] } {
  const next = structuredClone(scene);
  const notes: string[] = [];
  normalizeColors(res);
  for (const u of res.updates) {
    const o = next.objects.find((x) => x.id === u.id);
    if (!o) { notes.push(`${u.id}: no such object`); continue; }
    if (o.articulation && o.articulation.kind !== "free") { notes.push(`${u.id}: articulated, left alone`); continue; }
    const [w, h, d] = o.size;
    const out = u.parts.filter((p) => {
      const reach = [p.size[0] / 2 + Math.abs(p.offset[0]), p.size[2] / 2 + Math.abs(p.offset[2])];
      return p.offset[1] - p.size[1] / 2 > -h * 0.15 && p.offset[1] + p.size[1] / 2 < h * 1.2 && reach[0] <= w * 0.65 && reach[1] <= d * 0.65;
    });
    if (out.length < u.parts.length) notes.push(`${u.id}: dropped ${u.parts.length - out.length} part(s) outside its box`);
    if (!out.length) continue;
    o.parts = out;
    if (u.look) o.look = u.look;
    if (u.material) o.material = u.material;
  }
  const problems = checkScene(next);
  if (problems.length) throw new Error(`detail pass broke the scene: ${problems.join("; ")}`);
  return { scene: next, notes };
}
