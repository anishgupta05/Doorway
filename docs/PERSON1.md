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

## Detail pass (`npm run detail -- --id <run>`)
After the layout is accepted, rebuilds how objects look (`parts`, `look`, `material`) from the footage. It cannot change `position`, `rotationY` or `size` (not in its answer schema) and drops parts outside the object's box. Writes `scene.v0.json` and keeps `scene.v0.nodetail.json`. `generate` now also maps colour words to hex (white capped at #d7d7d7) and flips a door's swing if the inward swing would hit furniture.

## Textures and affordances (pipeline order after `generate`)
`npm run affordance -- --id X` (drawers and cabinet doors become separate openable objects) -> `npm run detail -- --id X` (looks, texture hints) -> `npm run texture -- --id X` (image model paints flat surface images from the footage frame where the object is seen; files in `runs/X/tex/`, referenced by `part.texture`, served at `/runs/<path>`). `?models=1` still shows the old Poly Haven library. generate also: `snapFacing`, `fitRoom`, riders (objects resting on furniture move with it).

## Explore: pick up and carry
E (or click) on a small loose object (any non-articulated object up to 0.6 m that isn't a door/drawer/cabinet/shelf/bed/sofa/partition/rug) picks it up; it floats 0.7 m ahead of you, collisions ignore it, and E again sets it down on the first surface below it (table top, shelf, floor). State: `store.held`, `store.lifts` (y change), `store.pushes` (xz). `scripts/walk-test.ts` drives it headlessly.
