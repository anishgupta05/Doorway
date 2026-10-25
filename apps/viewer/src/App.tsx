import { useCallback, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { Stage } from "./Stage";
import { useCurrentScene, useRunData } from "./data/runs";
import { useHotkeys } from "./hotkeys";
import { useApp } from "./store";
import { TopBar } from "./ui/TopBar";
import { Caption, Legend } from "./ui/Caption";
import { CompareView } from "./views/CompareView";
import { ConvergencePanel } from "./views/ConvergencePanel";
import { BuildPanel } from "./views/BuildPanel";
import { ExportPanel } from "./views/ExportPanel";
import { WalkOverlay } from "./views/WalkOverlay";

export function App() {
  useRunData();
  const current = useCurrentScene();
  const { scene, prevScene, manifest, runId, k, issues } = current;
  const mode = useApp((s) => s.mode);
  const wipe = useApp((s) => s.wipe);
  const playing = useApp((s) => s.comparePlaying);
  const building = useApp((s) => s.buildCount !== null);
  const exportOpen = useApp((s) => s.exportOpen);

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
        <Stage scene={scene} prevScene={prevScene} />
      </div>
      <TopBar current={current} />
      {scene && <Caption scene={scene} manifest={manifest} />}
      <Legend />
      <AnimatePresence>
        {mode === "convergence" && manifest && runId && <ConvergencePanel key="conv" manifest={manifest} runId={runId} k={k} />}
        {building && scene && <BuildPanel key="build" scene={scene} />}
        {exportOpen && scene && <ExportPanel key="export" scene={scene} />}
      </AnimatePresence>
      {mode === "walk" && scene && <WalkOverlay scene={scene} />}
      {!scene && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="font-mono text-xs tracking-[0.2em] text-muted uppercase">Loading run…</div>
        </div>
      )}
    </div>
  );
}
