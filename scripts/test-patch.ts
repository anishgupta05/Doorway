// Sanity checks for applyPatch / deletedIds. Usage: npx tsx scripts/test-patch.ts
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Scene, applyPatch, checkScene, deletedIds, MAX_PATCH_OPS } from "@doorway/schema";

const scene = Scene.parse(JSON.parse(readFileSync("fixtures/sample_room.json", "utf8")));
const i = scene.objects.findIndex((o) => o.id === "chair_1");

const moved = applyPatch(scene, [{ op: "replace", path: `/objects/${i}/position/0`, value: 0.5 }]);
assert.equal(moved.objects[i].position[0], 0.5);
assert.equal(scene.objects[i].position[0] !== 0.5, true, "input scene must not be mutated");

const s = scene.objects.findIndex((o) => o.id === "sofa_1");
const removed = applyPatch(scene, [{ op: "remove", path: `/objects/${s}` }]);
assert.deepEqual(deletedIds(scene, removed), ["sofa_1"]);

assert.throws(() => applyPatch(scene, [{ op: "replace", path: `/objects/${i}/size`, value: "big" }]), "schema-breaking patch");
assert.throws(() => applyPatch(scene, [{ op: "replace", path: "/objects/99/size", value: [1, 1, 1] }]), "bad path");
const tooMany = Array.from({ length: MAX_PATCH_OPS + 1 }, () => ({ op: "replace" as const, path: `/objects/${i}/rotationY`, value: 0 }));
assert.throws(() => applyPatch(scene, tooMany), "oversize patch");

// Model-written paths and values must not be able to do damage.
assert.throws(() => applyPatch(scene, [{ op: "add", path: "/__proto__/polluted", value: 1 }]), /forbidden/);
assert.throws(() => applyPatch(scene, [{ op: "add", path: `/objects/${i}/constructor/prototype/x`, value: 1 }]), /forbidden/);
assert.equal(({} as any).polluted, undefined, "Object.prototype must stay clean");
assert.throws(() => applyPatch(scene, [{ op: "replace", path: `/objects/${i}/size`, value: [-1, 1, 1] }]), /size/);
assert.throws(() => applyPatch(scene, [{ op: "replace", path: `/objects/${i}/position/0`, value: 1e9 }]), /range/);
assert.throws(() => applyPatch(scene, [{ op: "replace", path: "/objects/1/id", value: "door_1" }]), /duplicate/);
const door = scene.objects.findIndex((o) => o.id === "door_1");
assert.throws(() => applyPatch(scene, [{ op: "remove", path: `/objects/${door}` }]), /missing object/);
assert.deepEqual(checkScene(scene), [], "fixture must be clean");

assert.throws(() => applyPatch(scene, [{ op: "replace", path: `/objects/${i}/color`, value: "d4ae80" }]), /colour/);
assert.throws(() => applyPatch(scene, [{ op: "replace", path: `/objects/${i}/color`, value: "banana" }]), /colour/);
applyPatch(scene, [{ op: "replace", path: `/objects/${i}/color`, value: "#d4ae80" }]);

console.log("patch tests ok");
