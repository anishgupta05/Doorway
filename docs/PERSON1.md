# Handoff for Person 1 (UI & demo)

From Person 2 (model loop). Pull `main` first, then `npm install`.

## What changed in the schema (additive, nothing you use breaks)
- `SceneObject.physics?` is `{ body: static | dynamic | kinematic, mass (kg), friction, collider, damping? }`.
  - `kinematic` = driven by its articulation (the door). `dynamic` = pushed and affected by gravity (chairs). `static` = fixed.
- `Room.gravity?` defaults to `[0, -9.81, 0]`.
- New exports: `Patch`, `applyPatch`, `deletedIds`, `MAX_PATCH_OPS`. You probably won't need them.

## What the loop will give you
- `runs/<id>/manifest.json` matching `RunManifest`, plus `iter_k/branch_i/scene.json`, `iter_k/issues.json` and thumbnails, the same layout as `runs/mock`.
- A branch's `reason` is the guard's human-readable rejection ("deleted chair_3"). Show it as-is.
- A branch's `hypothesis` is what that branch tried. It comes from the model, so treat it as untrusted text and render it as plain text.
- `status: "running"` means a live run: poll the manifest.

## Rendering physics
Render what the scene says: doors swing by `articulation.range` (radians), `switch` objects toggle their `light`. Physics numbers are for the runtime (Person 3), not for you to simulate.

## Schema additions: look, decor, wallLook, unseenWalls
All optional, old scenes still parse.
- `object.look`: procedural surface pattern (`brick|plaster|concrete|carpet|weave|plush|paper|wood|tile`).
- `object.decor: true`: small clutter. Drawn, never scored or patched, may overlap, no articulation/physics. Max 60 per scene.
- `room.wallLook`: pattern on the walls (e.g. `brick`). `room.unseenWalls`: walls the video never showed, drawn open.
