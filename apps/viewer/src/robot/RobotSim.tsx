// What the robot "sees" and does: its occupancy grid painted on the floor
// (furniture in red, the margin its body can't enter in amber), the planned path,
// the goal, and the robot driving it, stopping where the plan meets reality.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { ACCENT } from "../scene/materials";
import { RobotBody, ROBOT_MESH_RADIUS } from "../scene/Robot";
import { CELL, ROBOT_RADIUS, densify, type Grid, type Vec2 } from "./planner";
import { useApp } from "../store";
import { sfx } from "../sfx";

export type SimRun = {
  /** Changes whenever a new drive should start. */
  key: string;
  /** Doors the robot opens before it sets off. */
  open?: string[];
  path: Vec2[];
  /** Stop after this many metres (the first collision), or drive to the end. */
  stopAt: number | null;
  color: "accent" | "bad";
};

export function RobotSim({
  grid,
  start,
  goal,
  run,
  collision,
  onDone,
}: {
  grid: Grid;
  start: Vec2;
  goal: Vec2;
  run: SimRun | null;
  collision: { at: Vec2; what: string } | null;
  onDone: (key: string) => void;
}) {
  return (
    <group>
      <GridOverlay grid={grid} />
      <mesh position={[goal[0], 0.02, goal[1]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.1, 0.13, 40]} />
        <meshBasicMaterial color={ACCENT} toneMapped={false} transparent opacity={0.9} />
      </mesh>
      <Html position={[goal[0], 0.35, goal[1]]} center zIndexRange={[20, 0]}>
        <div className="pointer-events-none rounded-full border border-accent/60 bg-ink/85 px-2 py-0.5 font-mono text-[10px] whitespace-nowrap text-accent">goal</div>
      </Html>
      {run && run.path.length > 1 && (
        <Line
          points={run.path.map(([x, z]) => [x, 0.03, z] as [number, number, number])}
          color={run.color === "bad" ? "#ef6b6b" : ACCENT}
          lineWidth={3}
          dashed={run.color === "bad"}
          dashSize={0.08}
          gapSize={0.05}
          toneMapped={false}
        />
      )}
      {collision && (
        <group position={[collision.at[0], 0, collision.at[1]]}>
          <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[ROBOT_RADIUS, ROBOT_RADIUS + 0.04, 40]} />
            <meshBasicMaterial color="#ef6b6b" toneMapped={false} />
          </mesh>
          <Html position={[0, 0.75, 0]} center zIndexRange={[25, 0]}>
            <div className="pointer-events-none rounded-full border border-bad/70 bg-ink/90 px-2.5 py-1 font-mono text-[11px] whitespace-nowrap text-fg shadow-lg">
              <span className="text-bad">✗ collision</span> with {collision.what}
            </div>
          </Html>
        </group>
      )}
      <Driver start={start} run={run} onDone={onDone} />
    </group>
  );
}

function Driver({ start, run, onDone }: { start: Vec2; run: SimRun | null; onDone: (key: string) => void }) {
  const g = useRef<THREE.Group>(null!);
  const st = useRef<{ s: number; done: boolean; key: string; wait?: number }>({ s: 0, done: false, key: "" });
  const pts = useMemo(() => (run ? densify(run.path, 0.01) : []), [run]);
  const total = useMemo(() => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0), [pts]);

  useEffect(() => {
    st.current = { s: 0, done: false, key: run?.key ?? "" };
    if (run?.open?.length) {
      useApp.setState((a) => ({ joints: { ...a.joints, ...Object.fromEntries(run.open!.map((id) => [id, 1])) } }));
      sfx.creak(true);
    }
    const p = run?.path[0] ?? start;
    g.current.position.set(p[0], 0, p[1]);
    if (run && run.path.length > 1) g.current.rotation.y = Math.atan2(run.path[1][0] - p[0], run.path[1][1] - p[1]);
  }, [run, start]);

  useFrame((_, rawDt) => {
    if (!run || st.current.done || pts.length < 2) return;
    const dt = Math.min(rawDt, 1 / 30);
    // Let an opening door swing clear before rolling.
    if (run.open?.length && (st.current.wait = (st.current.wait ?? 0) + dt) < 1.4) return;
    const end = Math.min(total, run.stopAt ?? total);
    st.current.s = Math.min(end, st.current.s + dt * 0.38);
    // Find the point at arc length s.
    let acc = 0;
    let i = 0;
    for (; i < pts.length - 1; i++) {
      const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      if (acc + seg >= st.current.s) break;
      acc += seg;
    }
    const a = pts[i];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    const seg = Math.max(1e-6, Math.hypot(b[0] - a[0], b[1] - a[1]));
    const t = Math.min(1, (st.current.s - acc) / seg);
    g.current.position.set(a[0] + (b[0] - a[0]) * t, 0, a[1] + (b[1] - a[1]) * t);
    const heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
    const turn = Math.atan2(Math.sin(heading - g.current.rotation.y), Math.cos(heading - g.current.rotation.y));
    g.current.rotation.y += turn * Math.min(1, dt * 8);
    if (st.current.s >= end - 1e-4) {
      st.current.done = true;
      onDone(run.key);
    }
  });

  return (
    <group ref={g}>
      <RobotBody active={!!run} scale={ROBOT_RADIUS / ROBOT_MESH_RADIUS} />
    </group>
  );
}

/** Occupied cells in red, the robot's no-go margin in amber, free floor clear. */
function GridOverlay({ grid }: { grid: Grid }) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = grid.nx;
    c.height = grid.nz;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(grid.nx, grid.nz);
    for (let k = 0; k < grid.nz; k++)
      for (let i = 0; i < grid.nx; i++) {
        const n = k * grid.nx + i;
        const o = (k * grid.nx + i) * 4;
        if (grid.owner[n] === 255) continue; // walls are drawn by the room itself
        if (grid.occ[n]) [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]] = [239, 107, 107, 150];
        else if (grid.dist[n] < ROBOT_RADIUS) [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]] = [243, 179, 107, 95];
      }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [grid]);
  const w = grid.nx * CELL;
  const h = grid.nz * CELL;
  return (
    // Canvas row k is world z (texture flipY maps row 0 to the plane's far edge, i.e. min z).
    <mesh position={[grid.x0 + (grid.nx - 1) * CELL * 0.5, 0.015, grid.z0 + (grid.nz - 1) * CELL * 0.5]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
