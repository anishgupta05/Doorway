// Places an object in the room and drives its articulation.
// Pose and size changes between iterations glide instead of popping, so switching
// versions shows the room correcting itself. Hinges use a slightly underdamped
// spring so doors swing with a small, physical-feeling overshoot.
import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Select } from "@react-three/postprocessing";
import * as THREE from "three";
import type { SceneObject } from "@doorway/schema";
import { useApp } from "../store";

/** Current articulation value (0..1) for children that animate themselves, e.g. lamps. */
const JointValue = createContext<{ current: number }>({ current: 0 });
export const useJointValue = () => useContext(JointValue);

export const defaultJoint = (obj: SceneObject) =>
  obj.articulation?.kind === "switch" && obj.articulation.initial ? 1 : 0;

const tmpAxis = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();

export function Placed({ obj, children }: { obj: SceneObject; children: ReactNode }) {
  const outer = useRef<THREE.Group>(null!);
  const pivot = useRef<THREE.Group>(null!);
  const value = useRef(defaultJoint(obj));
  const velocity = useRef(0);
  const scale = useRef(new THREE.Vector3(0.001, 0.001, 0.001));
  const prevSize = useRef(obj.size);
  const mounted = useRef(false);

  // When the size changes, rebuild at the new size but start scaled to the old one.
  useLayoutEffect(() => {
    const [a, b, c] = prevSize.current;
    const [x, y, z] = obj.size;
    if (mounted.current && (a !== x || b !== y || c !== z)) scale.current.set(a / x, b / y, c / z);
    prevSize.current = obj.size;
    mounted.current = true;
  }, [obj.size]);

  useLayoutEffect(() => {
    // Snap into place on first mount; later changes are damped in useFrame.
    outer.current.position.set(...obj.position);
    // During the build-in intro, objects drop into place from above.
    if (useApp.getState().buildStart !== null) outer.current.position.y += 0.7;
    outer.current.rotation.y = obj.rotationY;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hovered = useApp((s) => s.hovered === obj.id);
  const art = obj.articulation;
  const pv = art?.kind === "hinge" ? art.pivot : ([0, 0, 0] as const);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    const s = useApp.getState();
    const g = outer.current;

    const [px, pz] = s.pushes[obj.id] ?? [0, 0];
    const tx = obj.position[0] + px;
    const ty = obj.position[1];
    const tz = obj.position[2] + pz;
    g.position.x = THREE.MathUtils.damp(g.position.x, tx, 6, dt);
    g.position.y = THREE.MathUtils.damp(g.position.y, ty, 6, dt);
    g.position.z = THREE.MathUtils.damp(g.position.z, tz, 6, dt);
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, obj.rotationY, 6, dt);

    const sc = scale.current;
    sc.x = THREE.MathUtils.damp(sc.x, 1, 7, dt);
    sc.y = THREE.MathUtils.damp(sc.y, 1, 7, dt);
    sc.z = THREE.MathUtils.damp(sc.z, 1, 7, dt);
    g.scale.copy(sc);

    if (!art || art.kind === "free") return;
    const target = s.joints[obj.id] ?? defaultJoint(obj);
    if (art.kind === "switch") {
      value.current = THREE.MathUtils.damp(value.current, target, 10, dt);
      return;
    }
    // Underdamped spring: k=55, c=10 → ~8% overshoot.
    const a = (target - value.current) * 55 - velocity.current * 10;
    velocity.current += a * dt;
    value.current += velocity.current * dt;

    const p = pivot.current;
    const [lo, hi] = art.range;
    const amount = lo + (hi - lo) * value.current;
    tmpAxis.set(...art.axis).normalize();
    if (art.kind === "hinge") {
      p.quaternion.copy(tmpQuat.setFromAxisAngle(tmpAxis, amount));
    } else {
      p.position.set(pv[0], pv[1], pv[2]).addScaledVector(tmpAxis, amount);
    }
  });

  return (
    <group ref={outer} userData={{ objectId: obj.id }}>
      <group ref={pivot} position={pv as unknown as THREE.Vector3Tuple}>
        <group position={[-pv[0], -pv[1], -pv[2]]}>
          <Select enabled={hovered}>
            <JointValue.Provider value={value}>{children}</JointValue.Provider>
          </Select>
        </group>
      </group>
    </group>
  );
}
