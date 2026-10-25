// Replays a physics-trained robot task in the room: the best test run from the MuJoCo
// verifier (trajectory.json), with the robot, the door it pushed and anything it shoved
// moving exactly as they did in the simulation. Loops with a pause, so it can run on stage.
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import type { Scene } from "@doorway/schema";
import { ACCENT } from "../scene/materials";
import { RobotBody, ROBOT_MESH_RADIUS } from "../scene/Robot";
import { ROBOT_RADIUS } from "./planner";
import { useApp } from "../store";
import { sfx } from "../sfx";
import type { Frame, SimSpec, Trajectory } from "../data/tasks";

const LEAD_IN = 0.8; // s before it starts moving
const HOLD = 2.2; // s it rests on the finished task before looping

/** MuJoCo is z-up; the scene is y-up. Floor (x, y) in MuJoCo is (x, -y) in scene x, z. */
const toScene = (x: number, y: number): [number, number] => [x, -y];
/** MuJoCo yaw (robot faces +x) → three.js rotation.y for a body that faces +z. */
const heading = (yaw: number) => Math.atan2(Math.cos(yaw), -Math.sin(yaw));
/** Yaw of a MuJoCo quaternion [w, x, y, z] about its z axis = scene yaw about y. */
const quatYaw = ([w, x, y, z]: number[]) => Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

function sample(frames: Frame[], fps: number, t: number) {
  const f = Math.min(frames.length - 1, Math.max(0, t * fps));
  const i = Math.floor(f);
  return { a: frames[i], b: frames[Math.min(i + 1, frames.length - 1)], u: f - i };
}

export function TrainedReplay({ scene, traj, spec }: { scene: Scene; traj: Trajectory; spec: SimSpec | null }) {
  const robot = useRef<THREE.Group>(null!);
  const nonce = useApp((s) => s.trainedNonce);
  const clock = useRef(-LEAD_IN);
  const lastCreak = useRef(false);
  const [trail, setTrail] = useState<[number, number, number][]>([]);
  const duration = (traj.frames.length - 1) / traj.fps;

  // Object ids for recorded joints ("door_1_hinge" -> door_1), with the scene's [closed, open] range.
  const joints = useMemo(
    () =>
      Object.keys(traj.frames[0]?.joints ?? {}).flatMap((name) => {
        const id = name.replace(/_(hinge|slide)$/, "");
        const o = scene.objects.find((x) => x.id === id);
        const a = o?.articulation;
        return a && (a.kind === "hinge" || a.kind === "slide") ? [{ name, id, lo: a.range[0], hi: a.range[1], door: o.type === "door" }] : [];
      }),
    [traj, scene],
  );
  const bodies = useMemo(() => Object.keys(traj.frames[0]?.bodies ?? {}).flatMap((id) => {
    const o = scene.objects.find((x) => x.id === id);
    return o ? [o] : [];
  }), [traj, scene]);

  // The whole path, sampled for the trail line.
  const path = useMemo(() => traj.frames.filter((_, i) => i % 3 === 0).map((f) => {
    const [x, z] = toScene(f.robot[0], f.robot[1]);
    return [x, 0.03, z] as [number, number, number];
  }), [traj]);

  const goal = useMemo<[number, number] | null>(() => {
    const t = spec?.target;
    if (t && "point" in t) return toScene(t.point[0], t.point[1]);
    // Drive-to goals are a stretch of floor next to an object: mark where the robot actually stopped.
    if (t && "body" in t) {
      const end = traj.frames[traj.frames.length - 1]?.robot;
      return end ? toScene(end[0], end[1]) : null;
    }
    return null;
  }, [spec, traj]);

  useEffect(() => {
    clock.current = -LEAD_IN;
    lastCreak.current = false;
    setTrail([]);
    useApp.getState().reset();
  }, [traj, nonce]);
  // Leave the room as it was when the replay goes away.
  useEffect(() => () => useApp.getState().reset(), []);

  useFrame((_, rawDt) => {
    clock.current += Math.min(rawDt, 1 / 20);
    if (clock.current > duration + HOLD) {
      clock.current = -LEAD_IN;
      lastCreak.current = false;
      setTrail([]);
      useApp.getState().reset();
    }
    const t = Math.max(0, Math.min(duration, clock.current));
    const { a, b, u } = sample(traj.frames, traj.fps, t);
    const [x, z] = toScene(a.robot[0] + (b.robot[0] - a.robot[0]) * u, a.robot[1] + (b.robot[1] - a.robot[1]) * u);
    robot.current.position.set(x, 0, z);
    robot.current.rotation.y = heading(lerpAngle(a.robot[2], b.robot[2], u));

    const s = useApp.getState();
    const nextJoints = { ...s.joints };
    for (const j of joints) {
      const q = a.joints[j.name] + (b.joints[j.name] - a.joints[j.name]) * u;
      nextJoints[j.id] = j.hi === j.lo ? 0 : (q - j.lo) / (j.hi - j.lo);
      if (j.door && !lastCreak.current && nextJoints[j.id] > 0.08) {
        lastCreak.current = true;
        sfx.creak(true);
      }
    }
    const pushes = { ...s.pushes };
    const turns = { ...s.turns };
    for (const o of bodies) {
      const pa = a.bodies[o.id];
      const pb = b.bodies[o.id];
      const [bx, bz] = toScene(pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u);
      pushes[o.id] = [bx - o.position[0], bz - o.position[2]];
      turns[o.id] = lerpAngle(quatYaw(pa.slice(3)), quatYaw(pb.slice(3)), u) - o.rotationY;
    }
    useApp.setState({ joints: nextJoints, pushes, turns });

    // Grow the trail with the robot.
    const shown = Math.round((t / Math.max(duration, 1e-6)) * (path.length - 1)) + 1;
    if (shown !== trail.length) setTrail(path.slice(0, shown));
  });

  return (
    <group>
      {goal && (
        <group position={[goal[0], 0, goal[1]]}>
          <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.12, 0.16, 48]} />
            <meshBasicMaterial color={ACCENT} toneMapped={false} transparent opacity={0.9} />
          </mesh>
          <Html position={[0, 0.4, 0]} center zIndexRange={[20, 0]}>
            <div className="pointer-events-none rounded-full border border-accent/60 bg-ink/85 px-2 py-0.5 font-mono text-[10px] whitespace-nowrap text-accent">
              {spec?.type === "push_object" ? `${spec.object} goes here` : "goal"}
            </div>
          </Html>
        </group>
      )}
      {trail.length > 1 && <Line points={trail} color={ACCENT} lineWidth={3} toneMapped={false} transparent opacity={0.85} />}
      <group ref={robot}>
        <RobotBody active scale={ROBOT_RADIUS / ROBOT_MESH_RADIUS} />
      </group>
    </group>
  );
}
