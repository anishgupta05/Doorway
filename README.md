# Doorway

**A phone video of a real room becomes an interactive, sim-ready 3D replica. Doorway then checks it against the footage and corrects it until it matches.**

Robotics engineers spend days hand-building sim environments of the real spaces their robots will work in. Scanners and Gaussian splats produce frozen geometry: they don't know what a door is. Doorway uses **Argon** (Gemini: video understanding, long decode, 1M context) to watch the video and write the whole room as a scene graph in one pass, with objects that work. Doors open, drawers slide, lights switch, small things can be picked up.

A verification loop then refines it, and every step is something you can see in the viewer:

1. Render the scene in headless Chrome along the same camera path as the original video.
2. Argon compares the render with the real footage and flags specific mistakes.
3. Several branches try different fixes in parallel.
4. Guard hooks reject any patch that breaks the scene, deletes an object, or stops a door from opening. Interaction tests check that objects *behave* correctly, not just that they look right.
5. The best-scoring branch survives, and the loop repeats.

The result exports to MuJoCo (MJCF), and a robot can plan and run tasks in it.

## How it works
```
video ─► describe (Argon): structured survey of the room, objects with x/z positions
      ─► generate (Argon): scene.json, validated, layout-checked, doors added
      ─► detail / affordance / texture: how things look, drawers and cabinet doors, painted surfaces
      ─► loop, k = 1..K:
           render(scene, camera_path)        → frames      [Playwright + headless Chrome]
           Argon: compare(footage, render)   → score + issues[] (object id + what's wrong)
           Argon: N different patches        → branches    (each tries a different fix)
           guard hooks + interaction tests   → reject | re-score
           keep the best branch only if it beats the current scene
      ─► viewer: walkable scene, E to interact, side by side with the real video
```
Argon is used for the survey, the scene, the judging and the fixes. Nothing else is learned or trained: the loop is test-time search with deterministic checks that can veto any branch.

## Results
Scores are Argon's own judgement of how closely the scene matches the footage (0 to 1), on real phone videos:

| Video | Start | After the loop |
|---|---|---|
| Screen recording of our own room | 0.36 | **0.94** |
| Phone booth (30 s, 1.8 × 2 m) | 0.58 | **0.75** |
| Office (33 s) | 0.78 to 0.80 | **0.85** |
| Second office video (50 s) | 0.65 | **0.85** |

A full run (describe, generate, three iterations) takes about 5 minutes. The score measures layout, not photorealism: it can plateau around 0.85, and a score alone does not prove a room looks right, so the viewer lets you judge by eye. See [`docs/pipeline.md`](docs/pipeline.md).

## See it
Real footage on the left, our replica on the right, flown along the camera path Argon estimated from the video:
- [Office phone-booth room (`roomb`), 47 s](docs/media/roomb.mp4)
- [Office copy and mail room (`roomc3`), 57 s](docs/media/roomc3.mp4)

The replica's camera is Argon's estimate (no SLAM), so the two are close but not frame-accurate. `npx tsx scripts/side-by-side.ts <runId>` makes one for any room.

## Quick start
```bash
npm install
cp .env.example .env     # add GEMINI_API_KEY; ffmpeg must be installed for new videos
npm run demo             # production build + preview on http://localhost:4173
```
The viewer reads whatever is in `runs/` (committed runs play with no API calls and no network). `runs/index.json` picks the rooms: `{ "live": "<runId>", "backup": "<runId>" }`.

**Build a room from your own video.** In the viewer, press **New video** and drop a clip (mp4, mov, m4v or webm, up to 600 MB). The local builder runs describe → generate → loop and the room appears in **Rooms** when it is done (about 5 minutes; needs the API key and ffmpeg). On a static host the same button replays a finished build in demo mode.

Or from the command line:
```bash
npm run describe -w @doorway/orchestrator -- --id myroom --video path/to/clip.mov
npm run generate -w @doorway/orchestrator -- --id myroom
npm run loop -- --id myroom --iters 3 --branches 3 --live   # with the viewer running (npm run dev)
```
The loop writes `runs/<id>/manifest.json` after every iteration, so with `--live` the viewer's convergence panel fills in as it runs. Self-test with no API key: `npx tsx scripts/loop-selftest.ts`.

## In the viewer
| Key | What |
|---|---|
| `1` | Real footage vs the first draft, with a drag wipe. `←` `→` step iterations: issue markers turn green and a toast says what was fixed |
| `2` | Convergence: parallel branches, guards stamp REJECTED, the survivor glows, the room morphs |
| `F` | Before / after: first draft next to the final room |
| `B` | The room builds itself from `scene.json` |
| `T` | Interaction tests: door swing, drawer travel, lamp, push |
| `3` | The pre-converged backup run |
| `N` | Night (lamps on) |
| `X` | Export to MuJoCo (MJCF download) |
| `P` | Robot jobs: ask the robot to open a cabinet or door, or compare a first-pass plan with the verified room |
| `4` | Explore: click, WASD, `E` to open doors and drawers, pick up and set down small objects |
| `R` / `Esc` / `M` | Reset joints / back to overview / mute |

Idle in overview for 20 s and it drifts into attract mode.

## The contract: `scene.json`
Defined as a zod schema in `packages/schema`; everything else depends on it.

| Field | Contents |
|---|---|
| `room` | dimensions, wall/floor/ceiling materials, openings |
| `objects[]` | `id`, `type` (door, chair, table, lamp, cabinet…), parts, `position`, `rotationY`, `size`, `color` |
| `objects[].articulation` | `{ kind: hinge \| slide \| free \| switch, axis, pivot, range }` |
| `objects[].physics` | `{ body: static \| dynamic \| kinematic, mass, friction, collider }` |
| `interactions[]` | `{ verb: "open", target: "door_1" }`, `{ verb: "toggle", target: "lamp_2", effect: "light" }` |
| `camera_path[]` | `{ t, position, lookAt }`, estimated by Argon from the video (no SLAM) |

Patches are RFC 6902 (`add` / `replace` / `remove`, at most 12 ops), applied with `applyPatch` and re-validated. Details and the optional fields are in [`docs/scene-format.md`](docs/scene-format.md).

## Repo layout
```
packages/schema/        zod scene schema, patches, layout and safety checks
packages/orchestrator/  model.ts (Gemini adapter with a call cache), describe, generate, compare, fixes,
                        branch (guard hooks), interaction-tests, render, loop, detail, affordance, texture
packages/export/        MJCF export for MuJoCo
apps/viewer/            the demo UI (React Three Fiber) and the local builder API
apps/realism-trial/     standalone page used to try real furniture models, HDRI and ambient occlusion
runs/<id>/              video, description.json, scene.v0.json, manifest.json, iter_k/branch_i/…
fixtures/               sample_room.json, a test video
assets/models/          optional Poly Haven (CC0) furniture models
scripts/                loop-selftest, smoke-ui, walk-test, validate, thumbs, mock run, export
docs/                   scene format and pipeline reference
```

## Checks
```bash
npm run typecheck                                  # schema, export, orchestrator, viewer
npm run test:patch                                 # patch and layout rules
npm run smoke                                      # API key and model reachable
npx tsx scripts/smoke-ui.ts http://localhost:4173  # every hotkey, no page errors
npx tsx scripts/walk-test.ts                       # pointer lock, doors open, pick-up works
```
Before presenting: Wi-Fi off, reload, run the whole script (fonts, sounds, video and runs are all local).

## Contributing
`main` stays demo-ready; nobody commits to it directly.
1. Branch per unit of work off the latest `main`: `feat/<area>-<thing>`, `fix/<area>-<thing>`, `docs/<thing>`.
2. Commit at every working step with small imperative messages.
3. Open a PR (`gh pr create`) that says what changed and how it was tested, with a screenshot for any UI change.
4. Merge once it builds and the checks above pass.
5. Schema changes (`packages/schema`) get their own PR and a heads-up, because everything depends on the schema.
6. Tag demo-ready states (`git tag demo-v1`) so you can roll back to a version that worked on stage.

## Models
Argon (`gemini-4-argon`) via `@google/genai`; videos go up through the Files API and outputs use structured JSON (`responseSchema`). All model calls are cached in `runs/.cache` (git-ignored), so a replay costs nothing.

Built at the Gemini 4 Argon SF Hackathon.
