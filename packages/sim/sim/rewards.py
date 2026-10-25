"""Reward templates, one per task type. Parameters only: the env measures task "costs"
(quantities that should shrink to 0) and these weights turn their per-step decrease into
progress reward. Potential-style shaping, so a policy can't farm reward by oscillating."""
import numpy as np

# Shared by every task type.
COMMON = dict(success=10.0, time=0.01, action=0.005, collision=0.5)

# Per type: cost name -> reward per unit of decrease. Costs come from RoomTaskEnv._costs().
TEMPLATES = {
    "go_to": {"dist": 2.0},                    # m from goal region
    "push_door": {"reach": 1.0, "angle": 4.0},  # m from door face, rad short of goal angle
    "push_object": {"reach": 1.0, "dist": 4.0},  # m from push pose behind object, m object is from target
}


def weights(kind, override=None):
    """The template for a task type, with any spec.json `reward` overrides (unknown cost names are ignored)."""
    w = dict(TEMPLATES[kind])
    w.update({k: float(v) for k, v in (override or {}).items() if k in w})
    return w


def reward(w, prev, cur, action, hard_hit, success):
    """w: cost weights (see weights()). prev/cur: dicts of costs before/after the step. hard_hit: robot hit static geometry hard."""
    r = sum(w[k] * (prev[k] - cur[k]) for k in w)
    r -= COMMON["time"] + COMMON["action"] * float(np.square(action).sum())
    if hard_hit:
        r -= COMMON["collision"]
    if success:
        r += COMMON["success"]
    return r
