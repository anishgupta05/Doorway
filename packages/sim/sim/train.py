"""Train a PPO policy for one spec.
usage: python -m sim.train --spec specs/go_to_desk.json --out out/go-to-desk/"""
import argparse
import json
import os
import time

import numpy as np
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.env_util import make_vec_env
from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv

from .env import RoomTaskEnv, load_spec

N_ENVS, N_STEPS = 8, 256  # 2048 steps per rollout


def write_json(path, obj, indent=1):
    """Atomic write, so a UI polling the file never reads half of it."""
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=indent, separators=None if indent else (",", ":"))
    os.replace(tmp, path)


class LogCallback(BaseCallback):
    """Appends {steps, mean_reward, success_rate, elapsed_s} to train_log.json every rollout.
    Stops early once the last 100 episodes succeed >= 97% of the time."""

    def __init__(self, path, early_stop=0.97):
        super().__init__()
        self.path, self.early_stop = path, early_stop
        self.log, self.rew, self.succ, self.t0, self.stop = [], [], [], time.time(), False

    def _on_step(self):
        for done, info in zip(self.locals["dones"], self.locals["infos"]):
            if done:
                self.rew.append(info["episode"]["r"])
                self.succ.append(float(info.get("is_success", False)))
        return not self.stop

    def _on_rollout_end(self):
        if not self.rew:
            return
        self.log.append(dict(steps=self.num_timesteps, mean_reward=round(float(np.mean(self.rew[-100:])), 3),
                             success_rate=round(float(np.mean(self.succ[-100:])), 3),
                             elapsed_s=round(time.time() - self.t0, 1)))
        write_json(self.path, self.log)
        print(self.log[-1], flush=True)
        self.stop = len(self.succ) >= 100 and np.mean(self.succ[-100:]) >= self.early_stop


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--spec", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--steps", type=int, help="override spec.train_steps")
    p.add_argument("--subproc", action="store_true", help="SubprocVecEnv instead of DummyVecEnv")
    args = p.parse_args()
    spec = load_spec(args.spec)
    os.makedirs(args.out, exist_ok=True)
    torch.set_num_threads(1)  # tiny MLP: threading overhead beats any speedup

    seed = spec.get("seed", 0)
    vec_cls = SubprocVecEnv if args.subproc else DummyVecEnv
    env = make_vec_env(RoomTaskEnv, N_ENVS, seed=seed, env_kwargs=dict(spec=spec), vec_env_cls=vec_cls)
    model = PPO("MlpPolicy", env, n_steps=N_STEPS, batch_size=512, n_epochs=5, learning_rate=3e-4,
                gamma=0.99, gae_lambda=0.95, ent_coef=0.0, clip_range=0.2, seed=seed, device="cpu",
                policy_kwargs=dict(net_arch=[128, 128]), verbose=0)
    cb = LogCallback(os.path.join(args.out, "train_log.json"))
    t0 = time.time()
    try:
        model.learn(args.steps or spec.get("train_steps", 300_000), callback=cb)
    finally:
        model.save(os.path.join(args.out, "policy.zip"))
        env.close()
    print(f"trained {model.num_timesteps} steps in {time.time() - t0:.1f}s -> {args.out}")


if __name__ == "__main__":
    main()
