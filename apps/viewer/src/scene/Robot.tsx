// The payoff: a small mobile robot waits in the corridor behind the door. Once the
// door is open far enough, it drives in along a short route and scans the room.
// Scripted motion, not a controller — it's here to show what the sim is for.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Scene } from "@doorway/schema";
import { useApp } from "../store";
import { ACCENT, material } from "./materials";
import { WALL_T } from "./Room";

const SPEED = 0.55;

export function Robot({ scene }: { scene: Scene }) {
  const door = scene.objects.find((o) => o.type === "door" && o.articulation?.kind === "hinge");
  const opening = scene.room.openings.find((o) => o.kind === "door");
  const route = useMemo(() => {
    if (!door || !opening) return null;
    // Outward normal of the door's wall.
    const n = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[opening.wall] as [number, number];
    const [dx, , dz] = door.position;
    const p = (x: number, z: number) => new THREE.Vector3(x, 0, z);
    const out = 1.1 + WALL_T;
    return [
      p(dx + n[0] * out, dz + n[1] * out),
      p(dx - n[0] * 0.7, dz - n[1] * 0.7),
      p(dx * 0.35 - n[0] * 1.5, dz * 0.35 - n[1] * 1.5),
    ];
  }, [door, opening]);

  const g = useRef<THREE.Group>(null!);
  const lidar = useRef<THREE.Mesh>(null!);
  const ring = useMemo(() => new THREE.MeshBasicMaterial({ color: ACCENT, toneMapped: false }), []);
  const state = useRef({ leg: 0, started: false });

  useFrame((_, rawDt) => {
    if (!route || !door) return;
    const dt = Math.min(rawDt, 1 / 30);
    const s = useApp.getState();
    const st = state.current;
    if (s.resetNonce !== (g.current.userData.nonce ?? 0)) {
      g.current.userData.nonce = s.resetNonce;
      st.leg = 0;
      st.started = false;
      g.current.position.copy(route[0]);
    }
    if (!st.started && (s.joints[door.id] ?? 0) > 0.5) st.started = true;
    lidar.current.rotation.y += dt * (st.started ? 6 : 1.5);
    ring.color.setRGB(0.78, 0.95, 0.42).multiplyScalar(st.started ? 1.6 + Math.sin(performance.now() / 120) * 0.4 : 0.6);
    if (!st.started || st.leg >= route.length - 1) return;
    const target = route[st.leg + 1];
    const pos = g.current.position;
    const to = target.clone().sub(pos);
    const dist = to.length();
    if (dist < 0.03) {
      st.leg++;
      return;
    }
    const heading = Math.atan2(to.x, to.z);
    const turn = Math.atan2(Math.sin(heading - g.current.rotation.y), Math.cos(heading - g.current.rotation.y));
    g.current.rotation.y += THREE.MathUtils.clamp(turn, -dt * 3, dt * 3);
    if (Math.abs(turn) < 0.3) pos.addScaledVector(to.normalize(), Math.min(dist, SPEED * dt * (dist < 0.4 ? 0.6 : 1)));
  });

  if (!route) return null;
  const body = material("plastic", "#e9e8e4");
  const dark = material("plastic", "#22252a");
  return (
    <group ref={g} position={route[0]}>
      <mesh position={[0, 0.09, 0]} material={body} castShadow receiveShadow>
        <cylinderGeometry args={[0.19, 0.2, 0.14, 48]} />
      </mesh>
      <mesh position={[0, 0.165, 0]} material={ring}>
        <cylinderGeometry args={[0.192, 0.192, 0.012, 48]} />
      </mesh>
      <mesh position={[0, 0.2, 0]} material={dark} castShadow>
        <cylinderGeometry args={[0.17, 0.18, 0.05, 48]} />
      </mesh>
      <mesh ref={lidar} position={[0, 0.255, -0.03]} material={dark} castShadow>
        <cylinderGeometry args={[0.05, 0.055, 0.06, 24]} />
      </mesh>
      <mesh position={[0, 0.12, 0.185]} material={dark}>
        <boxGeometry args={[0.12, 0.03, 0.02]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.17, 0.045, 0]} rotation={[0, 0, Math.PI / 2]} material={dark}>
          <cylinderGeometry args={[0.045, 0.045, 0.03, 24]} />
        </mesh>
      ))}
    </group>
  );
}
