# Pipeline reference

## Stages, in order
```bash
npm run describe   -w @doorway/orchestrator -- --id X --video clip.mov   # Argon watches the video → runs/X/description.json
npm run generate   -w @doorway/orchestrator -- --id X                    # → runs/X/scene.v0.json
npm run affordance -- --id X    # drawers and cabinet doors become separate openable objects
npm run detail     -- --id X    # how things look (parts, look, material); cannot move or resize objects
npm run texture    -- --id X    # image model paints flat surface images from the footage frame where an object is seen
npm run loop       -- --id X --iters 3 --branches 3 [--live] [--backup]  # the verification loop
```
`generate` also maps colour words and malformed colours to hex, adds a hinged door to every doorway (swinging in if clear, else out), snaps facings, fits the room, nudges overlapping furniture apart, and lets objects resting on furniture travel with it.

## What one loop iteration does
1. **Render** the current scene along the footage's camera path with the viewer's own render mode (Playwright, headless Chrome).
2. **Compare** (`compare.ts`): Argon sees the footage, the survey, the scene and the renders, and returns a match score and up to 8 issues, each naming one object.
3. **Propose** (`fixes.ts`): Argon writes N different small patches, told which earlier attempts failed.
4. **Test each branch in parallel**:
   - guard hooks (`branch.ts`): nothing deleted, no joint removed or changed, no object grown beyond furniture size, valid scene;
   - interaction tests (`interaction-tests.ts`): every door sweeps its full swing and every drawer slides out without hitting a wall or furniture. Only failures the parent scene did not already have reject a branch; existing ones count as issues instead.
5. **Re-score** the branches that pass, and keep the best only if it beats the current scene.

Rejected branches show their reason verbatim in the viewer ("Hook: deleted chair_3"). A branch's `hypothesis` comes from the model, so the viewer renders it as plain text.

## The `runs/<id>/` contract
```
video.mp4, description.json, scene.v0.json
manifest.json          RunManifest: status ("running" | "done"), iterations[], branches[] (score, verdict, reason, hypothesis, scene, thumb)
progress.json          stage and iteration while a run is live
iter_k/issues.json     the issues the selected scene still has
iter_k/branch_i/       scene.json, thumb.png, tests.json
```
The manifest is rewritten after every iteration with `status: "running"`, so a viewer can poll it. `runs/index.json` selects the live and backup rooms.

## Scoring, honestly
The score is Argon's judgement of layout match against the footage, repeatable to within about 0.1 on the same scene and sensitive enough to rank a damaged scene below a good one. It plateaus around 0.85 on our videos. It does not measure photorealism, and the judge can be fooled: an early version scored 0.85 after adding a room-sized partition that hid everything, which is why added or resized objects must stay under 75% of the room's shorter side (thin decor wall panels are exempt). Judge by eye as well.

## Model calls
`model.ts` is the only Gemini adapter. It uploads videos through the Files API, converts zod schemas to Gemini response schemas, retries once with the validation error, times out a request after 120 s, and caches every call in `runs/.cache` (git-ignored). Set `DOORWAY_NOCACHE=1` to bypass the cache when measuring the model itself.

## Experiment switches
Defaults are unchanged without these: `DOORWAY_SCALE` (score range asked of the judge), `DOORWAY_SCORE=issues` (subtract open-issue penalties), `DOORWAY_TEMP` (proposal temperature), `DOORWAY_TESTISSUES=0` (do not count test failures as issues). `scripts/scorer-check.ts` measures scorer repeatability and sensitivity.
