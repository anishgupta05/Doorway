// Crosshair, "E · Open door" hint, and the "click to take control" cover that
// the judge sees when the presenter hands over the keyboard.
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Scene } from "@doorway/schema";
import { partTarget, useApp } from "../store";
import { defaultJoint } from "../scene/Placed";

function verb(scene: Scene, id: string, joints: Record<string, number>, part: number | null) {
  const o = scene.objects.find((x) => x.id === id);
  if (!o) return null;
  const name = (o.label ?? o.id).toLowerCase();
  if (part !== null) {
    const what = /locker|pigeon|cubby/i.test(`${o.label ?? ""} ${o.id}`) || o.cells ? `locker ${part + 1}` : `door ${part + 1} of the ${name}`;
    return `${partTarget(joints, id, part) > 0 ? "Close" : "Open"} ${what}`;
  }
  const open = (joints[id] ?? defaultJoint(o)) > 0;
  switch (o.articulation?.kind) {
    case "hinge":
    case "slide":
      return `${open ? "Close" : "Open"} ${name}`;
    case "switch":
      return `Turn ${name} ${open ? "off" : "on"}`;
    default:
      return `Push ${name}`;
  }
}

export function WalkOverlay({ scene }: { scene: Scene }) {
  const hovered = useApp((s) => s.hovered);
  const joints = useApp((s) => s.joints);
  const preview = useApp((s) => s.preview);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const on = () => setLocked(document.pointerLockElement !== null);
    document.addEventListener("pointerlockchange", on);
    return () => document.removeEventListener("pointerlockchange", on);
  }, []);

  const hoveredPart = useApp((s) => s.hoveredPart);
  const hint = hovered ? verb(scene, hovered, joints, hoveredPart) : null;

  return (
    <>
      <div className="pointer-events-none absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
        <div className={`rounded-full transition-all duration-150 ${hint ? "h-3 w-3 border-2 border-accent" : "h-1.5 w-1.5 bg-white/80"}`} />
      </div>
      <AnimatePresence>
        {hint && locked && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="pointer-events-none absolute top-[calc(50%+28px)] left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-ink/75 px-3 py-1.5 text-[13px] backdrop-blur"
          >
            <kbd className="rounded bg-accent px-1.5 font-mono text-[11px] font-bold text-ink">E</kbd>
            <span>{hint}</span>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {!locked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 grid cursor-pointer place-items-center bg-ink/70 backdrop-blur-[3px]"
          >
            <div className="text-center">
              <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full border border-accent/60 bg-ink/60 shadow-[0_0_40px_-8px_rgba(198,243,107,0.6)]">
                <span className="text-2xl text-accent">▶</span>
              </div>
              <div className="text-2xl font-semibold tracking-tight">Click to take control</div>
              <div className="mt-2 text-sm text-fg/75">
                {preview ? "This idea was thrown out. Try the door and see why." : "Walk to the door and open it."}
              </div>
              <div className="mt-6 flex justify-center gap-5 font-mono text-[11px] text-fg/70">
                <span><Key>W A S D</Key> move</span>
                <span><Key>mouse</Key> look</span>
                <span><Key>E</Key> interact</span>
                <span><Key>Esc</Key> release</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const Key = ({ children }: { children: React.ReactNode }) => (
  <kbd className="mr-1 rounded border border-line bg-panel px-1.5 py-0.5 text-fg">{children}</kbd>
);
