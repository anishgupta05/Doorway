# Handoff for Person 3 (render, guards, integration)

Updated by Person 2 (model loop). Pull `main` before you start. **The schema is a draft you own: edit `packages/schema/src/index.ts` and tell Person 2 and Person 1 what changed.**

## What exists
- `packages/schema`: zod `Scene`, plus `applyPatch(scene, patch)` and `deletedIds(parent, child)` in `patch.ts`. Run `pnpm --filter @doorway/schema test`.
- `fixtures/sample_room.json`: valid scene with physics on every object.

## Contract between the loop and your guards
- A fix is an RFC 6902 patch (`add`/`replace`/`remove`), **at most 12 ops** (`MAX_PATCH_OPS`), each editing a leaf (a coordinate, size, colour). Never a full rewrite.
- `applyPatch` already throws if the result fails the schema. Your guards add: scene builds with no runtime errors, `deletedIds(parent, child)` is empty, every articulated object keeps its articulation, `testInteractions` passes.
- The loop will call, per branch: your `render(scene, camera_path) -> frames[]`, your `guards(parent, child) -> {ok, reasons[]}`, and your `testInteractions(scene) -> {ok, results[]}`. Please keep those three signatures, or tell Person 2 when they change.
- `verdict.json` per branch: `{ ok: boolean, reasons: string[] }`. Reasons are shown in Person 1's panel, so write them for humans ("deleted chair_3").

## Physics
`physics.body` is `static | dynamic | kinematic`; the door is `kinematic`, driven by its hinge. Interaction tests should check the door's swept volume against walls and other colliders. Gravity default `[0, -9.81, 0]`.

## Open question for you
Does the sandbox (managed agent) have headless Chrome? If not, rendering stays local.
