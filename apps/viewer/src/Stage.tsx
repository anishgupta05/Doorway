import { Suspense, useState } from "react";
import { roundName } from "./ui/plain";
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
import { Walk } from "./controls/Walk";
import { IssueMarkers } from "./scene/IssueMarkers";
import { Html } from "@react-three/drei";
import type { Issue } from "@doorway/schema";
import { useApp } from "./store";
import { RobotSim } from "./robot/RobotSim";
import { MissionSim } from "./robot/MissionSim";
import type { Mission } from "./robot/mission";
import type { Vec2 } from "./robot/planner";
import { ROBOT } from "./features";
import { MissionSim } from "./robot/MissionSim";
import type { Mission } from "./robot/mission";
import type { Vec2 } from "./robot/planner";
import type { useRobotTask } from "./robot/useRobotTask";
import { sfx } from "./sfx";

export type SplitPair = { before: Scene; after: Scene; beforeScore?: number; afterScore?: number; iterations: number };

export function Stage({
  scene,
  prevScene,
  issues = [],
  fixed = [],
  k = null,
  split = null,
  robot = null,
  mission = null,
}: {
  scene: Scene | null;
  prevScene: Scene | null;
  issues?: Issue[];
  fixed?: Issue[];
  k?: number | null;
  split?: SplitPair | null;
  robot?: ReturnType<typeof useRobotTask> | null;
  mission?: { mission: Mission; start: Vec2; runKey: string | null } | null;
}) {
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
  const splitOn = useApp((s) => s.split) && !!split && mode === "overview";
  const compareOn = ROBOT && !!robot?.sim && !!robot.task && mode === "overview" && !splitOn;
  // Either robot view hides the camera trail and issue markers, so the robot's work is clear.
  const robotOn = compareOn || (ROBOT && !!mission && mode === "overview");
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
          <Lighting room={scene.room} wide={splitOn} />
          <Selection>
            {splitOn ? <SplitRooms pair={split!} /> : <SceneView scene={scene} cutaway={outside} />}
            <Effects quality={quality} />
          </Selection>
          {mode === "overview" && !tests && !renderMode && !splitOn && !building && !robotOn && <CameraTrail keys={scene.camera_path} autoplay />}
          {/* Always mounted (see IssueMarkers); emptied when the current view shouldn't show it. */}
          {!renderMode && (() => {
            const show = (mode === "compare" || (mode === "overview" && !tests && !building && !robotOn)) && !splitOn;
            return <IssueMarkers scene={scene} issues={show ? issues : []} fixed={show ? fixed : []} k={k} />;
          })()}
          {mode === "convergence" && prevScene && !building && !preview && <DiffGhosts prev={prevScene} scene={scene} />}
          {tests && <TestViz scene={scene} />}
          {mission && mode === "overview" && !splitOn && <MissionSim mission={mission.mission} start={mission.start} runKey={mission.runKey} />}
          {compareOn && (
            <RobotSim
              grid={robot!.sim!.grid}
              start={robot!.task!.start}
              goal={robot!.task!.goal}
              run={robot!.sim!.run}
              collision={robot!.sim!.collision}
              onDone={(key) => {
                useApp.setState((s) => ({ robotDone: { ...s.robotDone, [key]: true } }));
                if (robot!.step === 2 && robot!.plans?.hit) sfx.reject();
                else sfx.pass();
              }}
            />
          )}
          {outside && <OverviewRig room={scene.room} wide={splitOn} />}
          {mode === "compare" && <CompareRig scene={scene} />}
          {mode === "walk" && <Walk scene={scene} />}
        </Suspense>
      )}
    </Canvas>
  );
}

/** v0 next to the final room, each labelled with its match score. */
function SplitRooms({ pair }: { pair: SplitPair }) {
  const off = pair.after.room.width / 2 + 0.95;
  const label = (title: string, score: number | undefined, good: boolean) => (
    <div className="pointer-events-none rounded-xl border border-line bg-ink/85 px-4 py-2 text-center whitespace-nowrap shadow-xl backdrop-blur">
      <div className="text-[15px] font-semibold tracking-tight">{title}</div>
      {score !== undefined && (
        <div className={`text-[12px] tabular ${good ? "text-accent" : "text-bad"}`}>{Math.round(score * 100)}% match</div>
      )}
    </div>
  );
  return (
    <>
      {/* The camera looks from the north (-z), so +x is screen-left: v0 goes there. */}
      <group position={[off, 0, 0]}>
        <SceneView scene={pair.before} cutaway />
        <Html position={[0, pair.before.room.height + 0.9, 0]} center zIndexRange={[20, 0]}>
          {label(roundName(0), pair.beforeScore, false)}
        </Html>
      </group>
      <group position={[-off, 0, 0]}>
        <SceneView scene={pair.after} cutaway />
        <Html position={[0, pair.after.room.height + 0.9, 0]} center zIndexRange={[20, 0]}>
          {label(roundName(pair.iterations), pair.afterScore, true)}
        </Html>
      </group>
    </>
  );
}
