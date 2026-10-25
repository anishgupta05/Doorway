# Handoff for Person 3 (render, guards, integration)

From Person 2 (model loop). Pull `main` first, then `npm install`. Checks: `npm run typecheck && npm run test:patch`.

## New in `packages/schema` (additive)
- `SceneObject.physics?`: `{ body: static | dynamic | kinematic, mass, friction, collider, damping? }`. The door is `kinematic`, chairs `dynamic`. `Room.gravity?` defaults to `[0, -9.81, 0]`.
- `patch.ts`: `Patch` (RFC 6902 `add`/`replace`/`remove`, **max 12 ops**, `MAX_PATCH_OPS`), `applyPatch(scene, patch)` (re-validates, throws on a schema break), `deletedIds(parent, child)`.

## What the loop expects from you
The loop calls these per branch. Please keep the signatures, or tell Person 2 when they change:
- `render(scene, camera_path) -> frames[]` (deterministic, fixed timestamps).
- `guards(parent, child) -> { ok: boolean, reasons: string[] }`. Schema valid (free via `applyPatch`), scene builds, `deletedIds` empty, articulations kept.
- `testInteractions(scene) -> { ok: boolean, results[] }`. Door swings over its range without hitting walls or colliders, lamp light toggles, chair moves.
- `reasons` are shown verbatim in Person 1's panel, so write them for humans.

## Open question for you
Does the managed-agent sandbox have headless Chrome? If not, rendering stays local (the default plan).

## Orchestrator (Person 2)
`packages/orchestrator`: `npm run describe -w @doorway/orchestrator -- --video <file>` turns a video into `runs/<id>/description.json` (an Argon-written structured description). Generate, compare and the branch loop come next and consume that description plus your `render` / `guards` / `testInteractions`. All Gemini calls are cached in `runs/.cache` (git-ignored).

## Schema additions (guards)
`object.decor` objects must be skipped by the no-deletion guard, interaction tests and scoring; `checkScene` already rejects decor with articulation/physics and more than 60 decor items.
