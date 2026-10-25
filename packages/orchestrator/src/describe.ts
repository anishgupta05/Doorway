// Stage 1: a small multimodal model watches the footage and writes a structured description.
// Later stages (generate, compare) work from this text, so nothing depends on frame alignment.
import { z } from "zod";
import { callJson, models, type UploadedVideo } from "./model.js";

const Dir = z.enum(["north", "south", "east", "west"]);

export const Description = z.object({
  summary: z.string().describe("Two sentences: what kind of room this is and how it feels."),
  room: z.object({
    width_m: z.number().describe("Estimated extent left-right in the first shot, metres."),
    depth_m: z.number().describe("Estimated extent front-back in the first shot, metres."),
    height_m: z.number(),
    wall_color: z.string().describe("hex, e.g. #e8e4dc"),
    floor_material: z.enum(["wood", "concrete", "carpet", "tile"]),
    floor_color: z.string(),
    ceiling_color: z.string(),
    openings: z.array(z.object({
      kind: z.enum(["door", "window"]),
      wall: Dir,
      width_m: z.number(),
      height_m: z.number(),
      position_along_wall: z.enum(["left", "center", "right"]).describe("As seen standing at the room centre facing that wall."),
      sill_m: z.number().describe("0 for a door."),
    })),
  }),
  objects: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/).describe("snake_case with index, e.g. chair_1"),
    type: z.enum(["door", "drawer", "table", "chair", "cabinet", "shelf", "lamp", "rug", "plant", "monitor", "sofa", "bed", "box", "other"]),
    label: z.string(),
    material: z.enum(["wood", "darkwood", "fabric", "leather", "metal", "plastic", "glass", "ceramic", "paint", "plant"]),
    color: z.string().describe("hex"),
    size_m: z.tuple([z.number(), z.number(), z.number()]).describe("width, height, depth"),
    location: z.string().describe("Plain-language placement relative to walls and other objects, e.g. 'against the north wall, 1 m from the east corner, left of desk_1'."),
    facing: Dir.optional().describe("Which wall the front of the object faces."),
    can_do: z.enum(["opens_hinge", "opens_slide", "switches_on_off", "pushable", "none"]).describe("What a person could do with it."),
    hinge_side: z.enum(["left", "right"]).optional().describe("For hinged doors, seen from the side you open from."),
    seen_at_s: z.array(z.number()).describe("Timestamps (seconds) where it is clearly visible."),
  })),
  uncertain: z.array(z.string()).describe("Things you could not judge from the footage."),
});
export type Description = z.infer<typeof Description>;

const PROMPT = `You are surveying a real room from a phone video so a 3D replica can be built from your text alone.
Rules:
- Every number is metres. Use everyday objects as scale references (door ~2.0 m tall, desk ~0.75 m high).
- Walls: north is the wall furthest from the camera in the first shot; east is on the right.
- List every distinct object a person could walk into, sit on, open or switch. Skip small clutter.
- Prefer a rough but consistent layout to false precision. If you cannot judge something, say so in "uncertain".
- Do not invent objects that are not visible.`;

export function describeFootage(video: UploadedVideo): Promise<Description> {
  return callJson({ model: models.flash(), prompt: PROMPT, schema: Description, video });
}
