// Real furniture for the types we have a model for (CC0 Poly Haven, served from /models).
// Argon still only supplies a type and a bounding box; the model is scaled into that box and
// everything else (articulation, hover outline, pushing) works on the wrapper as before.
// Anything without a model, or a model that fails to load, falls back to the procedural builders.
import { Component, useMemo, type ReactNode } from "react";
import { useGLTF, useProgress } from "@react-three/drei";
import * as THREE from "three";
import type { SceneObject } from "@doorway/schema";
import { hashSeed } from "./materials";

/**
 * Off by default: the models carry their own style and textures, so they override the colour,
 * material and shape Argon described (a baroque armchair for a plain one). The procedural
 * builders follow the scene, so they are the default; `?models=1` opts in for comparison.
 */
export const USE_MODELS = new URLSearchParams(location.search).get("models") === "1";

const CHAIRS = ["ArmChair_01", "SchoolChair_01"];
const MODELS: Partial<Record<SceneObject["type"], string>> = {
  table: "WoodenTable_01",
  sofa: "sofa_02",
  shelf: "wooden_bookshelf_worn",
  cabinet: "modern_wooden_cabinet",
  plant: "calathea_orbifolia_01",
};
// Lamps stay procedural: they own the switchable light. Doors, drawers, rugs and monitors stay procedural for their hinges and screens.

export function modelFor(o: SceneObject): string | null {
  if (!USE_MODELS) return null;
  if (o.type === "chair") return CHAIRS[hashSeed(o.id) % CHAIRS.length];
  if (o.type === "table" && (o.size[1] < 0.6 || o.size[0] < 0.7)) return "side_table_01";
  return MODELS[o.type] ?? null;
}

const url = (name: string) => `/models/${name}/${name}.gltf`;
const ALL = [...Object.values(MODELS), ...CHAIRS, "side_table_01"] as string[];
// Start loading everything at startup so scenes never pop in or stall the render-mode screenshots.
if (USE_MODELS) ALL.forEach((n) => useGLTF.preload(url(n), false));

/** Resolves when no model is still loading (render mode waits on this before it says "ready"). */
export function modelsIdle(timeoutMs = 30000): Promise<void> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const check = () => (!useProgress.getState().active || performance.now() - t0 > timeoutMs ? resolve() : setTimeout(check, 100));
    check();
  });
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function ModelBody({ name, obj, fallback }: { name: string; obj: SceneObject; fallback: ReactNode }) {
  return (
    <Boundary fallback={fallback}>
      <Glb name={name} obj={obj} />
    </Boundary>
  );
}

function Glb({ name, obj }: { name: string; obj: SceneObject }) {
  const gltf = useGLTF(url(name), false);
  const [w, h, d] = obj.size;
  const { model, scale } = useMemo(() => {
    const model = gltf.scene.clone(true);
    model.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.isMesh) m.castShadow = m.receiveShadow = true;
    });
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    model.position.set(-c.x, -box.min.y, -c.z); // base centre at the origin, like every other builder
    // Match the described height, unless that makes it much wider or deeper than described.
    const kh = h / size.y;
    const kfit = Math.min(w / size.x, h / size.y, d / size.z);
    const k = obj.type === "plant" || size.x * kh > w * 1.25 || size.z * kh > d * 1.25 ? kfit : kh;
    return { model, scale: k };
  }, [gltf, w, h, d, obj.type]);
  return (
    <group scale={scale}>
      <primitive object={model} />
    </group>
  );
}
