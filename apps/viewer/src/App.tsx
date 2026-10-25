import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Stage, type SplitPair } from "./Stage";
import { useRobotTask } from "./robot/useRobotTask";
import { RobotPanel } from "./robot/RobotPanel";
import { ROBOT } from "./features";
import { MissionPanel } from "./robot/MissionPanel";
import { actionsFor } from "./robot/actions";
import { planMission } from "./robot/mission";
import { startPoint } from "./robot/tasks";
import { loadScene, useCurrentScene, useRunData } from "./data/runs";
import { useHotkeys } from "./hotkeys";
import { useApp } from "./store";
import { TopBar } from "./ui/TopBar";
import { Caption, Legend, Tip } from "./ui/Caption";
import { CompareView } from "./views/CompareView";
import { ConvergencePanel } from "./views/ConvergencePanel";
import { BuildPanel } from "./views/BuildPanel";
import { ExportPanel } from "./views/ExportPanel";
import { WalkOverlay } from "./views/WalkOverlay";
import { UploadPanel } from "./views/UploadPanel";
import { RoomsPanel } from "./views/RoomsPanel";
import { BuildProgress } from "./views/BuildProgress";
import { EmptyState } from "./ui/EmptyState";
import { ViewControls } from "./ui/ViewControls";

export function App() {
  useRunData();
  const current = useCurrentScene();
  const { scene, prevScene, manifest, runId, k, issues, fixed } = current;
  const split = useSplitPair(runId, manifest);
  const robotOpen = useApp((s) => s.robotOpen);
  const robot = useRobotTask(split?.before ?? null, split?.after ?? null);
  const robotTab = useApp((s) => s.robotTab);
  const queue = useApp((s) => s.missionQueue);
  const missionRun = useApp((s) => s.mission);
  // Missions run in the room on stage: every door, locker and switch in it is something to do.
  const actions = useMemo(() => (scene ? actionsFor(scene) : []), [scene]);
  const mission = useMemo(() => {
    if (!scene) return null;
    const byId = new Map(actions.map((a) => [a.id, a]));
    const steps = queue.map((id) => byId.get(id)).filter((a): a is NonNullable<typeof a> => !!a);
    return planMission(scene, steps, startPoint(scene));
  }, [scene, actions, queue]);
  // Stable, so re-renders (e.g. status updates) don't restart a running job.
  const missionStart = useMemo(() => (scene ? startPoint(scene) : null), [scene]);
  const mode = useApp((s) => s.mode);
  const wipe = useApp((s) => s.wipe);
  const playing = useApp((s) => s.comparePlaying);
  const building = useApp((s) => s.buildCount !== null);
  const exportOpen = useApp((s) => s.exportOpen);
  const uploadOpen = useApp((s) => s.uploadOpen);
  const roomsOpen = useApp((s) => s.roomsOpen);
  const building2 = useApp((s) => s.building);
  const loadError = useApp((s) => s.loadError);

  const stepIter = useCallback(
    (d: number) => {
      const n = manifest?.iterations.length ?? 0;
      if (!n || k === null) return;
      useApp.getState().setIter(Math.max(0, Math.min(n - 1, k + d)));
    },
    [manifest, k],
  );
  const togglePlay = useCallback(() => {
    const s = useApp.getState();
    if (s.mode === "compare") useApp.setState({ comparePlaying: !s.comparePlaying });
    else if (s.mode === "convergence") useApp.setState({ convergencePlay: Date.now() });
  }, []);
  useHotkeys(useMemo(() => ({ stepIter, togglePlay }), [stepIter, togglePlay]));

  return (
    <div className="relative isolate h-full w-full">
      {mode === "compare" && scene && <CompareView scene={scene} manifest={manifest} runId={runId} k={k} issues={issues} playing={playing} />}
      <div className="absolute inset-0" style={mode === "compare" ? { clipPath: `inset(0 0 0 ${wipe * 100}%)` } : undefined}>
        <Stage scene={scene} prevScene={prevScene} issues={issues} fixed={fixed} k={k} split={split} robot={ROBOT && robotOpen && robotTab === "compare" ? robot : null}
          mission={ROBOT && robotOpen && robotTab === "mission" && mission && missionStart ? { mission, start: missionStart, runKey: missionRun?.key ?? null } : null}
        />
      </div>
      <TopBar current={current} />
      {scene && <Caption scene={scene} manifest={manifest} />}
      <ViewControls />
      <Legend />
      <AnimatePresence>
        {mode === "convergence" && manifest && runId && <ConvergencePanel key="conv" manifest={manifest} runId={runId} k={k} />}
        {building && scene && <BuildPanel key="build" scene={scene} />}
        {exportOpen && scene && <ExportPanel key="export" scene={scene} />}
        {ROBOT && robotOpen && mode === "overview" && robotTab === "compare" && <RobotPanel key="robot" t={robot} />}
        {ROBOT && robotOpen && mode === "overview" && robotTab === "mission" && scene && <MissionPanel key="mission" scene={scene} actions={actions} mission={mission} />}
        {uploadOpen && <UploadPanel key="upload" />}
        {roomsOpen && <RoomsPanel key="rooms" />}
        {building2 && <BuildProgress key="progress" building={building2} />}
      </AnimatePresence>
      {mode === "walk" && scene && <WalkOverlay scene={scene} />}
      {!scene && (loadError ? <EmptyState /> : (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-sm text-muted">Opening your room…</div>
        </div>
      ))}
      {scene && <Tip />}
    </div>
  );
}

/** v0 and the final iteration of the current run, for the before/after view. */
function useSplitPair(runId: string | null, manifest: ReturnType<typeof useCurrentScene>["manifest"]): SplitPair | null {
  const [pair, setPair] = useState<SplitPair | null>(null);
  useEffect(() => {
    const its = manifest?.iterations;
    if (!runId || !its || its.length < 2) return setPair(null);
    const first = its[0].branches[its[0].selected];
    const last = its[its.length - 1].branches[its[its.length - 1].selected];
    let live = true;
    Promise.all([loadScene(runId, first.scene), loadScene(runId, last.scene)]).then(
      ([before, after]) => live && setPair({ before, after, beforeScore: first.score, afterScore: last.score, iterations: its.length - 1 }),
      () => live && setPair(null),
    );
    return () => void (live = false);
  }, [runId, manifest]);
  return pair;
}
