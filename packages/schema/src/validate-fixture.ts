import { readFileSync } from "node:fs";
import { Scene, applyPatch, deletedIds, sceneJsonSchema } from "./index.js";

const scene = Scene.parse(JSON.parse(readFileSync(new URL("../../../fixtures/sample_room.json", import.meta.url), "utf8")));
console.log(`fixture ok: ${scene.objects.length} objects, ${scene.camera_path.length} camera keys`);

const moved = applyPatch(scene, [{ op: "replace", path: "/objects/2/pose/position/0", value: 3.1 }]);
console.log("patch ok: chair_1 x ->", moved.objects[2].pose.position[0]);

const deleted = applyPatch(scene, [{ op: "remove", path: "/objects/2" }]);
console.log("deletedIds:", deletedIds(scene, deleted));

let rejected = false;
try { applyPatch(scene, [{ op: "replace", path: "/objects/0/color", value: 42 }]); } catch { rejected = true; }
console.log("schema-breaking patch rejected:", rejected);

console.log("json schema top-level keys:", Object.keys((sceneJsonSchema() as any).properties));
