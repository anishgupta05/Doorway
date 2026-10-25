"""RoomTaskEnv: a planar robot base doing one task (spec.json) in an exported Doorway room.
MuJoCo world is z-up, meters. The robot's slide joints are world-aligned, so robot-frame
commands are rotated by yaw into world velocities."""
import json
import os

import gymnasium as gym
import mujoco
import numpy as np

from . import rewards

CONTROL_HZ = 20
N_RAYS, RAY_MAX, RAY_Z = 16, 4.0, 0.11  # ray origin = base center height (0.01 float + 0.1)
ROBOT_R = 0.17  # packages/export/src/floor.ts ROBOT_RADIUS
HIT_N = 30.0  # contact normal force (N) against static geometry that counts as a hard hit
JITTER_XY, JITTER_YAW = 0.1, 0.3


def load_spec(path):
    """Read spec.json; a relative `mjcf` resolves against the spec's folder, then the cwd."""
    with open(path) as f:
        spec = json.load(f)
    p = spec["mjcf"]
    if not os.path.isabs(p):
        near = os.path.join(os.path.dirname(os.path.abspath(path)), p)
        p = near if os.path.exists(near) else os.path.abspath(p)
    spec["mjcf"] = p
    return spec


def rot(yaw):
    c, s = np.cos(yaw), np.sin(yaw)
    return np.array([[c, -s], [s, c]])


class RoomTaskEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, spec, jitter=True):
        self.spec, self.kind, self.jitter = spec, spec["type"], jitter
        self.weights = rewards.weights(self.kind, spec.get("reward"))
        self.m = m = mujoco.MjModel.from_xml_path(spec["mjcf"])
        self.d = mujoco.MjData(m)
        self.frame_skip = round(1 / CONTROL_HZ / m.opt.timestep)
        self.max_steps = int(spec.get("max_seconds", 15) * CONTROL_HZ)
        self.on_substep = None  # verify.py hooks this to record trajectories

        self.robot = m.body("robot").id
        self.qadr = [m.joint(j).qposadr[0] for j in ("robot_x", "robot_y", "robot_yaw")]
        self.vadr = [m.joint(j).dofadr[0] for j in ("robot_x", "robot_y", "robot_yaw")]
        self.act = [m.actuator(a).id for a in ("robot_vx", "robot_vy", "robot_wz")]
        self.vmax = m.actuator_ctrlrange[self.act, 1].copy()
        home = m.body_pos[self.robot][:2]
        sx, sy, syaw = spec.get("start", [*home, 0.0])
        self.start = np.array([sx - home[0], sy - home[1], syaw])  # in robot qpos units
        self.robot_geoms = set(np.flatnonzero(m.geom_bodyid == self.robot))
        self.static_geoms = set(np.flatnonzero(m.body_weldid[m.geom_bodyid] == 0))

        mujoco.mj_forward(m, self.d)
        t = spec.get("target", {})
        self.goal_body = m.body(t["body"]).id if "body" in t else None
        self.goal_point = np.array(t["point"], float) if "point" in t else None
        self.rects = {}  # body id -> xy footprint [xmin, ymin, xmax, ymax] in body frame
        if self.goal_body is not None:
            self.rects[self.goal_body] = self._footprint(self.goal_body)
        succ = spec.get("success", {})
        self.radius = succ.get("radius", 0.4)
        if self.kind == "push_object":
            self.obj = m.body(spec["object"]).id
            self.rects[self.obj] = r = self._footprint(self.obj)
            self.obj_half = float(np.max(np.abs(r)))
        if self.kind == "push_door":
            self.door = m.body(spec["door"]).id
            self.hinge = m.joint(spec["door"] + "_hinge").qposadr[0]
            self.goal_angle = np.deg2rad(succ.get("angle_deg", 60))

        a = np.linspace(0, 2 * np.pi, N_RAYS, endpoint=False)
        self.ray_dirs = np.stack([np.cos(a), np.sin(a)], 1)
        n_obs = 9 + N_RAYS + {"go_to": 0, "push_door": 2, "push_object": 4}[self.kind]
        self.observation_space = gym.spaces.Box(-np.inf, np.inf, (n_obs,), np.float32)
        self.action_space = gym.spaces.Box(-1, 1, (3,), np.float32)

    # --- geometry helpers ---
    def _footprint(self, b):
        """Body-frame xy bounding rect of all the body's geoms (from MuJoCo's geom AABBs)."""
        m, d = self.m, self.d
        R, p = d.xmat[b].reshape(3, 3), d.xpos[b]
        pts = []
        for g in np.flatnonzero(m.geom_bodyid == b):
            c, h = m.geom_aabb[g, :3], m.geom_aabb[g, 3:]
            corners = c + h * np.array([[i, j, k] for i in (-1, 1) for j in (-1, 1) for k in (-1, 1)])
            world = corners @ d.geom_xmat[g].reshape(3, 3).T + d.geom_xpos[g]
            pts.append((world - p) @ R)
        pts = np.concatenate(pts)[:, :2]
        return np.r_[pts.min(0), pts.max(0)]

    def _nearest(self, b, xy):
        """Nearest point to xy on body b's footprint (assumes the body stays upright)."""
        R2, p = self.d.xmat[b].reshape(3, 3)[:2, :2], self.d.xpos[b, :2]
        r = self.rects[b]
        local = np.clip(R2.T @ (xy - p), r[:2], r[2:])
        return p + R2 @ local

    def _goal(self, xy):
        return self._nearest(self.goal_body, xy) if self.goal_body is not None else self.goal_point

    # --- state ---
    def robot_pose(self):
        q = self.d.qpos[self.qadr]
        home = self.m.body_pos[self.robot]
        return np.array([home[0] + q[0], home[1] + q[1], q[2]])

    def door_angle(self):
        return float(self.d.qpos[self.hinge])

    def object_xy(self):
        return self.d.xpos[self.obj, :2].copy()

    def _costs(self):
        """Task costs that shrink to 0 (rewards.py weights their decrease) plus the success flag."""
        xy = self.robot_pose()[:2]
        if self.kind == "go_to":
            g = self._goal(xy)
            gap = np.linalg.norm(g - xy) - (ROBOT_R if self.goal_body is not None else 0)
            self.measure = float(gap)
            return {"dist": max(0.0, gap - self.radius)}, gap <= self.radius
        if self.kind == "push_door":
            th = self.door_angle()
            self.measure = float(np.rad2deg(th))
            reach = np.linalg.norm(self.d.xipos[self.door, :2] - xy) - 0.35
            return {"reach": max(0.0, reach), "angle": max(0.0, self.goal_angle - th)}, th >= self.goal_angle
        # Reach the push pose: just behind the object on the far side from the target.
        o = self.object_xy()
        to_goal = self._goal(o) - o
        od = np.linalg.norm(to_goal)
        behind = o - to_goal / max(od, 1e-6) * (self.obj_half + ROBOT_R + 0.02)
        self.measure = float(od)
        reach = np.linalg.norm(behind - xy) - 0.1
        return {"reach": max(0.0, reach), "dist": max(0.0, od - self.radius)}, od <= self.radius

    def _hard_hit(self):
        f = np.zeros(6)
        for i in range(self.d.ncon):
            c = self.d.contact[i]
            pair = (c.geom1 in self.robot_geoms, c.geom2 in self.robot_geoms)
            other = c.geom2 if pair[0] else c.geom1
            if any(pair) and other in self.static_geoms:
                mujoco.mj_contactForce(self.m, self.d, i, f)
                if f[0] > HIT_N:
                    return True
        return False

    def _rays(self, x, y, yaw):
        vec = np.c_[self.ray_dirs @ rot(yaw).T, np.zeros(N_RAYS)].ravel()
        geomid = np.zeros(N_RAYS, np.int32)
        dist = np.zeros(N_RAYS)
        mujoco.mj_multiRay(self.m, self.d, np.array([x, y, RAY_Z]), vec, None, True, self.robot,
                           geomid, dist, None, N_RAYS, RAY_MAX)
        dist[dist < 0] = RAY_MAX
        return np.minimum(dist, RAY_MAX) / RAY_MAX

    def _obs(self):
        x, y, yaw = self.robot_pose()
        xy = np.array([x, y])
        Rt = rot(yaw).T  # world -> robot frame
        v = self.d.qvel[self.vadr]
        parts = [xy, [np.sin(yaw), np.cos(yaw)], Rt @ v[:2], [v[2]]]
        if self.kind == "push_object":
            o = self.object_xy()
            g = self._goal(o)
            parts += [Rt @ (g - xy), Rt @ (o - xy), Rt @ (g - o)]
        elif self.kind == "push_door":
            th = self.door_angle()
            parts += [Rt @ (self.d.xipos[self.door, :2] - xy), [np.sin(th), np.cos(th)]]
        else:
            parts += [Rt @ (self._goal(xy) - xy)]
        parts.append(self._rays(x, y, yaw))
        return np.concatenate(parts).astype(np.float32)

    # --- gym API ---
    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        mujoco.mj_resetData(self.m, self.d)
        q = self.start.copy()
        if self.jitter:
            q += self.np_random.uniform(-1, 1, 3) * [JITTER_XY, JITTER_XY, JITTER_YAW]
        self.d.qpos[self.qadr] = q
        mujoco.mj_forward(self.m, self.d)
        self.steps = 0
        self.costs, _ = self._costs()
        return self._obs(), {}

    def step(self, action):
        a = np.clip(np.asarray(action, float), -1, 1)
        fs = a[:2] / max(1.0, np.linalg.norm(a[:2]))  # keep planar speed <= vmax
        yaw = self.robot_pose()[2]
        self.d.ctrl[self.act] = [*(rot(yaw) @ fs) * self.vmax[:2], a[2] * self.vmax[2]]
        if self.on_substep is None:
            mujoco.mj_step(self.m, self.d, self.frame_skip)
        else:
            for _ in range(self.frame_skip):
                mujoco.mj_step(self.m, self.d)
                self.on_substep(self)
        self.steps += 1
        costs, success = self._costs()
        hit = self._hard_hit()
        r = rewards.reward(self.weights, self.costs, costs, a, hit, success)
        self.costs = costs
        info = {"is_success": bool(success), "hit": hit, "measure": self.measure}
        return self._obs(), float(r), bool(success), self.steps >= self.max_steps, info
