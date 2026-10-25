// Agent 1, the clarifier: a request in plain words → one task the robot can physically do,
// a refusal with the reason, or a question back. Argon reads the request; code then checks
// the physics (compile.ts), because the model can't be trusted to know what a 120 N base can push.
// Without GEMINI_API_KEY a keyword matcher stands in, so the pipeline runs offline.
import type { Scene, SceneObject } from "@doorway/schema";
import { z } from "zod";
import { callJson, models } from "../model.js";
import { describeForRobot, infeasible, movable, type Clarified } from "./compile.js";

export type Clarification =
  | ({ decision: "do"; by: "argon" | "offline" } & Clarified)
  | { decision: "reject"; by: "argon" | "offline" | "physics"; reason: string }
  | { decision: "ask"; by: "argon" | "offline"; question: string };

const ROBOT = `THE ROBOT: a small round mobile base (34 cm across, 1.2 m tall mast). It drives on the floor and
turns in place. It has NO arm and NO gripper: it can't pick up, lift, press, pull, or carry anything.
It can do exactly three kinds of task:
  go_to: drive to an object and stop next to it ("go to the desk")
  push_door: push a hinged door open by driving into it ("open the door")
  push_object: push a loose object along the floor until it's next to another object ("push the chair next to the sofa")`;

const PROMPT = `You turn a person's request into one task for the robot, in the room described above.
- decision "do": the request maps cleanly onto one task type. Set type, object (the id of the thing to reach, the door, or the thing to push) and, for push_object, near (the id it should end up next to). summary restates the task in a short plain sentence using everyday object names, not ids.
- decision "reject": the robot physically can't do it (needs an arm, lifting, a switch, a drawer, leaving the floor, an object that isn't there). reason says why in one plain sentence, naming what the robot lacks.
- decision "ask": it's ambiguous which object is meant (e.g. "push the chair" and there are two chairs) or where to push it. question is one short question naming the options.
Prefer "do" when one reading is clearly most likely. Only use object ids that appear in the room list.`;

export async function clarify(scene: Scene, request: string): Promise<Clarification> {
  const c = process.env.GEMINI_API_KEY ? await withArgon(scene, request) : offline(scene, request);
  if (c.decision !== "do") return c;
  const why = infeasible(scene, c);
  return why ? { decision: "reject", by: "physics", reason: why } : c;
}

async function withArgon(scene: Scene, request: string): Promise<Clarification> {
  const ids = scene.objects.map((o) => o.id) as [string, ...string[]];
  const schema = z.object({
    decision: z.enum(["do", "reject", "ask"]),
    type: z.enum(["go_to", "push_door", "push_object"]).optional(),
    object: z.enum(ids).optional(),
    near: z.enum(ids).optional(),
    summary: z.string().optional(),
    reason: z.string().optional(),
    question: z.string().optional(),
  });
  const r = await callJson({
    model: models.argon(),
    prompt: PROMPT,
    schema,
    context: [ROBOT, "ROOM (object id, type, position in metres, what the robot can do with it):\n" + describeForRobot(scene), `REQUEST: ${JSON.stringify(request)}`],
  });
  if (r.decision === "reject") return { decision: "reject", by: "argon", reason: r.reason ?? "The robot can't do that." };
  if (r.decision === "ask") return { decision: "ask", by: "argon", question: r.question ?? "Which object do you mean?" };
  if (!r.type || !r.object) return { decision: "ask", by: "argon", question: "What should the robot go to, open, or push?" };
  return { decision: "do", by: "argon", type: r.type, object: r.object, near: r.near, summary: r.summary ?? request };
}

// --- offline stand-in: keywords and object names ---

const NEEDS_ARM = /\b(pick|lift|carry|grab|hold|press|switch|turn (on|off)|pull|throw|stack)\b|\bput\b.*\bon\b|\bopen\b.*\bdrawer\b/i;
const label = (o: SceneObject) => (o.label ?? o.type).toLowerCase();

// Words too common to identify an object on their own.
const VAGUE = new Set(["grey", "gray", "white", "black", "brown", "blue", "green", "metal", "wooden", "wood", "round", "small", "large", "office", "with", "other"]);

/** How the request names each object: its id, its whole label, a distinctive word of the label, or just its type. In request order. */
function mentioned(scene: Scene, request: string) {
  const t = request.toLowerCase();
  const find = (w: string) => t.search(new RegExp(`\\b${w.replace(/[^a-z0-9 ]/g, "")}s?\\b`));
  const hits: { o: SceneObject; at: number; specific: boolean }[] = [];
  for (const o of scene.objects.filter((x) => !x.decor && x.type !== "rug")) {
    const own = [o.id.replace(/_/g, " "), label(o), ...label(o).split(/[^a-z]+/).filter((w) => w.length >= 4 && !VAGUE.has(w) && w !== o.type)];
    const named = own.map(find).filter((i) => i >= 0);
    const typed = o.type === "other" ? -1 : find(o.type);
    if (named.length) hits.push({ o, at: Math.min(...named), specific: true });
    else if (typed >= 0) hits.push({ o, at: typed, specific: false });
  }
  return hits.sort((a, b) => a.at - b.at);
}

function offline(scene: Scene, request: string): Clarification {
  const t = request.toLowerCase();
  if (NEEDS_ARM.test(t)) return { decision: "reject", by: "offline", reason: "That needs an arm or a gripper, and this robot only has a base: it can drive to things, push doors open and push loose things." };
  const hits = mentioned(scene, request);
  const door = scene.objects.find((o) => o.type === "door" && o.articulation?.kind === "hinge");
  if (/\bopen\b/.test(t)) {
    if (!door) return { decision: "reject", by: "offline", reason: "This room has no door the robot can push open." };
    return { decision: "do", by: "offline", type: "push_door", object: door.id, summary: `Push the ${label(door)} open` };
  }
  if (/\b(push|move|shove|slide|nudge)\b/.test(t) && !/\b(go|drive|move) to\b/.test(t)) {
    const loose = scene.objects.filter((o) => movable(o) && !o.decor);
    if (!loose.length) return { decision: "reject", by: "offline", reason: "Nothing in this room is loose: the robot can only push things like chairs, and everything here is fixed in place." };
    const thing = hits.find((h) => movable(h.o));
    if (!thing) return { decision: "ask", by: "offline", question: `Push what? The robot can push the ${loose.map(label).join(", the ")}.` };
    // Named only by its type ("the chair") while there are several of that type.
    const same = loose.filter((o) => o.type === thing.o.type);
    if (!thing.specific && same.length > 1)
      return { decision: "ask", by: "offline", question: `Which ${thing.o.type}: ${same.map((o) => `the ${label(o)}`).join(" or ")}?` };
    const near = hits.find((h) => h.o.id !== thing.o.id && h.at > thing.at) ?? hits.find((h) => h.o.id !== thing.o.id);
    if (!near) return { decision: "ask", by: "offline", question: `Push the ${label(thing.o)} next to what?` };
    return { decision: "do", by: "offline", type: "push_object", object: thing.o.id, near: near.o.id, summary: `Push the ${label(thing.o)} next to the ${label(near.o)}` };
  }
  const goal = hits[0];
  if (goal && /\b(go|drive|reach|visit|get|move|head|come|roll)\b/.test(t))
    return { decision: "do", by: "offline", type: "go_to", object: goal.o.id, summary: `Drive to the ${label(goal.o)}` };
  return { decision: "ask", by: "offline", question: "Should the robot drive somewhere, push the door open, or push something? Name the object." };
}
