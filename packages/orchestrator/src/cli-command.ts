// Reads a CommandRequest as JSON on stdin, prints { steps, reply } as JSON. Used by the viewer's /api/command.
import { planCommand, type CommandRequest } from "./command.js";

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", async () => {
  try {
    const out = await planCommand(JSON.parse(input) as CommandRequest);
    process.stdout.write(JSON.stringify(out));
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: (e as Error).message }));
    process.exitCode = 1;
  }
});
