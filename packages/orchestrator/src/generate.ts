// Stage 2: Argon turns the description (and the footage) into a schema-valid scene.json.
import { Scene, checkScene } from "@doorway/schema";
import { ensureDoors } from "./doors.js";
import { callJson, models, type UploadedVideo } from "./model.js";
import type { Description } from "./describe.js";

const CONVENTIONS = `Scene conventions (follow exactly):
- Metres, y-up. Origin is the centre of the room's floor. Room width is along x, depth along z, height along y.
- North wall is at z = -depth/2, south at z = +depth/2, east at x = +width/2, west at x = -width/2.
- An object's "position" is the centre of its footprint at its base, so y is the bottom of the object (0 for floor-standing, the tabletop height for things on a desk).
- "size" is [width, height, depth] in the object's own frame. Its front faces local +z before "rotationY" (radians, about y) is applied. rotationY = 0 faces south, PI faces north, PI/2 faces east... verify against the description's "facing".
- Opening "offset" is the centre of the opening measured from the wall's midpoint (+x for north/south walls, +z for east/west walls).
- Objects must sit inside the room and must not overlap each other, except things resting on a surface.
- Interior walls, half walls and columns are objects of type "partition": size = [length, height, thickness] with the length along the object's local x, colour = the room's wall colour, material "paint", physics "static", no articulation. Furniture may stand against a partition.
- Hinged door: articulation { kind: "hinge", axis: [0,1,0], pivot: [-width/2, 0, 0] or [+width/2, 0, 0] in the door's local frame, range: [0, 1.6] }. The pivot side is the hinge side.
- Drawers use kind "slide" with range [0, depth*0.7]. Lamps and monitors use kind "switch"; lamps also get a "light". Pushable furniture (chairs) use kind "free".
- Every object in the survey must appear exactly once, with the same id. The survey's x_m, z_m, base_y_m are in this same frame: use them as the position unless the footage clearly contradicts them, and refine only when you can justify it.
- Room width, depth and height come from the survey room, adjusted only if the footage clearly shows otherwise.
- interactions: one "open" for each door/drawer, one "toggle" (effect "light") for each lamp, one "push" for each chair.
- physics: door "kinematic", chairs "dynamic" (mass 4-8 kg), everything else "static". Realistic masses in kg.
- camera_path: at least 2 keys. Use the timestamps where the description says objects were seen, with the camera at eye height (about 1.5 m), inside the room, looking at the objects visible at that time. If the footage shows the camera moving, follow that motion.
- "name" is a short title for the room. version is 1.`;

export async function generateScene(description: Description, video?: UploadedVideo) {
  const prompt = `Build the 3D scene for this room as a scene.json. A survey written from the footage is attached as JSON${video ? ", along with the footage itself, so check it against the video when they disagree" : ""}.

${CONVENTIONS}`;
  const generated = await callJson({
    model: models.argon(),
    prompt,
    schema: Scene,
    video,
    context: ["ROOM SURVEY:\n" + JSON.stringify(description)],
  });
  // Doorways always get a working door, even if the model left it out.
  const { scene, added } = ensureDoors(generated);
  normalizeColors(scene);
  const flipped = fixDoorSwing(scene);
  if (flipped.length) console.log(`door swing flipped (furniture in the way): ${flipped.join(", ")}`);
  const problems = checkScene(scene);
  if (added.length) console.log(`added doors: ${added.join(", ")}`);
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

const NAMED: Record<string, string> = {
  white: "#ebebeb", black: "#1a1a1a", charcoal: "#36393d", gray: "#8a8d91", grey: "#8a8d91", lightgray: "#c9cbce", lightgrey: "#c9cbce", darkgray: "#4a4d51", darkgrey: "#4a4d51",
  silver: "#b8bbbf", beige: "#d8cdb6", cream: "#efe6d0", ivory: "#eee8d8", tan: "#c9a46e", brown: "#6b4a2f", darkbrown: "#3e2a1c", walnut: "#5a3d28", oak: "#b88a52",
  navy: "#1d2a44", blue: "#3b6fb5", teal: "#3c7f86", green: "#4f8a4e", olive: "#6b6b3a", red: "#b5392f", orange: "#d9822b", yellow: "#e2c14a", gold: "#c9a227", pink: "#d9a0b0", purple: "#6e4d8c",
  chrome: "#c4c7cb", steel: "#9aa0a6", aluminum: "#bcc0c4", aluminium: "#bcc0c4",
};

/** Colour as a safe "#rrggbb": fixes missing '#', maps colour words, caps near-white (pure white blows out under bloom). Unknown values return null. */
export function toHex(v: string): string | null {
  const t = v.trim().toLowerCase().replace(/[\s_-]+/g, "");
  let hex: string | null = /^[0-9a-f]{3,8}$/i.test(t) ? `#${t}` : /^#[0-9a-f]{3,8}$/i.test(t) ? t : (NAMED[t] ?? null);
  if (!hex) return null;
  if (hex.length === 4) hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex!.slice(i, i + 2), 16));
  const k = Math.min(1, 215 / Math.max(r, g, b, 1));
  return k < 1 ? `#${[r, g, b].map((c) => Math.round(c * k).toString(16).padStart(2, "0")).join("")}` : hex;
}

/** Argon writes colours as words ("charcoal"), without '#', or pure white; fix it here instead of spending a loop iteration on it. */
export function normalizeColors(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(normalizeColors);
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (/colou?r$/i.test(k) && typeof v === "string") {
      const hex = toHex(v);
      if (hex) o[k] = hex;
      else delete o[k]; // unknown word: let the viewer pick the material's default
    } else normalizeColors(v);
  }
}

/**
 * A hinged door that would sweep through furniture opens the other way instead (booth doors open
 * out into the corridor). Returns ids of the doors that were flipped. Only for vertical hinge axes.
 */
export function fixDoorSwing(scene: Scene, margin = 0.05): string[] {
  const flipped: string[] = [];
  const blockers = scene.objects.filter((o) => !o.decor && o.type !== "door");
  for (const d of scene.objects) {
    const a = d.articulation;
    if (d.type !== "door" || a?.kind !== "hinge" || a.axis[0] !== 0 || a.axis[2] !== 0 || a.axis[1] === 0) continue;
    const hits = (sign: number) => {
      const full = sign * Math.max(Math.abs(a.range[0]), Math.abs(a.range[1]));
      const len = d.size[0];
      const vx = (a.pivot[0] > 0 ? -1 : 1) * len;
      let n = 0;
      for (const f of [0.35, 0.7, 1]) {
        const ang = full * f;
        for (const t of [0.2, 0.4, 0.6, 0.8, 1]) {
          // point on the open panel, door-local then world (three.js rotation about y)
          const lx = vx * t, lz = 0;
          const px = a.pivot[0] + lx * Math.cos(ang) + lz * Math.sin(ang);
          const pz = a.pivot[2] - lx * Math.sin(ang) + lz * Math.cos(ang);
          const c = Math.cos(d.rotationY), s = Math.sin(d.rotationY);
          const wx = d.position[0] + px * c + pz * s;
          const wz = d.position[2] - px * s + pz * c;
          for (const o of blockers) {
            const dx = wx - o.position[0], dz = wz - o.position[2];
            const oc = Math.cos(o.rotationY), os = Math.sin(o.rotationY);
            const ox = dx * oc - dz * os, oz = dx * os + dz * oc;
            if (Math.abs(ox) < o.size[0] / 2 + margin && Math.abs(oz) < o.size[2] / 2 + margin && o.position[1] < 1.8) n++;
          }
        }
      }
      return n;
    };
    const dir = Math.abs(a.range[1]) >= Math.abs(a.range[0]) ? Math.sign(a.range[1]) || 1 : Math.sign(a.range[0]) || 1;
    if (hits(dir) > 0 && hits(-dir) < hits(dir)) {
      a.range = [-a.range[0], -a.range[1]];
      flipped.push(d.id);
    }
  }
  return flipped;
}
