// How Doorway itself got better on one room: every run of the same video, each loop
// iteration's match score in order, and what we changed in Doorway before each run.
// Data: runs/history.json + each run's manifest.json.
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { RunManifest } from "@doorway/schema";
import { runUrl } from "../data/runs";

type HistoryRun = { id: string; label: string; note?: string; changes: string[] };
type History = { room: string; video?: string; runs: HistoryRun[] };
type Loaded = HistoryRun & { manifest: RunManifest };
type Point = { run: number; k: number; score: number; hypothesis: string; x: number };

const pct = (s: number) => `${Math.round(s * 100)}%`;

export function ProgressView() {
  const [history, setHistory] = useState<History | null>(null);
  const [runs, setRuns] = useState<Loaded[]>([]);
  const [hover, setHover] = useState<Point | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const h = (await fetch("/runs/history.json", { cache: "no-store" }).then((r) => r.json())) as History;
      const loaded = await Promise.all(
        h.runs.map(async (r) => {
          const m = RunManifest.parse(await fetch(runUrl(r.id, "manifest.json"), { cache: "no-store" }).then((x) => x.json()));
          return { ...r, manifest: m };
        }),
      );
      if (live) {
        setHistory(h);
        setRuns(loaded);
      }
    })().catch(() => {});
    return () => void (live = false);
  }, []);

  // One point per loop iteration, runs laid out left to right with a gap between them.
  const points = useMemo(() => {
    const out: Point[] = [];
    let x = 0;
    runs.forEach((r, ri) => {
      r.manifest.iterations.forEach((it) => {
        const b = it.branches[it.selected];
        out.push({ run: ri, k: it.k, score: b.score, hypothesis: b.hypothesis ?? "", x });
        x += 1;
      });
      x += 0.8;
    });
    return out;
  }, [runs]);

  if (!history || !runs.length) {
    return <Frame><div className="p-10 font-mono text-xs text-muted">Loading runs…</div></Frame>;
  }
  const first = points[0].score;
  const best = Math.max(...points.map((p) => p.score));

  // Chart geometry.
  const W = 1000;
  const H = 260;
  const pad = { l: 44, r: 16, t: 18, b: 34 };
  const maxX = points[points.length - 1].x;
  const X = (x: number) => pad.l + (x / Math.max(1, maxX)) * (W - pad.l - pad.r);
  const lo = 0.4;
  const Y = (s: number) => pad.t + (1 - (s - lo) / (1 - lo)) * (H - pad.t - pad.b);

  return (
    <Frame>
      <div className="flex items-end justify-between gap-6 px-8 pt-7">
        <div>
          <div className="font-mono text-[10.5px] tracking-[0.18em] text-muted uppercase">{history.room} · how Doorway improved</div>
          <div className="mt-2 flex items-baseline gap-4">
            <span className="text-[52px] leading-none font-semibold tracking-tight text-muted tabular">{pct(first)}</span>
            <span className="text-3xl text-dim">→</span>
            <span className="text-[52px] leading-none font-semibold tracking-tight text-fg tabular">{pct(best)}</span>
            <span className="ml-2 text-[14px] text-muted">match with the footage, same video, {runs.length} runs</span>
          </div>
        </div>
        {history.video && <div className="max-w-xs text-right font-mono text-[10.5px] text-dim">{history.video}</div>}
      </div>

      {/* Match score at every loop iteration, run after run. */}
      <div className="relative px-6 pt-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseLeave={() => setHover(null)}>
          {[0.5, 0.6, 0.7, 0.8, 0.9, 1].map((g) => (
            <g key={g}>
              <line x1={pad.l} x2={W - pad.r} y1={Y(g)} y2={Y(g)} stroke="var(--color-line)" strokeWidth={1} />
              <text x={pad.l - 8} y={Y(g) + 4} textAnchor="end" className="fill-[var(--color-dim)] font-mono text-[11px]">
                {pct(g)}
              </text>
            </g>
          ))}
          {runs.map((r, ri) => {
            const pts = points.filter((p) => p.run === ri);
            const x0 = X(pts[0].x);
            const x1 = X(pts[pts.length - 1].x);
            return (
              <g key={r.id}>
                <text x={(x0 + x1) / 2} y={H - 10} textAnchor="middle" className="fill-[var(--color-muted)] font-mono text-[11px]">
                  {r.label}
                </text>
                {ri > 0 && <line x1={x0 - (X(1) - X(0)) * 0.4} x2={x0 - (X(1) - X(0)) * 0.4} y1={pad.t} y2={H - pad.b} stroke="var(--color-line)" strokeDasharray="3 4" />}
                <polyline points={pts.map((p) => `${X(p.x)},${Y(p.score)}`).join(" ")} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {pts.map((p) => (
                  <g key={p.k}>
                    <circle cx={X(p.x)} cy={Y(p.score)} r={hover === p ? 6 : 4} fill="var(--color-accent)" stroke="var(--color-ink)" strokeWidth={2} />
                    <rect x={X(p.x) - 14} y={pad.t} width={28} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(p)} />
                  </g>
                ))}
                {/* direct labels: where each run started and ended */}
                <text x={x0} y={Y(pts[0].score) + 18} textAnchor="middle" className="fill-[var(--color-muted)] font-mono text-[11px]">
                  {pct(pts[0].score)}
                </text>
                <text x={x1} y={Y(pts[pts.length - 1].score) - 12} textAnchor="middle" className="fill-[var(--color-fg)] font-mono text-[12px]">
                  {pct(pts[pts.length - 1].score)}
                </text>
              </g>
            );
          })}
        </svg>
        {hover && (
          <div
            className="pointer-events-none absolute z-10 w-64 rounded-lg border border-line bg-ink/95 px-3 py-2 shadow-xl"
            style={{ left: `calc(${(X(hover.x) / W) * 100}% + 12px)`, top: 8 }}
          >
            <div className="font-mono text-[10.5px] text-muted">
              {runs[hover.run].label} · {hover.k === 0 ? "one pass" : `iteration ${hover.k}`}
            </div>
            <div className="text-[15px] font-semibold text-fg tabular">{pct(hover.score)}</div>
            {hover.hypothesis && <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{hover.hypothesis}</div>}
          </div>
        )}
      </div>

      {/* What changed in Doorway before each run. */}
      <div className="grid gap-3 px-8 pt-2 pb-7" style={{ gridTemplateColumns: `repeat(${runs.length}, minmax(0, 1fr))` }}>
        {runs.map((r) => {
          const its = r.manifest.iterations;
          const s0 = its[0].branches[its[0].selected].score;
          const s1 = its[its.length - 1].branches[its[its.length - 1].selected].score;
          const last = its[its.length - 1].branches[its[its.length - 1].selected];
          const rejected = its.reduce((n, it) => n + it.branches.filter((b) => b.verdict === "fail").length, 0);
          return (
            <div key={r.id} className="flex gap-3 rounded-xl border border-line bg-panel/70 p-3">
              {last.thumb && <img src={runUrl(r.id, last.thumb)} alt="" className="h-20 w-28 shrink-0 rounded-md border border-line object-cover" />}
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium">{r.label}</span>
                  <span className="font-mono text-[12px] text-muted tabular">
                    {pct(s0)} → <span className="text-fg">{pct(s1)}</span>
                  </span>
                  <span className="font-mono text-[10.5px] text-dim">
                    {its.length - 1} rounds · {rejected} rejected
                  </span>
                </div>
                {r.note && <div className="mt-1 text-[11.5px] leading-snug text-muted">{r.note}</div>}
                <ul className="mt-1.5 space-y-0.5">
                  {r.changes.map((c) => (
                    <li key={c} className="flex gap-1.5 text-[11.5px] leading-snug text-fg/85">
                      <span className="text-accent">+</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ type: "spring", stiffness: 240, damping: 28 }}
      className="absolute inset-x-6 top-20 bottom-6 z-20 overflow-y-auto rounded-2xl border border-line bg-ink/92 shadow-2xl backdrop-blur-md"
    >
      {children}
    </motion.div>
  );
}
