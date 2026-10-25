// Stage 4: Argon proposes N different small patches that address the issues.
import { z } from "zod";
import { Patch, type Scene } from "@doorway/schema";
import { callJson, models, type UploadedVideo } from "./model.js";
import type { Comparison } from "./compare.js";

export interface Proposal {
  hypothesis: string;
  patch: Patch;
}

// Gemini needs a concrete value type; the real Patch schema (value: unknown) validates afterwards.
const Value = z.union([z.number(), z.string(), z.boolean(), z.array(z.number())]);
const Proposals = z.object({
  proposals: z.array(
    z.object({
      hypothesis: z.string().describe("One short sentence: what this branch tries and why it may fix the issues."),
      patch: z.array(z.object({ op: z.enum(["add", "replace", "remove"]), path: z.string(), value: Value.optional() })).min(1).max(12),
    }),
  ),
});

const PROMPT = (n: number) => `You are repairing a 3D scene so it matches real footage. You are given the scene JSON, a list of reviewed issues, and notes on earlier attempts that failed.

Propose exactly ${n} DIFFERENT repairs. Each is an RFC 6902 JSON patch (ops add / replace / remove) of AT MOST 12 operations, and each op edits a single leaf value, for example:
  { "op": "replace", "path": "/objects/3/position/0", "value": -1.2 }
Rules:
- Paths index into the scene JSON exactly as given (objects are addressed by array index, so count carefully).
- Never remove an object and never remove an articulation, physics or interactions entry. Do not change object ids.
- Keep objects inside the room and off each other. Positions are the footprint centre at the base.
- The ${n} repairs must take different approaches, e.g. (a) fix only the single worst issue precisely, (b) fix all position/orientation issues together, (c) fix size/colour/material issues. Do not submit near-duplicates.
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
    schema: Proposals,
    video,
    context: [
      "SCENE:\n" + JSON.stringify(scene),
      "ISSUES:\n" + JSON.stringify(comparison.issues),
      "FAILED ATTEMPTS:\n" + (lessons.length ? lessons.map((l) => `- ${l}`).join("\n") : "(none yet)"),
    ],
  });
  return r.proposals.slice(0, n).map((p) => ({ hypothesis: p.hypothesis, patch: Patch.parse(p.patch) }));
}
