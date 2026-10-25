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

const DAY = { sun: 3.4, hemi: 0.8, env: 0.75, sunColor: new THREE.Color("#fff0d8"), hemiColor: new THREE.Color("#fff7ec") };
const NIGHT = { sun: 0.25, hemi: 0.07, env: 0.06, sunColor: new THREE.Color("#9fb6ff"), hemiColor: new THREE.Color("#8ea2d8") };

export function Lighting({ room, wide = false }: { room: Room; wide?: boolean }) {
  const sun = useRef<THREE.DirectionalLight>(null!);
  const hemi = useRef<THREE.HemisphereLight>(null!);
  const win = room.openings.find((o) => o.kind === "window");
  // Sun comes from outside the first window's wall, high and slightly to the side.
  const dir = win?.wall === "south" ? [0.35, 1, 1] : win?.wall === "east" ? [1, 1, 0.35] : win?.wall === "west" ? [-1, 1, 0.35] : [-0.35, 1, -1];
  const sunPos = new THREE.Vector3(...(dir as [number, number, number])).normalize().multiplyScalar(9);

  // Side-by-side rooms need a wider shadow frustum.
  useLayoutEffect(() => {
    const c = sun.current.shadow.camera;
    const e = wide ? 10 : 5;
    c.left = -e;
    c.right = e;
    c.top = e;
    c.bottom = -e;
    c.updateProjectionMatrix();
  }, [wide]);

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
      <hemisphereLight ref={hemi} args={["#fff7ec", "#c9bba6", 0.8]} />
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
      {/* frames={1}: the light formers never change, so bake the cube map once instead of every frame */}
      <Environment frames={1} resolution={256} environmentIntensity={0.75}>
        <Lightformer form="rect" intensity={2.2} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[8, 8, 1]} color="#fff6ea" />
        <Lightformer form="rect" intensity={1.6} position={[0, 2, -6]} scale={[10, 3, 1]} color="#eaf2ff" />
        <Lightformer form="rect" intensity={0.8} position={[6, 2, 0]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} color="#ffe2c4" />
        <Lightformer form="rect" intensity={0.5} position={[-6, 2, 2]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} color="#ffffff" />
      </Environment>
    </>
  );
}

/** `?off=fx` drops the whole stack; `?off=ao,outline,bloom,smaa` drops single passes (for finding what costs frames). */
const OFF = new Set((new URLSearchParams(location.search).get("off") ?? "").split(","));

export function Effects({ quality = "high" }: { quality?: "high" | "low" }) {
  if (OFF.has("fx")) return null;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false} autoClear={false}>
      {!OFF.has("ao") && <N8AO aoRadius={0.45} intensity={quality === "high" ? 2.4 : 1.6} distanceFalloff={0.6} halfRes={quality !== "high"} quality={quality === "high" ? "high" : "low"} />}
      {!OFF.has("outline") && <Outline visibleEdgeColor={0xc6f36b} hiddenEdgeColor={0x5d7a2a} edgeStrength={4} blur width={1200} />}
      {!OFF.has("bloom") && <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.2} intensity={0.75} radius={0.7} />}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.3} darkness={0.45} />
      {!OFF.has("smaa") && <SMAA />}
    </EffectComposer>
  );
}
