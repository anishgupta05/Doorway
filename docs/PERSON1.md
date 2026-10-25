# Handoff for Person 1 (UI & demo)

Updated by Person 2 (model loop). Pull `main` before you start.

## What exists
- `packages/schema` exports the zod `Scene` type. **Import types from `@doorway/schema`; don't redefine them.**
- `fixtures/sample_room.json` is a valid scene (door, table, chair, lamp, 3 camera keys). Build against it now.
- Run `pnpm install && pnpm --filter @doorway/schema test` to check your setup.

## What you can rely on
- Units: metres and degrees. Y is up. `room.dimensions = [x width, y height, z depth]`.
- Each object has `pose` (position, rotation), `size`, `parts[]` (offsets relative to the object), optional `articulation` and optional `physics`.
- `articulation.kind`: `hinge` (range in degrees about `axis` at `pivot`), `slide` (metres), `free` (pushable), `switch` (on/off, e.g. a lamp).
- `interactions[]` lists what **E** can do: `open` a door, `toggle` a lamp (`effect: "light"`), `push` a chair.
- `physics.body`: `static` (fixed), `dynamic` (pushed, affected by gravity), `kinematic` (moved by its articulation, e.g. the door). Gravity default is `[0, -9.81, 0]`.

## Files the loop will write (you read these)
`runs/<id>/iter_k/branch_i/{scene.json, frames/, score.json, verdict.json}`. Shapes for `score.json` and `verdict.json` will be added to this file once the loop writes them. Until then, mock them.

## Still open
- Style hooks in `packages/runtime` are agreed with Person 3, not yet built.
