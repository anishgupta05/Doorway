// Big presenter captions per beat, a stats strip, and the hotkey legend.
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { RunManifest, Scene } from "@doorway/schema";
import { useApp } from "../store";
import { KEYS } from "../hotkeys";
import { pathDuration } from "../scene/cameraPath";

const ATTRACT = [
  ["A phone video in.", "A working simulation out."],
  ["Doors open. Drawers slide. Lights switch.", "Every object knows what it is."],
  ["Checked against reality", "and corrected until it matches."],
  ["Ready for the robot.", "Exports straight to MuJoCo."],
];

export function Caption({ scene, manifest }: { scene: Scene; manifest: RunManifest | undefined }) {
  const mode = useApp((s) => s.mode);
  const tests = useApp((s) => s.tests);
  const building = useApp((s) => s.buildCount !== null);
  const idle = useApp((s) => s.idle);
  const night = useApp((s) => s.night);
  const split = useApp((s) => s.split);
  const [attract, setAttract] = useState(0);

  useEffect(() => {
    if (!idle) return;
    const t = setInterval(() => setAttract((a) => (a + 1) % ATTRACT.length), 4500);
    return () => clearInterval(t);
  }, [idle]);

  const joints = scene.objects.filter((o) => o.articulation && o.articulation.kind !== "free").length;
  const secs = Math.round(pathDuration(scene.camera_path));
  let title: string;
  let sub: string;
  if (building) [title, sub] = ["Generated as code, in one pass", `Argon watched ${secs} s of video and wrote the whole room: geometry, joints, lights.`];
  else if (tests) [title, sub] = ["Behaves right, not just looks right", "Every declared interaction is exercised and checked."];
  else if (split && mode === "overview") [title, sub] = ["One pass vs. verified", "Same video. Left: Argon's first pass. Right: after the loop's parallel fixes and guards."];
  else if (mode === "compare") [title, sub] = ["Reality vs. reconstruction", "Same camera path as the phone. Drag the divider."];
  else if (idle && mode === "overview") [title, sub] = ATTRACT[attract];
  else [title, sub] = [`A sim-ready room from ${secs} s of video`, `${scene.objects.length} objects · ${joints} working joints${night ? " · night" : ""}`];

  if (mode === "walk" || mode === "convergence") return null;
  return (
    <div className={`pointer-events-none absolute z-10 max-w-3xl ${building ? "bottom-16 left-[440px]" : "bottom-16 left-6"}`}>
      <AnimatePresence mode="wait">
        <motion.div key={title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.45 }}>
          <div className="text-[34px] leading-[1.08] font-semibold tracking-[-0.02em] text-fg [text-shadow:0_2px_24px_rgba(0,0,0,0.6)]">{title}</div>
          <div className="mt-2 text-[15px] text-muted [text-shadow:0_1px_12px_rgba(0,0,0,0.8)]">{sub}</div>
        </motion.div>
      </AnimatePresence>
      {mode === "overview" && !building && !tests && !split && <Stats scene={scene} manifest={manifest} />}
    </div>
  );
}

function Stats({ scene, manifest }: { scene: Scene; manifest: RunManifest | undefined }) {
  const iterations = manifest?.iterations ?? [];
  const branches = iterations.reduce((n, it) => n + (it.k === 0 ? 0 : it.branches.length), 0);
  const rejected = iterations.reduce((n, it) => n + it.branches.filter((b) => b.verdict === "fail").length, 0);
  const tests = scene.objects.filter((o) => o.articulation).length;
  const items: [string | number, string][] = [
    [`${Math.round(pathDuration(scene.camera_path))}s`, "video"],
    [scene.objects.length, "objects"],
    [Math.max(iterations.length - 1, 0), "iterations"],
    [branches, "branches"],
    [rejected, "rejected"],
    [`${tests}/${tests}`, "tests pass"],
  ];
  return (
    <div className="mt-5 flex gap-5">
      {items.map(([n, l]) => (
        <div key={l}>
          <div className="font-mono text-[17px] leading-none text-fg tabular">{n}</div>
          <div className="mt-1 font-mono text-[9.5px] tracking-[0.16em] text-muted uppercase">{l}</div>
        </div>
      ))}
    </div>
  );
}

export function Legend() {
  const mode = useApp((s) => s.mode);
  if (mode === "walk" || mode === "compare") return null;
  return (
    <div className="pointer-events-none absolute right-5 bottom-5 z-10 flex gap-3 font-mono text-[10px] text-dim">
      {KEYS.map((k) => (
        <span key={k.key}>
          <kbd className="mr-1 rounded border border-line bg-panel/70 px-1 text-muted">{k.key}</kbd>
          {k.label}
        </span>
      ))}
    </div>
  );
}
