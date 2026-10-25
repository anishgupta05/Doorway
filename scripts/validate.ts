// Validate scene.json files (and run manifests) against @doorway/schema.
// Usage: npx tsx scripts/validate.ts <file.json> [...]
import { readFileSync } from "node:fs";
import { Scene, RunManifest } from "@doorway/schema";

let failed = 0;
for (const file of process.argv.slice(2)) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  const schema = file.endsWith("manifest.json") ? RunManifest : Scene;
  const result = schema.safeParse(json);
  if (result.success) {
    console.log(`ok    ${file}`);
  } else {
    failed++;
    console.error(`FAIL  ${file}`);
    for (const issue of result.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
}
process.exit(failed ? 1 : 0);
