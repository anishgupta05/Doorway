// Stage 3: Argon judges a scene against the footage and lists what is still wrong.
import { z } from "zod";
import type { Scene } from "@doorway/schema";
import { callJson, models, type UploadedVideo } from "./model.js";
import type { Description } from "./describe.js";

export interface Comparison {
  /** 0..1, higher is closer to the footage. */
  score: number;
  issues: { objectId: string; message: string; severity: "low" | "medium" | "high" }[];
}

const PROMPT = `You are the strict reviewer of a 3D replica of a real room. Judge the scene JSON against the footage (the survey is a helper; the footage wins when they disagree).

Scene conventions: metres, y-up, origin = centre of the floor; x grows east (right), z grows south (toward the first shot's camera); an object's "position" is its footprint centre at its base; "size" = [width, height, depth]; rotationY is in radians and 0 means the front faces south (+z).

Check, in this order: missing or extra objects, positions (relative to walls and to each other), sizes, orientation, colours and materials, then whether doors/drawers/lamps can do what the footage suggests.
- List at most 8 issues, worst first. Each must name ONE object and say what is wrong with a measurable amount in metres or a clear direction ("about 0.5 m too far from the west wall", "faces the wrong way, should face north").
- Do not list nitpicks. If the scene is already good, return few or no issues.
- match_score is 0-10: 10 = indistinguishable layout, 7 = recognisably the same room with some errors, 4 = same kind of room but many objects wrong, 0 = unrelated.`;

export async function compareScene(scene: Scene, description: Description, video?: UploadedVideo): Promise<Comparison> {
  const ids = scene.objects.map((o) => o.id) as [string, ...string[]];
  const schema = z.object({
    match_score: z.number().min(0).max(10),
    issues: z.array(
      z.object({
        objectId: z.enum(ids),
        message: z.string(),
        severity: z.enum(["low", "medium", "high"]),
      }),
    ).max(8),
  });
  const r = await callJson({
    model: models.argon(),
    prompt: PROMPT,
    schema,
    video,
    context: ["SURVEY:\n" + JSON.stringify(description), "SCENE:\n" + JSON.stringify(scene)],
  });
  return { score: r.match_score / 10, issues: r.issues };
}
