// Stage 2: Argon turns the description (and the footage) into a schema-valid scene.json.
import { Scene, checkScene } from "@doorway/schema";
import { callJson, models, type UploadedVideo } from "./model.js";
import type { Description } from "./describe.js";

const CONVENTIONS = `Scene conventions (follow exactly):
- Metres, y-up. Origin is the centre of the room's floor. Room width is along x, depth along z, height along y.
- North wall is at z = -depth/2, south at z = +depth/2, east at x = +width/2, west at x = -width/2.
- An object's "position" is the centre of its footprint at its base, so y is the bottom of the object (0 for floor-standing, the tabletop height for things on a desk).
- "size" is [width, height, depth] in the object's own frame. Its front faces local +z before "rotationY" (radians, about y) is applied. rotationY = 0 faces south, PI faces north, PI/2 faces east... verify against the description's "facing".
- Opening "offset" is the centre of the opening measured from the wall's midpoint (+x for north/south walls, +z for east/west walls).
- Objects must sit inside the room and must not overlap each other, except things resting on a surface.
- Hinged door: articulation { kind: "hinge", axis: [0,1,0], pivot: [-width/2, 0, 0] or [+width/2, 0, 0] in the door's local frame, range: [0, 1.6] }. The pivot side is the hinge side.
- Drawers use kind "slide" with range [0, depth*0.7]. Lamps and monitors use kind "switch"; lamps also get a "light". Pushable furniture (chairs) use kind "free".
- Every object in the survey must appear exactly once, with the same id. The survey's x_m, z_m, base_y_m are in this same frame: use them as the position unless the footage clearly contradicts them, and refine only when you can justify it.
- Room width, depth and height come from the survey room, adjusted only if the footage clearly shows otherwise.
- interactions: one "open" for each door/drawer, one "toggle" (effect "light") for each lamp, one "push" for each chair.
- Any object with can_do "none" or "pushable" and no switch/hinge/slide has NO "articulation" field unless it is pushable (then kind "free"). Never emit "articulation": {}.
- physics: door "kinematic", chairs "dynamic" (mass 4-8 kg), everything else "static". Realistic masses in kg.
- camera_path: at least 2 keys. Use the timestamps where the description says objects were seen, with the camera at eye height (about 1.5 m), inside the room, looking at the objects visible at that time. If the footage shows the camera moving, follow that motion.
- Survey objects with decor=true become scene objects with decor: true: small, resting on their surface (position y = base_y_m), no interactions, and the fields "articulation" and "physics" must be left out entirely (never an empty object). Use "parts" (a few boxes, cylinders, spheres with real colours) so a bottle looks like a bottle and a laptop like a laptop. Keep the survey's "look".
- Room: copy wall_look to room.wallLook and unseen_walls to room.unseenWalls.
- "name" is a short title for the room. version is 1.`;

export async function generateScene(description: Description, video?: UploadedVideo) {
  const prompt = `Build the 3D scene for this room as a scene.json. A survey written from the footage is attached as JSON${video ? ", along with the footage itself, so check it against the video when they disagree" : ""}.

${CONVENTIONS}`;
  const scene = await callJson({
    model: models.argon(),
    prompt,
    schema: Scene,
    video,
    context: ["ROOM SURVEY:\n" + JSON.stringify(description)],
  });
  normalizeColors(scene);
  // Decor is garnish: whatever the model attached, it cannot move or have physics.
  const decorIds = new Set(description.objects.filter((o) => o.decor).map((o) => o.id));
  for (const o of scene.objects) {
    if (o.decor || decorIds.has(o.id)) {
      o.decor = true;
      delete o.articulation;
      delete o.physics;
    }
  }
  scene.interactions = scene.interactions.filter((i) => !decorIds.has(i.target));
  const problems = checkScene(scene);
  const missing = description.objects.map((o) => o.id).filter((id) => !scene.objects.some((o) => o.id === id));
  if (missing.length) problems.push(`missing described objects: ${missing.join(", ")}`);
  problems.push(...checkLayout(description, scene));
  return { scene, problems };
}

/** Flags objects that drifted far from where the survey put them (catches misread left/right or north/south). */
export function checkLayout(description: Description, scene: Scene, tolerance = 0.75): string[] {
  const out: string[] = [];
  for (const d of description.objects) {
    const o = scene.objects.find((x) => x.id === d.id);
    if (!o) continue;
    const drift = Math.hypot(o.position[0] - d.x_m, o.position[2] - d.z_m);
    if (drift > tolerance) out.push(`${d.id}: placed ${drift.toFixed(1)} m from the surveyed spot (${d.location})`);
  }
  return out;
}

/** Argon sometimes writes hex colours without the leading '#'; fix it here instead of spending a loop iteration on it. */
export function normalizeColors(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(normalizeColors);
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (/color$/i.test(k) && typeof v === "string" && /^[0-9a-f]{3,8}$/i.test(v)) o[k] = `#${v}`;
    else normalizeColors(v);
  }
}
