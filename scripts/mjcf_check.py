# Physics sanity check for an exported room (run by scripts/mjcf-check.ts with the sim venv).
# 1. Settle: 2 s with no control; nothing should move or start inside something else.
# 2. Door: for each case, put the robot on the door's push side, drive at the door, expect it to swing open.
# Usage: python mjcf_check.py room.xml '<json: [{door, start: [x, y, yaw], dir: [dx, dy]}]>'
import json
import sys

import mujoco
import numpy as np

xml, cases = sys.argv[1], json.loads(sys.argv[2]) if len(sys.argv) > 2 else []
model = mujoco.MjModel.from_xml_path(xml)
ok = True


def body_xy(data, name):
    return data.xpos[model.body(name).id].copy()


def free_bodies():
    return [model.body(model.jnt_bodyid[j]).name for j in range(model.njnt) if model.jnt_type[j] == mujoco.mjtJoint.mjJNT_FREE]


# Settle.
data = mujoco.MjData(model)
mujoco.mj_forward(model, data)
# One line per geom pair (a box resting in a box has several contact points).
deep = sorted({
    (model.geom(c.geom1).name, model.geom(c.geom2).name, round(-c.dist, 3))
    for c in data.contact[: data.ncon]
    if c.dist < -0.01
})
start = {b: body_xy(data, b) for b in free_bodies()}
# jnt_type is a numpy int; `in` against the enum members is always False, so compare ints.
hinges = [j for j in range(model.njnt) if int(model.jnt_type[j]) in (int(mujoco.mjtJoint.mjJNT_HINGE), int(mujoco.mjtJoint.mjJNT_SLIDE))]
q0 = {model.joint(j).name: data.qpos[model.jnt_qposadr[j]] for j in hinges}
mujoco.mj_step(model, data, nstep=int(2 / model.opt.timestep))
moved = {b: round(float(np.linalg.norm(body_xy(data, b) - p)), 3) for b, p in start.items()}
drift = {n: round(float(data.qpos[model.jnt_qposadr[model.joint(n).id]] - q), 3) for n, q in q0.items()}
bad_moved = {b: d for b, d in moved.items() if d > 0.05}
bad_drift = {n: d for n, d in drift.items() if abs(d) > 0.05 and not n.startswith("robot_")}
print(f"settle: {len(deep)} deep contacts at t=0, moved {moved}, joint drift {drift}")
for g1, g2, d in deep:
    print(f"  ✗ {g1} starts {d} m inside {g2}")
if deep or bad_moved or bad_drift:
    ok = False
    print(f"  ✗ settle failed: moved {bad_moved} drift {bad_drift}")
else:
    print("  ✓ settle")

# Door swing: sweep each door through its range. Doors collide with furniture, so a blocked
# swing stops short; that's the scene's problem (a warning), and the push test below only
# expects the door to reach where it's free to go.
free_swing = {}
for j in hinges:
    door = model.jnt_bodyid[j]
    name = model.body(door).name
    if not name.startswith("door"):
        continue
    lo, hi = model.jnt_range[j]
    end = hi if abs(hi) > abs(lo) else lo
    data = mujoco.MjData(model)
    reached, blocker = abs(end), None
    for a in np.linspace(0, end, 60)[1:]:
        data.qpos[model.jnt_qposadr[j]] = a
        mujoco.mj_forward(model, data)
        hit = {model.body(model.geom_bodyid[g]).name for c in data.contact[: data.ncon]
               for g, other in ((c.geom1, c.geom2), (c.geom2, c.geom1))
               if model.geom_bodyid[other] == door and model.geom_bodyid[g] != door
               and model.body(model.geom_bodyid[g]).name != "robot" and c.dist < -0.005}
        if hit:
            reached, blocker = abs(a), ", ".join(sorted(hit))
            break
    free_swing[name] = np.degrees(reached)
    print(f"swing {name}: " + (f"⚠ blocked by {blocker} at {np.degrees(reached):.0f}° (scene problem)" if blocker else "✓ clear"))

# Door push (needs the robot).
if cases and "robot" not in [model.body(b).name for b in range(model.nbody)]:
    sys.exit("door cases given but the model has no robot; export with --robot")
for case in cases:
    rx, ry, ryaw = (model.joint(n).qposadr[0] for n in ("robot_x", "robot_y", "robot_yaw"))
    base = model.body("robot").pos
    data = mujoco.MjData(model)
    sx, sy, syaw = case["start"]
    data.qpos[rx], data.qpos[ry], data.qpos[ryaw] = sx - base[0], sy - base[1], syaw
    hinge = model.joint(f"{case['door']}_hinge")
    dx, dy = case["dir"]
    peak = 0.0
    for _ in range(int(4 / model.opt.timestep / 10)):
        data.ctrl[model.actuator("robot_vx").id] = 0.4 * dx
        data.ctrl[model.actuator("robot_vy").id] = 0.4 * dy
        mujoco.mj_step(model, data, nstep=10)
        peak = max(peak, abs(data.qpos[hinge.qposadr[0]]))
    deg = np.degrees(peak)
    passed = deg >= min(60, free_swing.get(case["door"], 90) - 5)
    ok &= passed
    print(f"door {case['door']}: pushed from {case['start'][:2]} → opened {deg:.0f}° {'✓' if passed else '✗'}")

sys.exit(0 if ok else 1)
