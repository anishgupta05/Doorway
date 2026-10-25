// Turns a plain-language instruction ("open the top-left locker, then switch on the printer")
// into an ordered list of the room's actions, using Argon. The viewer sends the
// actions it can perform; the model may only pick from those.
import { z } from "zod";
import { callJson, models } from "./model.js";

export type CommandAction = { id: string; label: string; group: string };
export type CommandRequest = { text: string; room: string; actions: CommandAction[]; objects: { id: string; label: string; position: number[] }[] };

const PROMPT = `You control a mobile robot in a room. Turn the person's instruction into an ordered list of steps,
choosing ONLY from the AVAILABLE ACTIONS (use their exact ids). Keep the person's order.
- Lockers are numbered row by row from the top-left, as seen from the front: in a 4×4 bank, 1-4 are the top row (1 = top-left), 13-16 the bottom row (13 = bottom-left).
- "the cabinets", "all the lockers" etc. mean every matching action.
- If something asked for isn't possible here, leave it out and say so in "reply".
- "reply" is one short, friendly sentence saying what the robot will do.`;

export async function planCommand(req: CommandRequest) {
  const ids = req.actions.map((a) => a.id) as [string, ...string[]];
  const schema = z.object({ steps: z.array(z.enum(ids)).max(24), reply: z.string() });
  return callJson({
    model: models.argon(),
    prompt: PROMPT,
    schema,
    context: [
      `ROOM: ${req.room}`,
      "OBJECTS:\n" + req.objects.map((o) => `${o.id}: ${o.label} at x=${o.position[0].toFixed(1)}, z=${o.position[2].toFixed(1)}`).join("\n"),
      "AVAILABLE ACTIONS:\n" + req.actions.map((a) => `${a.id}: ${a.label}`).join("\n"),
      `INSTRUCTION: ${req.text}`,
    ],
  });
}
