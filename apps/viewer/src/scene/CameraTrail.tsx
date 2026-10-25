// The phone's path through the room, as recovered from the video, with a small
// camera frustum riding along it in sync with the footage.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { CameraKey } from "@doorway/schema";
import { useApp } from "../store";
import { ACCENT } from "./materials";
import { cameraAt, pathDuration, pathPoints } from "./cameraPath";

export function CameraTrail({ keys, autoplay }: { keys: CameraKey[]; autoplay: boolean }) {
  const points = useMemo(() => pathPoints(keys), [keys]);
  const phone = useRef<THREE.Group>(null!);
  const clock = useRef(0);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const frustum = useMemo(() => {
    // A little pyramid along +z: Object3D.lookAt points +z at the target.
    const w = 0.16, h = 0.1, d = 0.22;
    const tip = [0, 0, 0];
    const c = [[-w, -h, d], [w, -h, d], [w, h, d], [-w, h, d]];
    const seg: number[] = [];
    for (const p of c) seg.push(...tip, ...p);
    for (let i = 0; i < 4; i++) seg.push(...c[i], ...c[(i + 1) % 4]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
    return g;
  }, []);

  useFrame((_, dt) => {
    const end = pathDuration(keys);
    // Follow the video when one is playing, otherwise loop on our own.
    clock.current = autoplay ? (clock.current + dt) % end : useApp.getState().videoTime;
    cameraAt(keys, clock.current, pos, look);
    phone.current.position.copy(pos);
    phone.current.lookAt(look);
  });

  return (
    <group>
      <Line points={points} color={ACCENT} lineWidth={2} transparent opacity={0.85} toneMapped={false} />
      {keys.map((k, i) => (
        <mesh key={i} position={k.position}>
          <sphereGeometry args={[0.025, 12, 8]} />
          <meshBasicMaterial color={ACCENT} toneMapped={false} />
        </mesh>
      ))}
      <group ref={phone}>
        <lineSegments geometry={frustum}>
          <lineBasicMaterial color={ACCENT} toneMapped={false} />
        </lineSegments>
        <mesh position={[0, 0, -0.01]}>
          <boxGeometry args={[0.08, 0.15, 0.012]} />
          <meshBasicMaterial color="#111" />
        </mesh>
      </group>
    </group>
  );
}
