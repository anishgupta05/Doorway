// Real footage under the render, with a draggable wipe between them. The 3D
// camera follows the recovered path at the video's current time (see CompareRig),
// so dragging the divider shows exactly where the reconstruction is right or wrong.
import { cap, roundName } from "../ui/plain";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Issue, RunManifest, Scene } from "@doorway/schema";
import { runUrl } from "../data/runs";
import { useApp } from "../store";
import { footage } from "../video";
import { pathDuration } from "../scene/cameraPath";
import { CameraMinimap } from "./CameraMinimap";

export function CompareView({
  scene,
  manifest,
  runId,
  k,
  issues,
  playing,
}: {
  scene: Scene;
  manifest: RunManifest | undefined;
  runId: string | null;
  k: number | null;
  issues: Issue[];
  playing: boolean;
}) {
  // The canvas itself lives in App (one WebGL context for every mode); App clips it to the wipe.
  const wipe = useApp((s) => s.wipe);
  const setWipe = (w: number) => useApp.setState({ wipe: w });
  const [dragging, setDragging] = useState(false);
  const [time, setTime] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const duration = pathDuration(scene.camera_path);
  const src = manifest?.video && runId ? runUrl(runId, manifest.video) : null;

  useEffect(() => {
    footage.el = video.current;
    return () => void (footage.el = null);
  }, [src]);

  // Without footage, drive time ourselves so the camera still flies the path.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const el = video.current;
      if (el && src) {
        if (playing && el.paused) void el.play().catch(() => {});
        if (!playing && !el.paused) el.pause();
        setTime(el.currentTime);
        useApp.getState().setVideoTime(el.currentTime);
      } else if (playing) {
        const t = (useApp.getState().videoTime + dt) % duration;
        useApp.getState().setVideoTime(t);
        setTime(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, src, duration]);

  const seek = (t: number) => {
    if (video.current && src) video.current.currentTime = t;
    useApp.getState().setVideoTime(t);
    setTime(t);
  };

  const onDrag = (e: React.PointerEvent) => {
    if (!dragging) return;
    setWipe(Math.min(0.97, Math.max(0.03, e.clientX / window.innerWidth)));
  };

  const total = manifest?.iterations.length ?? 1;
  const score = k !== null ? manifest?.iterations[k]?.branches[manifest.iterations[k].selected]?.score : undefined;

  return (
    <>
      <div className="absolute inset-0 -z-10">
      {src ? (
        <video ref={video} src={src} className="absolute inset-0 h-full w-full object-cover" muted playsInline loop preload="auto" />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-[repeating-linear-gradient(45deg,#111317_0,#111317_12px,#0d0f12_12px,#0d0f12_24px)]">
          <div className="font-mono text-xs text-dim">no footage in this run</div>
        </div>
      )}
      </div>
      <div className={`absolute inset-0 z-10 ${dragging ? "" : "pointer-events-none"}`} onPointerMove={onDrag} onPointerUp={() => setDragging(false)} />

      {/* divider */}
      <div className="absolute inset-y-0 z-20 w-10 -translate-x-1/2 cursor-ew-resize" style={{ left: `${wipe * 100}%` }} onPointerDown={() => setDragging(true)}>
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/80 shadow-[0_0_12px_rgba(0,0,0,0.6)]" />
        <div className="absolute top-1/2 left-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-ink/70 text-xs text-fg backdrop-blur">
          ⇆
        </div>
      </div>
      <Tag side="left" style={{ right: `${(1 - wipe) * 100}%` }}>
        Real footage
      </Tag>
      <Tag side="right" style={{ left: `${wipe * 100}%` }}>
        Doorway · {k === null ? "" : roundName(k)}
        {score !== undefined && <span className="ml-2 text-accent tabular">{Math.round(score * 100)}%</span>}
      </Tag>

      {/* issues found by Argon for this iteration */}
      <div className="absolute top-24 right-5 z-10 w-72">
        <div className="mb-2 inline-block rounded-full bg-ink/80 px-2.5 py-1 text-[11px] text-muted backdrop-blur">
          Spotted {issues.length} {issues.length === 1 ? "difference" : "differences"}
        </div>
        <AnimatePresence initial={false}>
          {issues.map((i) => (
            <motion.div
              key={i.objectId + i.message}
              layout
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20, transition: { duration: 0.25 } }}
              className="mb-1.5 rounded-lg border border-line bg-ink/80 px-3 py-2 backdrop-blur"
            >
              <div className="flex items-center gap-2 text-[12px] font-medium">
                <span className={`h-1.5 w-1.5 rounded-full ${i.severity === "high" ? "bg-bad" : i.severity === "medium" ? "bg-warn" : "bg-muted"}`} />
                <span className="text-fg">{cap(scene.objects.find((o) => o.id === i.objectId)?.label ?? i.objectId.replace(/_\d+$/, ""))}</span>
              </div>
              <div className="mt-0.5 text-[12px] leading-snug text-muted">{cap(i.message)}</div>
            </motion.div>
          ))}
        </AnimatePresence>
        {issues.length === 0 && <div className="rounded-lg border border-accent/40 bg-ink/80 px-3 py-2 text-[12px] text-accent">Everything matches your video.</div>}
      </div>

      <CameraMinimap scene={scene} />

      {/* timeline */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-4 bg-gradient-to-t from-ink/90 to-transparent px-6 pt-10 pb-5">
        <button
          className="grid h-8 w-8 place-items-center rounded-full border border-line bg-panel text-xs"
          onClick={() => useApp.setState({ comparePlaying: !playing })}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="font-mono text-xs text-muted tabular">
          {fmt(time)} / {fmt(duration)}
        </span>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.01}
          value={time}
          onChange={(e) => seek(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-line accent-[var(--color-accent)]"
        />
        <div className="flex items-center gap-1 font-mono text-xs">
          {Array.from({ length: total }, (_, i) => (
            <button
              key={i}
              onClick={() => useApp.getState().setIter(i)}
              className={`rounded px-2 py-1 transition ${i === k ? "bg-accent text-ink" : "text-muted hover:text-fg"}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function Tag({ side, style, children }: { side: "left" | "right"; style: React.CSSProperties; children: ReactNode }) {
  return (
    <div className={`pointer-events-none absolute top-24 z-10 ${side === "left" ? "pr-4" : "pl-4"}`} style={style}>
      <div className="rounded-full border border-white/20 bg-ink/70 px-3 py-1 font-mono text-[11px] whitespace-nowrap text-fg backdrop-blur">{children}</div>
    </div>
  );
}
