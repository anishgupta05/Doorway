// Soft studio fill from procedural light formers (no HDRI download, works offline),
// plus one warm sun through the window that casts the room's signature light patch.
import { useLayoutEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { Bloom, EffectComposer, N8AO, Outline, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import type { Room } from "@doorway/schema";
import { useApp } from "../store";
import { SHADOW_ONLY_LAYER } from "./Room";

const DAY = { sun: 3.2, hemi: 0.55, env: 0.55, sunColor: new THREE.Color("#fff0d8"), hemiColor: new THREE.Color("#fff7ec") };
const NIGHT = { sun: 0.25, hemi: 0.07, env: 0.06, sunColor: new THREE.Color("#9fb6ff"), hemiColor: new THREE.Color("#8ea2d8") };

export function Lighting({ room }: { room: Room }) {
  const sun = useRef<THREE.DirectionalLight>(null!);
  const hemi = useRef<THREE.HemisphereLight>(null!);
  const win = room.openings.find((o) => o.kind === "window");
  // Sun comes from outside the first window's wall, high and slightly to the side.
  const dir = win?.wall === "south" ? [0.35, 1, 1] : win?.wall === "east" ? [1, 1, 0.35] : win?.wall === "west" ? [-1, 1, 0.35] : [-0.35, 1, -1];
  const sunPos = new THREE.Vector3(...(dir as [number, number, number])).normalize().multiplyScalar(9);

  useLayoutEffect(() => {
    const s = sun.current;
    s.shadow.camera.layers.enable(SHADOW_ONLY_LAYER);
    s.target.position.set(0, 0, 0);
    s.target.updateMatrixWorld();
  }, []);

  // Night mode: everything eases toward moonlight so the lamp carries the room.
  useFrame(({ scene }, dt) => {
    const k = useApp.getState().night ? NIGHT : DAY;
    const l = 1 - Math.exp(-3 * Math.min(dt, 1 / 30));
    sun.current.intensity += (k.sun - sun.current.intensity) * l;
    sun.current.color.lerp(k.sunColor, l);
    hemi.current.intensity += (k.hemi - hemi.current.intensity) * l;
    hemi.current.color.lerp(k.hemiColor, l);
    scene.environmentIntensity += (k.env - scene.environmentIntensity) * l;
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={["#fff7ec", "#4a4036", 0.55]} />
      <directionalLight
        ref={sun}
        position={sunPos}
        intensity={3.2}
        color="#fff0d8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.025}
        shadow-radius={6}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-camera-near={1}
        shadow-camera-far={25}
      />
      <Environment resolution={256} environmentIntensity={0.55}>
        <Lightformer form="rect" intensity={2.2} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[8, 8, 1]} color="#fff6ea" />
        <Lightformer form="rect" intensity={1.6} position={[0, 2, -6]} scale={[10, 3, 1]} color="#eaf2ff" />
        <Lightformer form="rect" intensity={0.8} position={[6, 2, 0]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} color="#ffe2c4" />
        <Lightformer form="rect" intensity={0.5} position={[-6, 2, 2]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} color="#ffffff" />
      </Environment>
    </>
  );
}

export function Effects({ quality = "high" }: { quality?: "high" | "low" }) {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <N8AO aoRadius={0.45} intensity={quality === "high" ? 2.4 : 1.6} distanceFalloff={0.6} halfRes={quality !== "high"} quality={quality === "high" ? "high" : "low"} />
      <Outline visibleEdgeColor={0xc6f36b} hiddenEdgeColor={0x5d7a2a} edgeStrength={4} blur width={1200} />
      <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.2} intensity={0.75} radius={0.7} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.3} darkness={0.45} />
      <SMAA />
    </EffectComposer>
  );
}
