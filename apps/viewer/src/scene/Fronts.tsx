// The moving parts of furniture that doesn't move as a whole:
//   hinged cabinets, wardrobes, lockers → front door leaves that swing out
//   things that "slide" (a cabinet with drawers) → a drawer front that pulls out
//   switchable devices (copiers, screens) → a status light and a soft glow
// All are driven by the object's joint value (0 closed/off → 1 open/on) from Placed.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { SceneObject } from "@doorway/schema";
import { material } from "./materials";
import { useJointValue, wholeBodyJoint } from "./Placed";

const LEAF_MAX = 0.6; // metres per door leaf
const OPEN_ANGLE = (100 * Math.PI) / 180;

export function Fronts({ obj }: { obj: SceneObject }) {
  const a = obj.articulation;
  if (!a || wholeBodyJoint(obj) || obj.decor) return null;
  if (a.kind === "hinge") return <Leaves obj={obj} />;
  if (a.kind === "slide") return <DrawerFront obj={obj} travel={Math.max(...a.range.map(Math.abs), 0.25)} />;
  if (a.kind === "switch" && obj.type !== "lamp") return <StatusLight obj={obj} />;
  return null;
}

function frontColor(obj: SceneObject) {
  return `#${new THREE.Color(obj.color ?? "#e3e1dc").offsetHSL(0, 0, 0.03).getHexString()}`;
}

/** One leaf per ~60 cm of width; leaves hinge on their outer edges and swing out in pairs. */
function Leaves({ obj }: { obj: SceneObject }) {
  const [w, h, d] = obj.size;
  const n = Math.max(1, Math.ceil(w / LEAF_MAX));
  const leaf = w / n;
  // Low cabinets (counters) keep a plinth and a top; tall ones nearly fill their front.
  const bottom = h < 1.2 ? 0.08 : 0.04;
  const top = h < 1.2 ? 0.05 : 0.04;
  const lh = Math.max(0.1, h - bottom - top);
  const mat = material(obj.material ?? "paint", frontColor(obj));
  const value = useJointValue();
  const hinges = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    hinges.current.forEach((g, i) => {
      if (!g) return;
      const hingeLeft = n === 1 || i % 2 === 0;
      g.rotation.y = (hingeLeft ? -1 : 1) * OPEN_ANGLE * Math.max(0, Math.min(1.08, value.current));
    });
  });
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const hingeLeft = n === 1 || i % 2 === 0;
        const x0 = -w / 2 + i * leaf;
        const hx = hingeLeft ? x0 : x0 + leaf;
        const dir = hingeLeft ? 1 : -1;
        return (
          <group key={i} ref={(g) => void (hinges.current[i] = g)} position={[hx, bottom, d / 2 + 0.002]}>
            <RoundedBox
              args={[leaf - 0.008, lh, 0.02]}
              radius={0.004}
              smoothness={2}
              position={[(dir * leaf) / 2, lh / 2, 0.01]}
              material={mat}
              castShadow
              receiveShadow
            />
            <mesh position={[dir * (leaf - 0.06), lh * (h < 1.2 ? 0.8 : 0.5), 0.032]} material={material("metal", "#2b2b2b")} castShadow>
              <boxGeometry args={[0.014, Math.min(0.16, lh * 0.25), 0.018]} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

/** The top section of the front pulls out along +z, with a tray behind it. */
function DrawerFront({ obj, travel }: { obj: SceneObject; travel: number }) {
  const [w, h, d] = obj.size;
  const fh = Math.min(0.22, h * 0.25);
  const y = h - fh / 2 - 0.03;
  const depth = Math.min(d - 0.04, travel + 0.08);
  const value = useJointValue();
  const g = useRef<THREE.Group>(null!);
  useFrame(() => void (g.current.position.z = d / 2 + travel * Math.max(0, Math.min(1, value.current))));
  const mat = material(obj.material ?? "paint", frontColor(obj));
  const inner = material("paint", "#d9d6cf");
  return (
    <group ref={g} position={[0, 0, d / 2]}>
      <RoundedBox args={[w - 0.03, fh - 0.01, 0.02]} radius={0.004} smoothness={2} position={[0, y, 0.01]} material={mat} castShadow receiveShadow />
      <mesh position={[0, y + fh * 0.15, 0.03]} material={material("metal", "#2b2b2b")}>
        <boxGeometry args={[Math.min(0.2, w * 0.3), 0.016, 0.018]} />
      </mesh>
      <mesh position={[0, y - fh / 2 + 0.02, -depth / 2]} material={inner} castShadow receiveShadow>
        <boxGeometry args={[w - 0.06, 0.012, depth]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * (w - 0.07)) / 2, y - 0.01, -depth / 2]} material={inner}>
          <boxGeometry args={[0.012, fh - 0.04, depth]} />
        </mesh>
      ))}
    </group>
  );
}

/** A green LED and a faint panel glow when on. */
function StatusLight({ obj }: { obj: SceneObject }) {
  const [w, h, d] = obj.size;
  const value = useJointValue();
  const led = useMemo(() => new THREE.MeshStandardMaterial({ color: "#1b1f1b", emissive: new THREE.Color("#7dff8a"), emissiveIntensity: 0, toneMapped: false }), []);
  const panel = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#20303a", emissive: new THREE.Color("#9fd4ff"), emissiveIntensity: 0, roughness: 0.3 }),
    [],
  );
  useFrame(() => {
    const v = Math.max(0, Math.min(1, value.current));
    led.emissiveIntensity = 0.1 + v * 6;
    panel.emissiveIntensity = v * 0.9;
  });
  const top = Math.min(h - 0.03, h * 0.9);
  return (
    <group position={[0, 0, d / 2 + 0.004]}>
      <mesh position={[w / 2 - 0.05, top, 0]} material={led}>
        <sphereGeometry args={[0.012, 12, 8]} />
      </mesh>
      <mesh position={[w / 2 - 0.14, top - 0.01, 0]} material={panel}>
        <planeGeometry args={[Math.min(0.12, w * 0.3), 0.06]} />
      </mesh>
    </group>
  );
}
