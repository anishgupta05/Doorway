// Runs a mission in the 3D room: drive each leg, stop in front of the target, reach out
// with the arm and open (or switch on) exactly that thing, then go to the next.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { useApp } from "../store";
import { sfx } from "../sfx";
import { ACCENT } from "../scene/materials";
import { RobotBody, ROBOT_MESH_RADIUS } from "../scene/Robot";
import { ROBOT_RADIUS, densify, type Vec2 } from "./planner";
import { actionJoint } from "./actions";
import type { Mission } from "./mission";

const SPEED = 0.42; // m/s
const ACT = 1.3; // seconds spent opening a thing

export function MissionSim({ mission, start, runKey, radius = ROBOT_RADIUS }: { mission: Mission; start: Vec2; runKey: string | null; radius?: number }) {
  const g = useRef<THREE.Group>(null!);
  const arm = useRef(0);
  const st = useRef({ leg: 0, s: 0, phase: "idle" as "idle" | "drive" | "act" | "done", t: 0, acted: false });
  const pts = useMemo(() => mission.legs.map((l) => (l.plan.ok ? densify(l.plan.path, 0.01) : [])), [mission]);

  const setStatus = (i: number, v: "pending" | "driving" | "acting" | "done" | "failed") =>
    useApp.setState((s) => (s.mission ? { mission: { ...s.mission, current: i, status: s.mission.status.map((x, j) => (j === i ? v : x)) } } : {}));

  useEffect(() => {
    g.current.position.set(start[0], 0, start[1]);
    st.current = { leg: 0, s: 0, phase: runKey ? "drive" : "idle", t: 0, acted: false };
    arm.current = 0;
  }, [runKey, start]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const r = st.current;
    if (r.phase === "idle" || r.phase === "done") return;
    const leg = mission.legs[r.leg];
    if (!leg) {
      r.phase = "done";
      sfx.pass();
      return;
    }
    if (r.phase === "drive") {
      const p = pts[r.leg];
      // Already standing in the right spot (e.g. the next locker in the same column): just act.
      if (leg.plan.ok && p.length < 2) {
        r.phase = "act";
        r.t = 0;
        r.acted = false;
        setStatus(r.leg, "acting");
        return;
      }
      if (!leg.plan.ok) {
        // Can't reach it: say so and move on.
        setStatus(r.leg, "failed");
        sfx.reject();
        r.leg++;
        r.s = 0;
        return;
      }
      if (r.s === 0) setStatus(r.leg, "driving");
      r.s += dt * SPEED;
      const i = Math.min(p.length - 1, Math.floor(r.s / 0.01));
      const a = p[i];
      const b = p[Math.min(i + 1, p.length - 1)];
      g.current.position.set(a[0], 0, a[1]);
      if (b !== a) {
        const heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
        const turn = Math.atan2(Math.sin(heading - g.current.rotation.y), Math.cos(heading - g.current.rotation.y));
        g.current.rotation.y += turn * Math.min(1, dt * 8);
      }
      if (i >= p.length - 1) {
        r.phase = "act";
        r.t = 0;
        r.acted = false;
        setStatus(r.leg, "acting");
      }
      return;
    }
    // Act: turn to face the target, reach, open, retract.
    r.t += dt;
    const face = faceTarget(leg.stand, mission, leg.action.target);
    if (face !== null) {
      const turn = Math.atan2(Math.sin(face - g.current.rotation.y), Math.cos(face - g.current.rotation.y));
      g.current.rotation.y += turn * Math.min(1, dt * 6);
    }
    arm.current = Math.sin(Math.min(1, r.t / ACT) * Math.PI);
    if (!r.acted && r.t > ACT * 0.5) {
      r.acted = true;
      const key = actionJoint(leg.action);
      useApp.setState((s) => ({ joints: { ...s.joints, [key]: 1 } }));
      if (leg.action.kind === "switch") sfx.click();
      else if (leg.action.kind === "open") sfx.creak(true);
    }
    if (r.t >= ACT) {
      setStatus(r.leg, "done");
      arm.current = 0;
      r.leg++;
      r.s = 0;
      r.phase = "drive";
    }
  });

  return (
    <group>
      {mission.legs.map((l, i) =>
        l.plan.ok ? (
          <Line key={i} points={l.plan.path.map(([x, z]) => [x, 0.03, z] as [number, number, number])} color={ACCENT} lineWidth={2.5} transparent opacity={0.85} toneMapped={false} />
        ) : null,
      )}
      {mission.legs.map((l, i) =>
        l.stand ? (
          <group key={`m${i}`} position={[l.stand[0], 0, l.stand[1]]}>
            <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.07, 0.095, 32]} />
              <meshBasicMaterial color={l.plan.ok ? ACCENT : "#ef6b6b"} toneMapped={false} />
            </mesh>
            <Html position={[0, 0.28, 0]} center zIndexRange={[20, 0]}>
              <div className={`pointer-events-none grid h-5 w-5 place-items-center rounded-full font-mono text-[10px] font-bold ${l.plan.ok ? "bg-accent text-ink" : "bg-bad text-ink"}`}>{i + 1}</div>
            </Html>
          </group>
        ) : null,
      )}
      <group ref={g}>
        <RobotBody active={!!runKey} scale={radius / ROBOT_MESH_RADIUS} arm={arm} />
      </group>
    </group>
  );
}

/** Heading that faces the target object from where the robot stands. */
const headings = new Map<string, number>();
function faceTarget(stand: Vec2 | null, mission: Mission, target: string): number | null {
  if (!stand) return null;
  const key = `${target}@${stand[0].toFixed(2)},${stand[1].toFixed(2)}`;
  if (headings.has(key)) return headings.get(key)!;
  const leg = mission.legs.find((l) => l.action.target === target);
  const o = leg && mission.scene.objects.find((x) => x.id === target);
  if (!o) return null;
  const h = Math.atan2(o.position[0] - stand[0], o.position[2] - stand[1]);
  headings.set(key, h);
  return h;
}
