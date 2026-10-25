// Usage: npx tsx scripts/export-mjcf.ts <scene.json> [out.xml] [--robot]
import { readFileSync, writeFileSync } from "node:fs";
import { Scene } from "@doorway/schema";
import { toMJCF } from "@doorway/export";

const args = process.argv.slice(2);
const robot = args.includes("--robot");
const [input, output] = args.filter((a) => a !== "--robot");
if (!input) throw new Error("usage: export-mjcf <scene.json> [out.xml] [--robot]");
const xml = toMJCF(Scene.parse(JSON.parse(readFileSync(input, "utf8"))), { robot });
if (output) writeFileSync(output, xml);
else process.stdout.write(xml);
