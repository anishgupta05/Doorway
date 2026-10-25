import { Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor, Stats as FpsStats } from "@react-three/drei";
import { Selection } from "@react-three/postprocessing";
import * as THREE from "three";
import type { Scene } from "@doorway/schema";
import { SceneView } from "./scene/SceneView";
import { Effects, Lighting } from "./scene/Lighting";
import { CompareRig, OverviewRig } from "./scene/Rigs";
import { CameraTrail } from "./scene/CameraTrail";
import { DiffGhosts } from "./scene/DiffGhosts";
import { TestViz } from "./scene/TestViz";
import { Robot } from "./scene/Robot";
import { Walk } from "./controls/Walk";
import { useApp } from "./store";

export function Stage({ scene, prevScene }: { scene: Scene | null; prevScene: Scene | null }) {
  const mode = useApp((s) => s.mode);
  const tests = useApp((s) => s.tests);
  const building = useApp((s) => s.buildCount !== null);
  const preview = useApp((s) => s.preview !== null);
  const renderMode = useApp((s) => s.renderMode);
  const outside = mode === "overview" || mode === "convergence";
  // Start high; PerformanceMonitor drops to "low" (1x pixels, cheaper AO) if the frame rate sags.
  const [quality, setQuality] = useState<"high" | "low">("high");
  // Debug knobs: ?perf shows an FPS meter, ?dpr=1 forces pixel ratio, ?off=fx,shadows turns features off (see Effects for pass names).
  const qs = new URLSearchParams(location.search);
  const showFps = qs.has("perf");
  const forcedDpr = Number(qs.get("dpr")) || null;
  return (
    <Canvas
      shadows={qs.get("off")?.includes("shadows") ? false : "percentage"}
      dpr={forcedDpr ?? (quality === "high" ? [1, 1.5] : 1)}
      gl={{ antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: true }}
      camera={{ fov: 42, near: 0.05, far: 80, position: [9, 8, 10] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NoToneMapping; // ACES is applied in the post stack
      }}
    >
      <PerformanceMonitor flipflops={2} onDecline={() => setQuality("low")} onFallback={() => setQuality("low")} />
      {showFps && <FpsStats />}
      <color attach="background" args={["#0b0c0e"]} />
      <fog attach="fog" args={["#0b0c0e", 18, 40]} />
      {scene && (
        <Suspense fallback={null}>
          <Lighting room={scene.room} />
          <Selection>
            <SceneView scene={scene} cutaway={outside} />
            <Effects quality={quality} />
          </Selection>
          {mode === "overview" && !tests && !renderMode && <CameraTrail keys={scene.camera_path} autoplay />}
          {mode === "convergence" && prevScene && !building && !preview && <DiffGhosts prev={prevScene} scene={scene} />}
          {tests && <TestViz scene={scene} />}
          {mode === "walk" && <Robot scene={scene} />}
          {outside && <OverviewRig room={scene.room} />}
          {mode === "compare" && <CompareRig scene={scene} />}
          {mode === "walk" && <Walk scene={scene} />}
        </Suspense>
      )}
    </Canvas>
  );
}
