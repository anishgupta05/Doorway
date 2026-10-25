# @doorway/sim

Trains and verifies robot tasks in an exported Doorway room (MuJoCo MJCF from `packages/export`).
A planar robot base (`robot`, see the exporter) learns one task per `spec.json` with PPO on CPU.

## Setup
Python 3.13 (Homebrew). 3.14 isn't used because torch/mujoco wheels lag behind.
```bash
cd packages/sim
/opt/homebrew/bin/python3.13 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -c "import mujoco, gymnasium, stable_baselines3; print(mujoco.__version__)"
```

## Usage
Run from `packages/sim`:
```bash
.venv/bin/python -m sim.train  --spec specs/go_to_desk.json --out out/go-to-desk/
.venv/bin/python -m sim.verify --spec specs/go_to_desk.json --policy out/go-to-desk/policy.zip --out out/go-to-desk/
```
- `train` writes `train_log.json` after every rollout (2048 steps; a list of `{steps, mean_reward, success_rate, elapsed_s}`,
  written atomically so a UI can poll it), then `policy.zip`. It stops early once 97% of the last 100 training
  episodes succeed. `--steps N` overrides `train_steps`; `--subproc` uses SubprocVecEnv (slower on an M3 for this model).
- `verify` runs 10 rollouts from jittered starts, writes `verdict.json` (`pass` = success_rate >= 0.8) and
  `trajectory.json` (the fastest successful episode, 30 fps, MuJoCo coords; free bodies and hinge/slide joints included).
  It tries the deterministic (mean) action first; if that fails it re-runs with seeded sampling, since some pushing
  policies only work with the action noise PPO trained them with, and records which in `"mode"`.

The room fixture is `fixtures/mock_room.xml`. Regenerate it from the repo root:
```bash
npx tsx scripts/export-mjcf.ts runs/mock/iter_4/branch_1/scene.json packages/sim/fixtures/mock_room.xml --robot
```

## spec.json
```jsonc
{ "id": "open-door", "type": "go_to" | "push_door" | "push_object",
  "mjcf": "../fixtures/mock_room.xml",       // relative to the spec file, then the cwd
  "target": { "body": "desk_1" } | { "point": [x, y] },  // go_to, push_object
  "object": "chair_2",                       // push_object
  "door": "door_1",                          // push_door (joint door_1_hinge)
  "start": [x, y, yaw],                      // optional robot start, MuJoCo world; default = robot body pos, yaw 0
  "success": { "radius": 0.4 } | { "angle_deg": 60 },
  "max_seconds": 15, "train_steps": 300000, "seed": 0,
  "reward": { "reach": 2.0 } }                 // optional: override template weights (sim/rewards.py TEMPLATES)
```
The task pipeline (`npm run task -- --id <run> "<request>"`, packages/orchestrator/src/task) writes these specs for you.
Success:
- `go_to` point: robot base center within `radius` of the point.
- `go_to` body: the gap between the robot base's edge and the body's xy footprint (bounding rect of its geoms,
  in the body frame) is <= `radius`. The policy sees the nearest footprint point as its target.
- `push_door`: hinge angle >= `angle_deg`.
- `push_object`: the object's center is within `radius` of the target (or of a target body's footprint). Shaping
  pulls the robot to a push point just behind the object (opposite the target) first.

## Env (`sim/env.py`)
- 20 Hz control (frame skip 25 at the 2 ms timestep). Episodes truncate at `max_seconds` and terminate on success.
- Action `[-1, 1]^3` = (forward, sideways, turn) in the robot frame, rotated by yaw into the world-aligned slide
  joints. Planar speed is capped at 0.6 m/s.
- Observation: robot xy, sin/cos yaw, robot-frame velocity (vx, vy, wz), robot-frame vector to the target, plus
  per type: object vector and object-to-target vector (`push_object`), door-center vector and sin/cos hinge angle
  (`push_door`); then 16 range rays at 0.11 m height (robot excluded), clipped at 4 m and normalized.
- Reset jitters the start by ±0.1 m and ±0.3 rad.
- Rewards (`sim/rewards.py`) are templates with parameters only: progress on task costs, a success bonus,
  small time and action penalties, and a penalty when the robot presses on static geometry with > 30 N.
  Costs: `go_to` distance outside the goal radius; `push_door` distance to the door's center plus angle short of
  the goal; `push_object` distance to the push pose (just behind the object, opposite the target) plus the
  object's distance outside the goal radius.
