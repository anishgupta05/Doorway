import type { useCurrentScene } from "../data/runs";
import { useApp, type Mode, type Version } from "../store";
import { sfx } from "../sfx";

export function DoorMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="7" y="3" width="18" height="27" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M9 5 L19 8 L19 29 L9 28 Z" fill="var(--color-accent)" />
      <circle cx="17" cy="18" r="1.3" fill="#0b0c0e" />
    </svg>
  );
}

const MODES: { mode: Mode; label: string; key: string }[] = [
  { mode: "overview", label: "Overview", key: "0" },
  { mode: "compare", label: "Compare", key: "1" },
  { mode: "convergence", label: "Convergence", key: "2" },
  { mode: "walk", label: "Walk", key: "4" },
];
const VERSIONS: { v: Version; label: string }[] = [
  { v: "v0", label: "v0" },
  { v: "latest", label: "latest" },
  { v: "backup", label: "backup" },
];

export function TopBar({ current }: { current: ReturnType<typeof useCurrentScene> }) {
  const mode = useApp((s) => s.mode);
  const version = useApp((s) => s.version);
  const { manifest, branch, preview } = current;
  if (mode === "walk") {
    return (
      <div className="pointer-events-none absolute top-5 left-5 z-30 flex items-center gap-2.5 opacity-70">
        <DoorMark className="h-5 w-5 text-fg" />
        <span className="text-sm font-semibold tracking-tight">Doorway</span>
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between p-5">
      <div className="pointer-events-auto flex items-center gap-3">
        <DoorMark className="h-7 w-7 text-fg" />
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">Doorway</div>
          <div className="text-xs text-muted">{manifest?.title ?? "—"}</div>
        </div>
      </div>

      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-line bg-panel/80 p-1 backdrop-blur">
        {MODES.map((m) => (
          <button
            key={m.mode}
            onClick={() => {
              sfx.whoosh();
              useApp.getState().setMode(m.mode);
            }}
            className={`rounded-full px-3.5 py-1.5 text-[13px] transition ${mode === m.mode ? "bg-fg text-ink" : "text-muted hover:text-fg"}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="pointer-events-auto flex items-center gap-3">
        <div className="flex items-center gap-0.5 rounded-full border border-line bg-panel/80 p-1 font-mono text-[11px] backdrop-blur">
          {VERSIONS.map((v) => (
            <button
              key={v.v}
              onClick={() => {
                sfx.tick();
                useApp.getState().setVersion(v.v);
              }}
              className={`rounded-full px-2.5 py-1 transition ${version === v.v && !preview ? "bg-panel-2 text-fg" : "text-muted hover:text-fg"}`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="rounded-full border border-line bg-panel/80 px-3 py-1.5 font-mono text-[11px] backdrop-blur">
          <span className="text-muted">match </span>
          <span className={`tabular ${preview ? "text-bad" : "text-accent"}`}>{branch ? (branch.verdict === "fail" ? "rejected" : branch.score.toFixed(2)) : "—"}</span>
        </div>
      </div>
    </div>
  );
}
