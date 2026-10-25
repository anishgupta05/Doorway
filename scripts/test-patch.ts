// Sanity checks for applyPatch / deletedIds. Usage: npx tsx scripts/test-patch.ts
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Scene, applyPatch, deletedIds, MAX_PATCH_OPS } from "@doorway/schema";

const scene = Scene.parse(JSON.parse(readFileSync("fixtures/sample_room.json", "utf8")));
const i = scene.objects.findIndex((o) => o.id === "chair_1");

const moved = applyPatch(scene, [{ op: "replace", path: `/objects/${i}/position/0`, value: 0.5 }]);
assert.equal(moved.objects[i].position[0], 0.5);
assert.equal(scene.objects[i].position[0] !== 0.5, true, "input scene must not be mutated");

const removed = applyPatch(scene, [{ op: "remove", path: `/objects/${i}` }]);
assert.deepEqual(deletedIds(scene, removed), ["chair_1"]);

assert.throws(() => applyPatch(scene, [{ op: "replace", path: `/objects/${i}/size`, value: "big" }]), "schema-breaking patch");
assert.throws(() => applyPatch(scene, [{ op: "replace", path: "/objects/99/size", value: [1, 1, 1] }]), "bad path");
const tooMany = Array.from({ length: MAX_PATCH_OPS + 1 }, () => ({ op: "replace" as const, path: `/objects/${i}/rotationY`, value: 0 }));
assert.throws(() => applyPatch(scene, tooMany), "oversize patch");

console.log("patch tests ok");
