// Affordance pass: Argon counts the drawers and cabinet doors it can see on each piece of furniture, then plain code
// turns them into separate `drawer` / `door` objects on the front of a now-static body, each one openable on its own.
// Layout is untouched: the body keeps its position, rotation and size; children sit inside its front face.
import { z } from "zod";
import type { Scene, SceneObject } from "@doorway/schema";
import { checkScene } from "@doorway/schema";
import { callJson, models, type UploadedVideo } from "./model.js";

export const AffordanceUpdates = z.object({
  updates: z.array(z.object({
    id: z.string(),
    drawers: z.number().int().min(0).max(6).describe("Drawers visible on the front, stacked top to bottom. 0 if none."),
    doors: z.number().int().min(0).max(4).describe("Hinged cabinet doors visible on the front, side by side. 0 if none."),
    hinge: z.enum(["left", "right", "double"]).describe("Doors: 'left'/'right' = hinged on that side of a single door, 'double' = pair opening from the middle. Ignored when doors is 0."),
  })),
});
export type AffordanceUpdates = z.infer<typeof AffordanceUpdates>;

const PROMPT = `Look at the furniture in this scene and the footage. For each piece of furniture that stores things (cabinet, shelf unit, desk, drawer unit, wardrobe, sideboard, bedside table), count the drawers and the hinged cabinet doors you can actually see on its front, and say which way a single door is hinged.
- Only report what is visible. A plain table, chair, sofa, lamp, plant, monitor or box has 0 drawers and 0 doors: do not list it.
- A desk with one shallow drawer under the top has drawers 1.
- Open shelves (no front panel) have 0 drawers and 0 doors.
- Use the object ids from the scene. Do not change anything else.`;

export async function findAffordances(scene: Scene, video?: UploadedVideo): Promise<AffordanceUpdates> {
  return callJson({ model: models.argon(), prompt: PROMPT, schema: AffordanceUpdates, video, context: ["SCENE:\n" + JSON.stringify(scene)] });
}

const STORAGE = new Set<SceneObject["type"]>(["cabinet", "shelf", "table", "other", "box"]);

/** Local (x, z) in the parent's frame to world, for a rotation about y (three.js convention). */
const toWorld = (p: SceneObject, lx: number, lz: number): [number, number] => [
  p.position[0] + lx * Math.cos(p.rotationY) + lz * Math.sin(p.rotationY),
  p.position[2] - lx * Math.sin(p.rotationY) + lz * Math.cos(p.rotationY),
];

/** Adds drawer and cabinet-door objects for each update. The body becomes static; its old whole-body articulation goes. */
export function expandAffordances(scene: Scene, res: AffordanceUpdates): { scene: Scene; notes: string[] } {
  const next = structuredClone(scene);
  const notes: string[] = [];
  const kids: SceneObject[] = [];
  for (const u of res.updates) {
    const p = next.objects.find((o) => o.id === u.id);
    if (!p || !STORAGE.has(p.type) || p.decor || (u.drawers === 0 && u.doors === 0)) continue;
    if (kids.some((k) => k.id.startsWith(`${p.id}_`))) continue;
    const [w, h, d] = p.size;
    delete p.articulation;
    p.physics = { body: "static", mass: Math.max(5, w * h * d * 150), friction: 0.5, collider: "box" };
    next.interactions = next.interactions.filter((i) => i.target !== p.id);
    const desk = p.type === "table";
    const base = desk ? Math.max(0.05, h - Math.min(0.16, h * 0.25) * u.drawers - 0.03) : 0.05; // desk drawers sit just under the top
    const span = desk ? h - 0.03 - base : h - 0.1;
    const doorsH = u.drawers > 0 && u.doors > 0 ? span * 0.6 : span; // doors take the lower part when both exist
    // Drawers: stacked rows across the front, above any doors.
    if (u.drawers) {
      const zone = u.doors > 0 ? span - doorsH : span;
      const rowH = zone / u.drawers;
      for (let k = 0; k < u.drawers; k++) {
        const cd = d * 0.8, ch = rowH - 0.02, cw = w - 0.04;
        const ly = base + (u.doors > 0 ? doorsH : 0) + rowH * (u.drawers - 1 - k) + 0.01;
        const [x, z] = toWorld(p, 0, d / 2 - cd / 2 + 0.005);
        kids.push({
          id: `${p.id}_drawer_${k + 1}`, type: "drawer", label: `${p.label ?? p.id} drawer ${k + 1}`,
          position: [x, p.position[1] + ly, z], rotationY: p.rotationY, size: [cw, ch, cd],
          color: p.color, material: p.material, decor: false,
          articulation: { kind: "slide", axis: [0, 0, 1], range: [0, cd * 0.7] },
          physics: { body: "kinematic", mass: 1, friction: 0.5, collider: "box" },
        });
        next.interactions.push({ verb: "open", target: `${p.id}_drawer_${k + 1}` });
      }
    }
    // Doors: panels side by side on the front, hinged at the outer (or chosen) edge.
    if (u.doors) {
      const cw = (w - 0.04) / u.doors, ch = doorsH - 0.02;
      for (let k = 0; k < u.doors; k++) {
        const cx = -w / 2 + 0.02 + cw * (k + 0.5);
        const left = u.doors === 1 ? u.hinge !== "right" : u.hinge === "double" ? k < u.doors / 2 : u.hinge !== "right" ? true : false;
        const hingeX = left ? -cw / 2 : cw / 2;
        const [x, z] = toWorld(p, cx, d / 2 + 0.012);
        kids.push({
          id: `${p.id}_door_${k + 1}`, type: "door", label: `${p.label ?? p.id} door ${k + 1}`,
          position: [x, p.position[1] + base + 0.01, z], rotationY: p.rotationY, size: [cw, ch, 0.02],
          color: p.color, material: p.material, decor: false,
          articulation: { kind: "hinge", axis: [0, 1, 0], pivot: [hingeX, 0, 0], range: [0, left ? -1.7 : 1.7] },
          physics: { body: "kinematic", mass: 2, friction: 0.5, collider: "box" },
        });
        next.interactions.push({ verb: "open", target: `${p.id}_door_${k + 1}` });
        notes.push(`${p.id}: door ${k + 1} hinged ${left ? "left" : "right"}`);
      }
    }
    notes.push(`${p.id}: ${u.drawers} drawer(s), ${u.doors} door(s)`);
  }
  next.objects.push(...kids);
  const problems = checkScene(next);
  if (problems.length) throw new Error(`affordance pass broke the scene: ${problems.join("; ")}`);
  return { scene: next, notes };
}

export async function affordanceScene(scene: Scene, video?: UploadedVideo) {
  return expandAffordances(scene, await findAffordances(scene, video));
}
