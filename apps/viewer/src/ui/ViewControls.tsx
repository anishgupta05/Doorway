// On-screen camera controls for the overview: zoom in/out, move, and re-frame the room.
// Mouse: drag to orbit, scroll to zoom toward the cursor, right-drag to move. Keys: W A S D move, Q / Z up and down.
import { view } from "../scene/Rigs";
import { useApp } from "../store";
import { sfx } from "../sfx";

const Btn = ({ label, title, onClick }: { label: string; title: string; onClick: () => void }) => (
  <button
    onClick={() => {
      sfx.tick();
      onClick();
    }}
    title={title}
    aria-label={title}
    className="grid h-9 w-9 place-items-center rounded-full border border-line bg-panel/80 text-[15px] text-fg backdrop-blur transition hover:border-accent/60 hover:text-accent"
  >
    {label}
  </button>
);

export function ViewControls() {
  const mode = useApp((s) => s.mode);
  if (mode !== "overview" && mode !== "convergence") return null;
  const c = () => view.controls;
  return (
    <div className={`absolute right-5 z-10 flex flex-col items-center gap-2 ${mode === "convergence" ? "top-24" : "top-1/2 -translate-y-1/2"}`}>
      <Btn label="+" title="Zoom in" onClick={() => void c()?.dolly(Math.max(0.8, (c()?.distance ?? 6) * 0.22), true)} />
      <Btn label="−" title="Zoom out" onClick={() => void c()?.dolly(-Math.max(0.8, (c()?.distance ?? 6) * 0.28), true)} />
      {mode === "overview" && (
        <>
      <Btn label="↑" title="Move forward" onClick={() => void c()?.forward(1.2, true)} />
      <div className="flex gap-2">
        <Btn label="←" title="Move left" onClick={() => void c()?.truck(-1.2, 0, true)} />
        <Btn label="→" title="Move right" onClick={() => void c()?.truck(1.2, 0, true)} />
      </div>
      <Btn label="↓" title="Move back" onClick={() => void c()?.forward(-1.2, true)} />
        </>
      )}
      <Btn label="⟲" title="Reset view" onClick={() => useApp.setState((s) => ({ viewNonce: s.viewNonce + 1 }))} />
      {mode === "overview" && <div className="mt-1 w-28 text-center text-[10.5px] leading-snug text-dim">Drag to look around · scroll to zoom · right-drag or WASD to move</div>}
    </div>
  );
}
