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

/** Rendered views of the scene from the footage's camera path, so Argon judges what we actually built. */
export interface Renders {
  frames: Buffer[];
  /** Seconds into the footage for each frame. */
  times: number[];
}

const RENDERS_NOTE = `The images are renders of the scene JSON from the same camera path as the footage, at the stated timestamps. Compare each one with what the footage shows at that moment. The renders are deliberately stylised: ignore lighting, shadows, textures, and anything seen through a window or glass.`;

/** Experiment knobs (defaults = current behaviour). DOORWAY_SCALE=100 asks for a 0-100 score; DOORWAY_SCORE=issues subtracts open-issue penalties. */
const SCALE = Number(process.env.DOORWAY_SCALE ?? 10);
const SCORE_MODE = process.env.DOORWAY_SCORE ?? "match";
const penalty = (issues: Comparison["issues"]) => issues.reduce((p, i) => p + (i.severity === "high" ? 0.08 : i.severity === "medium" ? 0.04 : 0.015), 0);

export async function compareScene(scene: Scene, description: Description, video?: UploadedVideo, renders?: Renders): Promise<Comparison> {
  const ids = scene.objects.map((o) => o.id) as [string, ...string[]];
  const schema = z.object({
    match_score: z.number().min(0).max(SCALE),
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
    prompt: SCALE === 10 ? PROMPT : PROMPT.replace("match_score is 0-10: 10 =", `match_score is 0-${SCALE}, use the whole range and be precise to 1 point: ${SCALE} =`).replace("7 =", `${SCALE * 0.7} =`).replace("4 =", `${SCALE * 0.4} =`),
    schema,
    video,
    context: ["SURVEY:\n" + JSON.stringify(description), "SCENE:\n" + JSON.stringify(scene), ...(renders ? [RENDERS_NOTE] : [])],
    images: renders?.frames.map((data, i) => ({ caption: `RENDER at t=${renders.times[i]}s:`, mimeType: "image/jpeg", data })),
  });
  const match = r.match_score / SCALE;
  return { score: SCORE_MODE === "issues" ? Math.max(0, Number((match - penalty(r.issues) * 0.5).toFixed(3))) : match, issues: r.issues };
}
