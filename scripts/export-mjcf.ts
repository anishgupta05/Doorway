// Usage: npx tsx scripts/export-mjcf.ts <scene.json> [out.xml]
import { readFileSync, writeFileSync } from "node:fs";
import { Scene } from "@doorway/schema";
import { toMJCF } from "@doorway/export";

const [input, output] = process.argv.slice(2);
if (!input) throw new Error("usage: export-mjcf <scene.json> [out.xml]");
const xml = toMJCF(Scene.parse(JSON.parse(readFileSync(input, "utf8"))));
if (output) writeFileSync(output, xml);
else process.stdout.write(xml);
