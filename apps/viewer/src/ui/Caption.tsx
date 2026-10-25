// Big presenter captions per beat, a stats strip, and the hotkey legend.
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { RunManifest, Scene } from "@doorway/schema";
import { useApp } from "../store";
import { KEYS } from "../hotkeys";

const ATTRACT = [
  ["A phone video in.", "A working simulation out."],
  ["Doors open. Drawers slide. Lights switch.", "Every object knows what it is."],
  ["Checked against your video", "and fixed until it matches."],
  ["Ready for the robot.", "Exports straight to a robot simulator."],
];

export function Caption({ scene, manifest }: { scene: Scene; manifest: RunManifest | undefined }) {
  const mode = useApp((s) => s.mode);
  const tests = useApp((s) => s.tests);
  const robotOpen = useApp((s) => s.robotOpen);
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

  let title: string;
  let sub: string;
  if (robotOpen && mode === "overview") [title, sub] = ["A robot plans in the replica", "Same task twice: on the first pass, and on the room after it was checked."];
  else if (building) [title, sub] = ["Written in one go", "Doorway watched your video and wrote the whole room: shapes, doors, lights."];
  else if (tests) [title, sub] = ["It works, not just looks right", "Every door, drawer and light is tried out and checked."];
  else if (split && mode === "overview") [title, sub] = ["First attempt vs. checked", "Same video. Left: Doorway's first attempt. Right: after it tried fixes and threw out the ones that broke something."];
  else if (mode === "compare") [title, sub] = ["Your video vs. the 3D room", "Same camera path as the phone. Drag the divider."];
  else if (idle && mode === "overview") [title, sub] = ATTRACT[attract];
  else [title, sub] = [`A working 3D room, built from your video`, `${scene.room.width} × ${scene.room.depth} m with a ${scene.room.floorMaterial} floor${night ? ", at night" : ""}.`];

  if (mode === "walk" || mode === "convergence") return null;
  return (
    <div className={`pointer-events-none absolute z-10 max-w-3xl ${building ? "bottom-16 left-[440px]" : "bottom-16 left-6"}`}>
      {/* soft shade so the text stays readable over any room */}
      <div className="absolute -bottom-16 -left-6 -z-10 h-[26rem] w-[64rem] max-w-[100vw] bg-[radial-gradient(ellipse_at_bottom_left,rgba(11,12,14,0.88),rgba(11,12,14,0.55)_45%,transparent_72%)]" />
      <AnimatePresence mode="wait">
        <motion.div key={title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.45 }}>
          <div className="text-[34px] leading-[1.08] font-semibold tracking-[-0.02em] text-fg [text-shadow:0_2px_24px_rgba(0,0,0,0.6)]">{title}</div>
          <div className="mt-2 text-[15px] text-muted [text-shadow:0_1px_12px_rgba(0,0,0,0.8)]">{sub}</div>
        </motion.div>
      </AnimatePresence>
      {mode === "overview" && !building && !tests && !split && !robotOpen && <Stats scene={scene} manifest={manifest} />}
    </div>
  );
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const NUM = ["", "a", "two", "three", "four", "five", "six"];

/** What's in the room, in words: contents first, then what you can do with it. */
function describe(scene: Scene) {
  const counts = new Map<string, number>();
  scene.objects.filter((o) => o.type !== "door" && o.type !== "drawer").forEach((o) => counts.set(o.type, (counts.get(o.type) ?? 0) + 1));
  const things = [...counts].map(([t, n]) => (t === "other" ? `${n} smaller things` : n === 1 ? `a ${t}` : `${NUM[n] ?? n} ${t}s`));
  const label = (id: string) => (scene.objects.find((o) => o.id === id)?.label ?? id).toLowerCase();
  const verbs = scene.interactions.filter((i) => i.verb === "open" || i.verb === "toggle").map((i) => (i.verb === "open" ? `open the ${label(i.target)}` : `switch the ${label(i.target)} on`));
  const pushed = scene.interactions.filter((i) => i.verb === "push").map((i) => scene.objects.find((o) => o.id === i.target)?.type).filter(Boolean);
  if (pushed.length) verbs.push(`push the ${pushed[0]}s around`);
  return { things, verbs };
}

function Stats({ scene }: { scene: Scene; manifest: RunManifest | undefined }) {
  const { things, verbs } = describe(scene);
  return (
    <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-fg/90 [text-shadow:0_1px_12px_rgba(0,0,0,0.8)]">
      {things.length > 0 && <>Inside you'll find {list(things)}. </>}
      {verbs.length > 0 && <>Go ahead and {list(verbs.slice(0, 3))}{verbs.length > 3 ? ", and more" : ""}.</>}
    </p>
  );
}

export function Legend() {
  const mode = useApp((s) => s.mode);
  const open = useApp((s) => s.legendOpen);
  if (mode === "walk" || mode === "compare") return null;
  return (
    <div className="absolute right-5 bottom-5 z-10 flex items-center gap-3 text-[11px] text-dim">
      {open &&
        KEYS.map((k) => (
          <span key={k.key} className="pointer-events-none">
            <kbd className="mr-1 rounded border border-line bg-panel/70 px-1 font-mono text-muted">{k.key}</kbd>
            {k.label}
          </span>
        ))}
      <button onClick={() => useApp.setState({ legendOpen: !open })} className="rounded-full border border-line bg-panel/70 px-2.5 py-1 text-muted hover:text-fg" title="Keyboard shortcuts (?)">
        {open ? "Hide keys" : "Keys ?"}
      </button>
    </div>
  );
}

/** One-time hint for first-time visitors. */
export function Tip() {
  const [show, setShow] = useState(() => {
    try {
      return !localStorage.getItem("doorway-tip");
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => dismiss(), 12000);
    return () => clearTimeout(t);
  });
  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem("doorway-tip", "1");
    } catch {}
  };
  const mode = useApp((s) => s.mode);
  if (!show || mode === "walk") return null;
  return (
    <div className="absolute top-24 left-1/2 z-20 -translate-x-1/2 rounded-full border border-line bg-panel/90 px-5 py-2 text-[13px] text-fg/90 shadow-xl backdrop-blur">
      Press <kbd className="mx-1 rounded border border-line bg-ink px-1.5 font-mono text-[11px]">4</kbd> to walk inside, then <kbd className="mx-1 rounded border border-line bg-ink px-1.5 font-mono text-[11px]">E</kbd> to open doors and switch lights.
      <button onClick={dismiss} className="ml-3 text-muted hover:text-fg" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
