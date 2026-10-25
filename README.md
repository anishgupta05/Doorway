# Doorway

**A 60-second phone video of a real room becomes an interactive, sim-ready 3D replica. Doorway then checks it against the footage and corrects it until it matches.**

Robotics engineers spend days hand-building sim environments of the real spaces their robots will work in. Scanners and Gaussian splats produce frozen geometry: they don't know what a door is. Doorway uses **Argon** (Gemini: video understanding, long decode, 1M context) to watch the video and write the whole room as a scene graph in one pass, with objects that work. Doors open, chairs move, lights switch.

A verification loop then refines it:

1. Render the scene in headless Chrome along the same camera path as the original video.
2. Argon compares the render with the real footage and flags specific mistakes.
3. Several sandboxes try different fixes in parallel.
4. Guard hooks reject any patch that breaks the scene, deletes an object, or stops the door from opening. An interaction-test tool checks that objects *behave* correctly, not just that they look right.
5. The best-scoring branch survives, and the loop repeats.

Long term, this becomes an open-source tool that exports to Isaac and MuJoCo.

---

## Constraints
- **Under 12 hours, 3 people.**
- **The demo must be flawless.** The viewer runs entirely from files in `runs/`, so nothing on stage depends on a live API call.
- **Models:** Argon (Gemini) via `@google/genai`. Videos go up through the Files API, and outputs use structured JSON (`responseSchema`).

## Architecture
```
video.mp4 ─► ingest (ffmpeg keyframes) ─► Argon: generate scene.json (v0)
          ─► loop k = 1..K (K≈4):
               render(scene, camera_path)        → frames      [Playwright + headless Chrome]
               Argon: compare(real, render)      → issues[]    (object id + what's wrong)
               fan out N≈3–4 branches            → scene_i     (each tries a different fix)
               guard hooks + interaction tests   → reject | score
               keep the best scene_i             → scene(k)
          ─► viewer: walkable scene, E to interact, side by side with the real video
```

## The contract: `scene.json`
Freeze this together in **hour 0–1**. Every track depends on it. It's defined as a zod schema in `packages/schema`.

| Field | Contents |
|---|---|
| `room` | dimensions, wall/floor/ceiling materials, openings |
| `objects[]` | `id`, `type` (door, chair, table, lamp, cabinet…), `primitive` or composite parts, `pose`, `size`, `color` |
| `objects[].articulation` | `{ kind: hinge \| slide \| free \| switch, axis, pivot, range }` |
| `interactions[]` | `{ verb: "open", target: "door_1" }`, `{ verb: "toggle", target: "lamp_2", effect: "light" }` |
| `camera_path[]` | `{ t, position, lookAt }`, estimated by Argon from the video (no SLAM) |

A hand-written `fixtures/sample_room.json` is committed in hour 1, so the UI and guards tracks can build without waiting on the model.

## Repo layout (TypeScript, pnpm workspaces)
```
packages/schema/        zod scene schema, types, diffScenes()
packages/runtime/       Three.js: buildScene(json), articulation controllers, interact(id, verb),
                        window.renderPath(cameraPath) for Playwright
packages/orchestrator/  model.ts (Gemini adapter), ingest.ts, render.ts, score.ts, loop.ts
packages/guards/        hooks + testInteractions(scene)
apps/viewer/            the demo UI (Vite + Three.js)
runs/<id>/iter_k/branch_i/   scene.json, frames/, score.json, verdict.json
runs/backup/            pre-converged judging-room run, committed before the demo
fixtures/               sample_room.json, test video
```

---

## Team plan

### Person 1: UI & demo (owns the stage)
The demo is the product. This person's only job is that the viewer looks great and never breaks on stage. They don't touch the model loop.

**Build (in this order)**
1. **Viewer shell (hours 1–3):** a Vite app that loads any `runs/<id>/iter_k/` from disk, using `packages/runtime` to build the scene. First-person walk with PointerLockControls and WASD. Press **E** to interact with whatever's under the crosshair. Show a crosshair hint ("E · Open door") when looking at an interactive object.
2. **Visual quality (hours 3–5):** this is what makes the room look real rather than like grey boxes.
   - Soft shadows, ACES tone mapping, an HDRI environment for reflections, SSAO, and subtle bloom on lamps.
   - Eased articulation animations: the door swings with a slight overshoot, and the light fades on instead of popping.
   - Smooth camera transitions between views. Keep a constant 60fps on the demo laptop.
3. **Side-by-side view (hours 4–6):** real video on the left, render on the right, both driven by one shared timeline scrubber so the render follows `camera_path` in sync. Flagged issues from Argon appear as pins on the render ("chair_3: wrong position") and fade out when fixed.
4. **Convergence panel (hours 6–8):** shows iterations as columns and branches as cards. Each card has a thumbnail, a score, and a ✓ or ✗ with the hook's reason ("deleted chair_3", "door no longer opens"). The surviving branch glows and slides forward into the next column. A score sparkline climbs across the top. The panel animates in replay mode from saved run files, and in live mode it polls `runs/`.
5. **Version picker plus "Take the keyboard" mode (hours 8–9):** switch v0 / latest / backup with a crossfade. A full-screen walk mode with all chrome hidden, for handing the keyboard to a judge.

**Design direction:** dark, minimal, technical. Use one accent color for "verified" states, monospace for object IDs, and generous spacing. No default browser styling should be visible anywhere.

**Flawless-demo checklist (owned by Person 1)**
- [ ] Every demo screen works with **Wi-Fi off** (backup run plus local video).
- [ ] Hotkeys for each demo beat: `1` footage vs v0, `2` convergence, `3` backup, `4` walk mode, `R` reset the door and lights.
- [ ] Tested on the actual demo laptop, at projector resolution, with the browser at full screen.
- [ ] Two full timed rehearsals (≤3 min) with Persons 2 and 3 watching.
- [ ] A recorded screen capture of a perfect run, kept as the last-resort fallback.

### Person 2: model loop (Gemini)
Owns everything that calls Argon or Flash, and produces the `runs/` files Person 1 renders.

1. **Kickoff checks (hour 0):** confirm the Argon and Flash model IDs, the video input limits, quota for about 4 parallel branches × 4 iterations, and **whether the event's Managed Agents run on Argon or only on Flash**.
   - Argon available: each branch is one managed-agent session on Argon that patches and self-checks.
   - Flash only: Argon stays in the orchestrator to generate, compare, and propose N fix hypotheses. Flash agents only apply a patch, render, and score.
   - Neither: run the branches locally with `Promise.all`. `runBranch` has both implementations behind a flag.
2. **`model.ts` (hours 1–2):** the single adapter (`generate`, `compare`, `proposeFixes`, `runBranch`). It reads `GEMINI_API_KEY` and the model IDs from `.env`.
3. **One-pass generation (hours 2–4):** the video goes to Argon, which returns a schema-valid `scene.json`, including `camera_path` and articulations. If the scene fails validation, retry once with the zod error included in the prompt. If direct video upload fails, fall back to 1 fps keyframes.
4. **Compare and fix (hours 4–6):** Argon gets real frames and rendered frames at matched timestamps and returns `issues[]`. It then proposes N different fixes as JSON patches over the scene, never full rewrites, so the guards can diff them.
5. **`loop.ts` and `score.ts` (hours 6–7):** the score blends frame similarity (SSIM) with the Argon issue count. Each iteration writes `runs/<id>/iter_k/branch_i/*`. Stop at K=4 or when there are no high-severity issues.
6. **Judging-room run (as soon as the room is assigned):** record the 60s video and start the background run. Hand the best run to Person 3 to freeze as `runs/backup`.
7. **Stretch:** `export/toMJCF(scene)` (boxes become geoms, hinges become joints) and load the result in MuJoCo for one screenshot.

### Person 3: render pipeline, guards, and integration
Owns the parts that make the loop trustworthy, and keeps all three tracks connected.

1. **Schema and fixture (hours 0–1):** write the zod schema and `fixtures/sample_room.json` with the team, then publish the types.
2. **Runtime core (hours 1–3):** `buildScene(json)` plus the articulation controllers (hinge, slide, free, switch) and `interact(id, verb)`. Person 1 uses this for visuals, so agree early on where the style hooks go.
3. **Headless render (hours 3–5):** `render.ts`, where Playwright loads the runtime and calls `window.renderPath(cameraPath)` to capture frames deterministically at fixed timestamps. Make it run in the sandbox if the sandbox supports Chrome, and locally otherwise.
4. **Guard hooks (hours 4–6):** these run on every patch, and any failure rejects it.
   - The schema validates.
   - The scene builds without runtime errors.
   - No object ids are deleted relative to the parent scene.
   - Every articulated object keeps its articulation.
5. **Interaction-test tool (hours 5–7):** `testInteractions(scene)` loads the scene headless and runs each declared interaction, then asserts its effect. For example, the door's hinge angle changes by >60° and its swept volume doesn't hit a wall, the lamp's light intensity toggles, and the chair moves. If Managed Agents support custom tools, expose it to the agents as a tool.
6. **Integration (hours 7–9):** wire the guards into branch selection in `loop.ts` and write a `verdict.json` for each branch, which is what Person 1's panel shows. Freeze and commit `runs/backup`.
7. **Release check (hours 9+):** fresh clone, `pnpm i`, offline demo run end to end.

---

## Timeline at a glance
| Hours | Person 1 (UI) | Person 2 (model) | Person 3 (pipeline/guards) |
|---|---|---|---|
| 0–1 | Freeze schema together · start viewer scaffold | Kickoff checks (Managed Agents on Argon?) | Schema + fixture |
| 1–4 | Walk + interact, visual quality | Adapter, one-pass generation | Runtime core, start headless render |
| 4–7 | Side-by-side + issue pins | Compare → parallel fixes → score | Guards + interaction tests |
| 7–9 | Convergence panel, version picker, walk mode | Judging-room run → backup | Integration, freeze backup |
| 9–12 | Polish + 2 rehearsals | Stretch: MJCF export | Fresh-clone offline check |

## Git workflow
Keep `main` demo-ready at all times. Nobody commits to it directly.

1. **Branch per unit of work** off the latest `main`: `feat/<area>-<thing>`, `fix/<area>-<thing>`, `docs/<thing>`.
   - Areas: `ui`, `runtime`, `schema`, `orchestrator`, `guards`, `render`, `demo`.
   - Examples: `feat/ui-convergence-panel`, `feat/guards-interaction-tests`.
2. **Commit at every important step:** each working milestone, not one big commit at the end. Use small, imperative messages: `Add hinge articulation controller`, `Wire guards into branch selection`.
3. **Push and open a PR** with `gh pr create`. The description says what changed, how it was tested, and a screenshot or GIF for any UI change.
4. **Merge** once it builds and its checks in [Verification](#verification) pass. Then `git switch main && git pull` before starting the next branch.
5. **Schema changes** (`packages/schema`) get their own PR and a heads-up to the whole team, because all three tracks depend on the schema.
6. **Tag demo-ready states:** `git tag demo-v1`, and so on, so you can always roll back to a version that worked on stage.

## Demo script (~3 min)
1. **Hook:** "This is the judging room, from a 60-second phone video." Real footage next to **v0**, which Argon generated in one pass.
2. **Loop:** the convergence panel. Parallel branches, hooks rejecting bad patches with reasons, the score climbing.
3. **Clean finish:** switch to the pre-converged **backup**.
4. **The moment:** hand a judge the keyboard. They walk to the door, press **E**, and it opens. Flip the light.
5. **Close:** "Splats give you frozen geometry. This knows what a door is." Then the path to Isaac and MuJoCo export.

## The verification loop
```bash
# once per room (needs .env with GEMINI_API_KEY, and ffmpeg): video → description.json → scene.v0.json
npm run describe -w @doorway/orchestrator -- --id room1 --video path/to/room1.mov
npm run generate -w @doorway/orchestrator -- --id room1
# then, with the viewer running (npm run dev), iterate:
npm run loop -- --id room1 --iters 3 --branches 3 --live
```
Each iteration, the loop:
1. Renders the current scene along the footage's camera path, using the viewer's own render mode.
2. Has Argon compare the footage with the scene and those renders, and list issues and a match score (`compare.ts`).
3. Has Argon propose N different JSON patches, after telling it which earlier attempts were rejected (`fixes.ts`).
4. Tests each branch in parallel: **hooks** (`branch.ts`: no deleted objects, no removed or changed joints, valid scene) and **interaction tests** (`interaction-tests.ts`: every door sweeps its full swing and every drawer slides out without hitting a wall or furniture). Branches that pass are rendered and re-scored by Argon.
5. Keeps the best branch only if it beats the current scene.

It writes `runs/<id>/manifest.json` after every iteration (`status: "running"`), so with `--live` the viewer's convergence panel fills in as the loop runs. `--backup` also makes the run the demo backup. Progress: `runs/<id>/progress.json`.

Self-test without an API key: `npx tsx scripts/loop-selftest.ts` (fake model against a known ground truth; the run title is marked `[FAKE MODEL]`).

## Running the demo
```bash
npm install
npm run dev            # http://localhost:5173 (development)
npm run demo           # production build + preview on http://localhost:4173 (present from this)
```
The viewer reads whatever is in `runs/`. `runs/index.json` picks the runs: `{ "live": "<runId>", "backup": "<runId>" }`.
To show a real run, point `backup` at it and run `npm run thumbs -- <runId>` to render branch thumbnails.

| Key | Beat |
|---|---|
| `1` | Real footage vs v0, with a drag wipe. `←` `→` step iterations: issue markers turn green and a toast shows what was fixed |
| `2` | Convergence: parallel branches, guards stamp REJECTED, the survivor glows, the room morphs. Click a rejected card to load it |
| `F` | Before / after: v0 next to the final room |
| `B` | The room builds itself from `scene.json` |
| `T` | Interaction tests: door swing, drawer travel, lamp, push |
| `3` | Switch to the pre-converged backup run |
| `N` | Night (lamps on) |
| `X` | Export to MuJoCo (MJCF download) |
| `P` | Robot task: A* on the replica's occupancy grid. `Enter` steps through: plan in v0 → run that plan in the verified room (does it crash?) → replan in the verified room |
| `4` | Walk: click, WASD, `E` to open the door. A robot rolls in |
| `R` / `Esc` / `M` | Reset joints / back to overview / mute |

Idle in overview for 20 s and it drifts into attract mode with rotating captions.

**Before presenting**
- [ ] `npx tsx scripts/smoke-ui.ts http://localhost:4173`: every hotkey runs with no page errors
- [ ] `npx tsx scripts/walk-test.ts`: pointer lock works, the door opens, the robot comes in
- [ ] Wi-Fi off, reload, run the whole script (fonts, sounds, video and runs are all local)
- [ ] Chrome full screen on the projector; sleep and notifications off

**Scripts:** `npm run mock` (regenerate the mock run), `npm run record-truth` (stand-in footage for the mock), `npm run shot -- <url> <dir> <name=Key@ms>…` (screenshots), `npm run export:mjcf -- scene.json out.xml`.

## Robot tasks in physics
Press `P` in overview. The right-hand panel, **Train it in physics**, takes a request in plain words ("can you get that door out of the way?") and three agents handle it, writing everything to `runs/<run>/tasks/<task>/`:
1. **Clarifier** (Argon, then physics checks in code) maps it onto `go_to`, `push_door` or `push_object`, refuses what a base with no arm can't do, or asks which object.
2. **Trainer** (Argon, within hard limits) sets the PPO budget and reward weights; `packages/sim` trains in the MuJoCo export of the room on the CPU.
3. **Verifier** runs 10 test rollouts from jittered starts. Pass = 80% success with nothing else knocked over; Argon explains the result and, on a fail, tells the trainer what to change (up to 3 attempts).

A passing task replays its best test run in the room: the robot, the door angle and any pushed object move as they did in MuJoCo. From the CLI: `npm run task -- --id roomc "open the door"`. Without `GEMINI_API_KEY` the agents fall back to offline stand-ins. One-time setup for the simulator (Python 3.13): see `packages/sim/README.md`. `npm run check:mjcf` checks an exported room's physics (nothing starts inside anything, the robot can push each door open).

## Verification
- `pnpm --filter guards test`: rejects patches that delete an object, remove the door hinge, or break the schema. `testInteractions` passes on the fixture and fails on a door with `range: 0`.
- `pnpm --filter orchestrator loop -- --video fixtures/test.mp4 --iters 2 --branches 3`: writes `runs/<id>/iter_*/branch_*`, and the selected score is ≥ the parent's.
- `pnpm --filter viewer dev`: v0, latest, and backup all load. The door opens, the lamp toggles, and the side-by-side video stays in sync.
- Offline rehearsal with Wi-Fi off: the full demo runs from `runs/backup`.
