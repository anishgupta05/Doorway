// A box part with a generated surface image on one face (keyboard, logo, label...). The other faces use
// the part's plain material. If the image is missing or fails to load, the plain box is drawn instead.
import { Component, type ReactNode } from "react";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { Part } from "@doorway/schema";

type V3 = [number, number, number];
const FACE: Record<NonNullable<Part["textureFace"]>, number> = { right: 0, left: 1, top: 2, front: 4, back: 5 }; // BoxGeometry face order

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Face({ part, plain }: { part: Part; plain: THREE.Material }) {
  const tex = useTexture(`/runs/${part.texture}`);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const [w, h, d] = part.size;
  const face = FACE[part.textureFace ?? (h < 0.35 * Math.min(w, d) ? "top" : "front")];
  const textured = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.1 });
  const mats = Array.from({ length: 6 }, (_, i) => (i === face ? textured : plain));
  return (
    <mesh position={part.offset} material={mats} castShadow receiveShadow>
      <boxGeometry args={part.size as V3} />
    </mesh>
  );
}

export function TexturedPart({ part, plain }: { part: Part; plain: THREE.Material }) {
  const fallback = (
    <mesh position={part.offset} material={plain} castShadow receiveShadow>
      <boxGeometry args={part.size as V3} />
    </mesh>
  );
  return (
    <Boundary fallback={fallback}>
      <Face part={part} plain={plain} />
    </Boundary>
  );
}
