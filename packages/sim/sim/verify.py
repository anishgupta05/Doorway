"""Roll out a trained policy deterministically from jittered starts and judge it.
usage: python -m sim.verify --spec specs/go_to_desk.json --policy out/go-to-desk/policy.zip --out out/go-to-desk/
Writes verdict.json and trajectory.json (best successful episode, 30 fps, MuJoCo coords)."""
import argparse
import os

import mujoco
import numpy as np
import torch
from stable_baselines3 import PPO

from .env import CONTROL_HZ, RoomTaskEnv, load_spec
from .train import write_json

FPS, N_EPISODES, MOVED_M, PASS = 30, 10, 0.1, 0.8
r4 = lambda a: [round(float(x), 4) for x in a]


def recorder(env):
    """Returns (frames, hook): hook samples a frame every 1/FPS s of sim time."""
    m = env.m
    J = mujoco.mjtJoint
    # jnt_type is a numpy int: `in` against enum members is always False, so compare ints.
    kind = lambda j: int(m.jnt_type[j])
    free = [(m.body(m.jnt_bodyid[j]).name, m.jnt_qposadr[j]) for j in range(m.njnt) if kind(j) == int(J.mjJNT_FREE)]
    joints = [(m.joint(j).name, m.jnt_qposadr[j]) for j in range(m.njnt)
              if kind(j) in (int(J.mjJNT_HINGE), int(J.mjJNT_SLIDE)) and m.jnt_bodyid[j] != env.robot]
    frames = []

    def hook(e):
        if e.d.time + 1e-9 < len(frames) / FPS:
            return
        q = e.d.qpos
        frames.append(dict(t=round(len(frames) / FPS, 4), robot=r4(e.robot_pose()),
                           bodies={n: r4(q[a:a + 7]) for n, a in free},
                           joints={n: round(float(q[a]), 4) for n, a in joints}))
    return frames, hook


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--spec", required=True)
    p.add_argument("--policy", required=True)
    p.add_argument("--out", required=True)
    args = p.parse_args()
    spec = load_spec(args.spec)
    os.makedirs(args.out, exist_ok=True)
    env = RoomTaskEnv(spec)
    model = PPO.load(args.policy, device="cpu")
    m, d = env.m, env.d
    task_body = {"push_object": spec.get("object"), "push_door": spec.get("door")}.get(env.kind)
    movable = [b for b in range(1, m.nbody) if m.body_weldid[b] != 0 and b != env.robot and m.body(b).name != task_body]

    def run(deterministic):
        episodes, best = [], None
        for i in range(N_EPISODES):
            frames, hook = recorder(env)
            obs, _ = env.reset(seed=1000 + i)
            hook(env)
            env.on_substep = hook
            start = d.xipos[movable].copy()
            hits, prev_hit, done = 0, False, False
            # Seeded sampling: the stochastic policy is the one PPO trained, and the run is still reproducible.
            torch.manual_seed(1000 + i)
            while not done:
                action, _ = model.predict(obs, deterministic=deterministic)
                obs, _, term, trunc, info = env.step(action)
                hits += info["hit"] and not prev_hit  # count hard-hit onsets, not hit duration
                prev_hit, done = info["hit"], term or trunc
            moved = np.linalg.norm(d.xipos[movable] - start, axis=1) > MOVED_M
            key = "final_angle" if env.kind == "push_door" else "final_distance"
            ep = {"success": bool(term), key: round(info["measure"], 3), "time_s": env.steps / CONTROL_HZ,
                  "collisions": int(hits), "moved_other_objects": [m.body(b).name for b, mv in zip(movable, moved) if mv]}
            episodes.append(ep)
            print(i, "det" if deterministic else "sto", ep)
            if term and (best is None or ep["time_s"] < best[0]):
                best = (ep["time_s"], frames)
        return episodes, best

    # The mean action first (smoothest replay); some pushing policies only work with their
    # trained action noise, so fall back to seeded sampling and say which one passed.
    mode = "deterministic"
    episodes, best = run(True)
    if np.mean([e["success"] for e in episodes]) < PASS:
        sto = run(False)
        if np.mean([e["success"] for e in sto[0]]) > np.mean([e["success"] for e in episodes]):
            mode, (episodes, best) = "stochastic", sto

    rate = float(np.mean([e["success"] for e in episodes]))
    write_json(os.path.join(args.out, "verdict.json"),
               {"id": spec["id"], "success_rate": rate, "pass": rate >= PASS, "mode": mode, "per_episode": episodes})
    traj = os.path.join(args.out, "trajectory.json")
    if best:
        write_json(traj, {"fps": FPS, "frames": best[1]}, indent=None)
    elif os.path.exists(traj):
        os.remove(traj)  # don't leave a stale success from an older policy
    print(f"success_rate={rate:.2f} pass={rate >= PASS} mode={mode}")


if __name__ == "__main__":
    main()
