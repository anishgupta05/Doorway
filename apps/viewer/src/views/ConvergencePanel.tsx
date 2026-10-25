// Iterations as columns, parallel branches as cards. Playback reveals one
// iteration at a time: branches appear, guards stamp the rejected ones, the
// survivor lights up, and the 3D room above morphs into it.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Branch, RunManifest } from "@doorway/schema";
import { runUrl } from "../data/runs";
import { useApp } from "../store";
import { sfx } from "../sfx";
import { hypothesis, pct, reason, roundName } from "../ui/plain";

const STEP_MS = 2600;

export function ConvergencePanel({ manifest, runId, k }: { manifest: RunManifest; runId: string; k: number | null }) {
  const iterations = manifest.iterations;
  const play = useApp((s) => s.convergencePlay);
  const preview = useApp((s) => s.preview);
  // How many columns are revealed, and whether the last one has been judged yet.
  const [shown, setShown] = useState(iterations.length);
  const [judged, setJudged] = useState(iterations.length);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (play === null) return;
    const timers: number[] = [];
    setShown(1);
    setJudged(1);
    useApp.getState().setIter(0);
    for (let i = 1; i < iterations.length; i++) {
      timers.push(window.setTimeout(() => setShown(i + 1), i * STEP_MS - 1200));
      timers.push(
        window.setTimeout(() => {
          setJudged(i + 1);
          const it = iterations[i];
          if (it.branches.some((b) => b.verdict === "fail")) sfx.reject();
          window.setTimeout(() => {
            sfx.pass();
            useApp.getState().setIter(i);
          }, 450);
        }, i * STEP_MS),
      );
    }
    timers.push(window.setTimeout(() => useApp.setState({ convergencePlay: null }), iterations.length * STEP_MS));
    return () => timers.forEach(clearTimeout);
  }, [play, iterations]);

  useEffect(() => {
    scroller.current?.scrollTo({ left: scroller.current.scrollWidth, behavior: "smooth" });
  }, [shown]);

  const scores = iterations.slice(0, judged).map((it) => it.branches[it.selected]?.score ?? 0);

  return (
    <motion.div
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="absolute inset-x-4 bottom-4 z-10 rounded-2xl border border-line bg-ink/85 shadow-2xl backdrop-blur-md"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-baseline gap-3">
          <div className="text-sm font-medium">How Doorway checked its work</div>
          <div className="text-[12px] text-muted">
            It tried {iterations.reduce((n, it) => n + (it.k === 0 ? 0 : it.branches.length), 0)} ideas.{" "}
            <span className="text-bad">{iterations.reduce((n, it) => n + it.branches.filter((b) => b.verdict === "fail").length, 0)} would have broken something, so they were thrown out.</span>
          </div>
        </div>
        <Sparkline scores={scores} total={iterations.length} />
      </div>
      <div ref={scroller} className="flex gap-3 overflow-x-auto px-5 py-4">
        <AnimatePresence initial={false}>
          {iterations.slice(0, shown).map((it, col) => {
            const revealed = col < judged;
            return (
              <motion.div
                key={it.k}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: "spring", stiffness: 220, damping: 26 }}
                className="w-[250px] shrink-0"
              >
                <div className="mb-2 flex items-center justify-between text-[12px] font-medium text-muted">
                  <span className={k === it.k && !preview ? "text-fg" : ""}>{roundName(it.k)}</span>
                  {revealed && <span className="text-accent tabular">{pct(it.branches[it.selected]?.score ?? 0)}</span>}
                </div>
                <div className="flex flex-col gap-2">
                  {it.branches.map((b, row) => (
                    <BranchCard
                      key={b.i}
                      b={b}
                      runId={runId}
                      delay={row * 0.12}
                      judged={revealed}
                      selected={revealed && b.i === it.selected}
                      active={preview ? preview.k === it.k && preview.i === b.i : k === it.k && b.i === it.selected}
                      onClick={() => {
                        sfx.tick();
                        if (b.i === it.selected) useApp.getState().setIter(it.k);
                        else useApp.getState().setPreview({ k: it.k, i: b.i });
                      }}
                    />
                  ))}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      {preview && (
        <div className="border-t border-line px-5 py-2 font-mono text-[11px] text-warn">
          Previewing an idea that was thrown out. Press 4 to explore it yourself, or Esc to go back.
        </div>
      )}
    </motion.div>
  );
}

function BranchCard({
  b,
  runId,
  delay,
  judged,
  selected,
  active,
  onClick,
}: {
  b: Branch;
  runId: string;
  delay: number;
  judged: boolean;
  selected: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const failed = judged && b.verdict === "fail";
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: judged && !selected && !failed ? 0.6 : 1, y: 0, scale: selected ? 1.0 : 0.985 }}
      transition={{ delay, type: "spring", stiffness: 300, damping: 26 }}
      onClick={onClick}
      className={`relative overflow-hidden rounded-xl border text-left transition-colors ${
        selected ? "border-accent/70 bg-panel-2 shadow-[0_0_0_1px_rgba(198,243,107,0.25),0_0_28px_-6px_rgba(198,243,107,0.45)]" : failed ? "border-bad/40 bg-panel" : "border-line bg-panel"
      } ${active ? "ring-1 ring-white/50" : ""}`}
    >
      <div className="flex gap-2.5 p-2">
        <Thumb src={b.thumb ? runUrl(runId, b.thumb) : null} failed={failed} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span className={`rounded-full px-2 py-px text-[10.5px] font-semibold ${selected ? "bg-accent text-ink" : failed ? "bg-bad/15 text-bad" : ""}`}>
              {selected ? "✓ Kept" : failed ? "✗ Thrown out" : judged ? "Not chosen" : "Trying…"}
            </span>
            <span className={`tabular ${failed ? "text-bad" : selected ? "text-accent" : ""}`}>{judged ? (failed ? "—" : pct(b.score)) : "…"}</span>
          </div>
          {/* hypothesis comes from the model: plain text only */}
          <div title={hypothesis(b.hypothesis)} className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-fg/90">{hypothesis(b.hypothesis) || "—"}</div>
          {failed && b.reason && <div title={reason(b.reason)} className="mt-1 line-clamp-3 text-[11px] leading-snug text-bad">{reason(b.reason)}</div>}
        </div>
      </div>
    </motion.button>
  );
}

function Thumb({ src, failed }: { src: string | null; failed: boolean }) {
  const [ok, setOk] = useState(true);
  return (
    <div className={`h-[52px] w-[72px] shrink-0 overflow-hidden rounded-md border border-line bg-[linear-gradient(135deg,#1c2026,#121418)] ${failed ? "grayscale" : ""}`}>
      {src && ok && <img src={src} alt="" className="h-full w-full object-cover" onError={() => setOk(false)} />}
    </div>
  );
}

function Sparkline({ scores, total }: { scores: number[]; total: number }) {
  const w = 180;
  const h = 34;
  const x = (i: number) => (total <= 1 ? 0 : (i / (total - 1)) * (w - 8) + 4);
  const y = (s: number) => h - 4 - s * (h - 8);
  const pts = scores.map((s, i) => `${x(i)},${y(s)}`).join(" ");
  const last = scores[scores.length - 1];
  return (
    <div className="flex items-center gap-3">
      <svg width={w} height={h} className="overflow-visible">
        <line x1={4} x2={w - 4} y1={y(1)} y2={y(1)} stroke="var(--color-line)" strokeDasharray="2 3" />
        <polyline points={pts} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" />
        {scores.map((s, i) => (
          <circle key={i} cx={x(i)} cy={y(s)} r={i === scores.length - 1 ? 3.5 : 2} fill="var(--color-accent)" />
        ))}
      </svg>
      <div className="text-right">
        <div className="font-mono text-lg leading-none text-accent tabular">{last !== undefined ? pct(last) : "—"}</div>
        <div className="mt-0.5 text-[10px] text-muted">match with your video</div>
      </div>
    </div>
  );
}
