import type { useCurrentScene } from "../data/runs";
import { useApp, type Mode } from "../store";
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
  { mode: "convergence", label: "How it improved", key: "2" },
  { mode: "walk", label: "Explore", key: "4" },
];
export function TopBar({ current }: { current: ReturnType<typeof useCurrentScene> }) {
  const mode = useApp((s) => s.mode);
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
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-ink/55 py-1.5 pr-4 pl-2 backdrop-blur">
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
        <button
          onClick={() => {
            sfx.tick();
            useApp.setState({ uploadOpen: true });
          }}
          className="rounded-full bg-accent px-4 py-1.5 text-[13px] font-semibold text-ink transition hover:brightness-110"
        >
          + New video
        </button>
        <div className="rounded-full border border-line bg-panel/80 px-3 py-1.5 text-[12px] backdrop-blur">
          <span className="text-muted">Match </span>
          <span className={`tabular ${preview ? "text-bad" : "text-accent"}`}>{branch ? (branch.verdict === "fail" ? "thrown out" : `${Math.round(branch.score * 100)}%`) : "—"}</span>
        </div>
      </div>
    </div>
  );
}
