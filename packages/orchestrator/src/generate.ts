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
- Every object in the description must appear exactly once, with the same id.
- interactions: one "open" for each door/drawer, one "toggle" (effect "light") for each lamp, one "push" for each chair.
- physics: door "kinematic", chairs "dynamic" (mass 4-8 kg), everything else "static". Realistic masses in kg.
- camera_path: at least 2 keys. Use the timestamps where the description says objects were seen, with the camera at eye height (about 1.5 m), inside the room, looking at the objects visible at that time. If the footage shows the camera moving, follow that motion.
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
  const problems = checkScene(scene);
  const missing = description.objects.map((o) => o.id).filter((id) => !scene.objects.some((o) => o.id === id));
  if (missing.length) problems.push(`missing described objects: ${missing.join(", ")}`);
  return { scene, problems };
}
