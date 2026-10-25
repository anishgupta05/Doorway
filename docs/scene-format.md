# Scene format reference

`packages/schema` defines `scene.json` as a zod schema. The table in the README covers the core fields; this page covers the rest. Every field below is optional, so older scenes still parse.

## Physics
- `object.physics`: `{ body: static | dynamic | kinematic, mass (kg), friction, collider, damping? }`. `kinematic` means driven by its articulation (doors, drawers). `dynamic` means pushed and affected by gravity (chairs). `static` is fixed.
- `room.gravity` defaults to `[0, -9.81, 0]`.
- A viewer renders what the scene says: hinges swing by `articulation.range` (radians), `switch` objects toggle their `light`. Physics numbers are for the exporter and robot simulation.

## Look
- `object.look`: procedural surface pattern (`brick | plaster | concrete | carpet | weave | plush | paper | wood | tile`).
- `object.parts[]`: composite geometry; parts inherit the object's colour unless they set their own.
- `part.textureHint`, `part.textureFace`, `part.texture`: optional painted surface images produced by the texture stage (files in `runs/<id>/tex/`, served at `/runs/<path>`).
- `room.wallLook`: pattern on the walls (for example `brick`). `room.unseenWalls`: walls the video never showed, drawn open.

## Decor
`object.decor: true` marks small clutter. It is drawn, never scored or patched, may overlap other objects, and cannot have an articulation or physics. At most 60 per scene.

## Doors, drawers, cabinets
- Cabinet doors and drawer fronts are `type: "door"` / `"drawer"` objects with kinematic physics and an `open` interaction. The body they sit on is static. Cabinet doors are shorter than 1.6 m; only room doors get the 0.45 m walking-clearance zone.
- Objects resting on furniture ("riders") move with it.

## Patches
`Patch` is RFC 6902 with `add`, `replace` and `remove`, at most 12 operations (`MAX_PATCH_OPS`). `applyPatch(scene, patch)` applies it to a copy, re-validates, and throws if the result is not a valid scene. `deletedIds(parent, child)` lists removed objects. Paths named `__proto__`, `constructor` or `prototype` are rejected.

## Checks (`checkScene`)
Run on every scene and every loop branch: sizes and positions in bounds, unique ids, interactions that point at real objects, hinge ranges that can actually open, valid `#rrggbb` colours, and layout rules: solid objects overlapping by more than 0.1 m are rejected (rugs, drawers, decor and things resting on others excluded), nothing within 0.45 m of a room door on either side, nothing sticking out of the room, parts not far outside their object's box. `checkLayout`, `separation` and `doorZone` are exported from `@doorway/schema`; `generate` nudges the lighter object clear before reporting what it cannot fix.
