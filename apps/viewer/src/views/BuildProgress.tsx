// The "your room is being built" screen, laid out like a video editor: your clip on top, a filmstrip
// timeline underneath with a playhead that sweeps as the work advances, and plain-language steps beside it.
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { getJob, getProgress, renameRoom, uploadVideo, type Job, type LoopProgress } from "../data/api";
import { openRoom } from "../data/api";
import { useApp } from "../store";
import { sfx } from "../sfx";

const STEPS = [
  { key: "uploading", title: "Sending your video", from: 0, to: 8 },
  { key: "watching", title: "Watching your video", from: 8, to: 35 },
  { key: "drawing", title: "Drawing the room", from: 35, to: 55 },
  { key: "checking", title: "Checking it against your footage", from: 55, to: 100 },
] as const;
const FRAMES = 14;
const ROUNDS = 3;

/** Grab evenly spaced frames from the clip for the filmstrip. */
function useFilmstrip(src: string | null) {
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {
    if (!src) return;
    let dead = false;
    const v = document.createElement("video");
    v.src = src;
    v.muted = true;
    v.preload = "auto";
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 90;
    const out: string[] = [];
    v.onloadedmetadata = async () => {
      // Recorded WebM often reports an infinite duration until you seek past the end.
      if (!Number.isFinite(v.duration)) {
        v.currentTime = 1e7;
        await new Promise<void>((r) => (v.onseeked = () => r()));
      }
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 10;
      for (let i = 0; i < FRAMES && !dead; i++) {
        v.currentTime = (dur * (i + 0.5)) / FRAMES;
        await new Promise<void>((r) => (v.onseeked = () => r()));
        c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
        out.push(c.toDataURL("image/jpeg", 0.6));
        setFrames([...out]);
      }
    };
    return () => void (dead = true);
  }, [src]);
  return frames;
}

export function BuildProgress({ building }: { building: NonNullable<ReturnType<typeof useApp.getState>["building"]> }) {
  const [name, setName] = useState(building.name);
  const [upload, setUpload] = useState(0);
  const [id, setId] = useState<string | null>(building.id);
  const [job, setJob] = useState<Job | null>(null);
  const [loop, setLoop] = useState<LoopProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());
  const started = useRef(false);
  const nameRef = useRef(building.name);
  nameRef.current = name;
  // No local builder (static host): replay a finished build on a timeline, clearly labelled.
  const [demo] = useState(() => !useApp.getState().apiOk);
  const frames = useFilmstrip(building.src);

  useEffect(() => {
    if (demo || started.current || !building.file) return;
    started.current = true;
    uploadVideo(building.file, name, setUpload)
      .then((r) => setId(r.id))
      .catch((e) => setError(e.message));
  }, [building.file, name, demo]);

  useEffect(() => {
    if (!demo) return;
    const live = useApp.getState().index?.live ?? null;
    const step = (k: number): LoopProgress => ({ stage: "test", k, detail: "" });
    const plan: [number, () => void][] = [
      [200, () => setUpload(0.25)],
      [1000, () => setUpload(0.65)],
      [2000, () => setUpload(1)],
      [2800, () => (setId(live), setJob({ stage: "watching" }))],
      [9500, () => setJob({ stage: "drawing" })],
      [15500, () => (setJob({ stage: "checking" }), setLoop(step(1)))],
      [19000, () => setLoop(step(2))],
      [22500, () => setLoop(step(3))],
      [26000, () => (setJob({ stage: "done" }), sfx.pass())],
    ];
    const timers = plan.map(([ms, f]) => setTimeout(f, ms));
    return () => timers.forEach(clearTimeout);
  }, [demo]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!id || demo) return;
    let stop = false;
    const tick = async () => {
      try {
        const j = await getJob(id);
        if (stop) return;
        setJob(j);
        if (j.stage === "checking") setLoop(await getProgress(id));
        if (j.stage === "error") return setError(j.message ?? "Something went wrong.");
        if (j.stage === "done") {
          sfx.pass();
          // No name typed: take the one the model chose.
          if (!nameRef.current.trim()) fetch(`/runs/${id}/manifest.json`, { cache: "no-store" }).then((r) => r.json()).then((m) => m.title && setName(m.title)).catch(() => {});
          return;
        }
      } catch {
        /* the job file appears a moment after the upload finishes */
      }
      if (!stop) setTimeout(tick, 1500);
    };
    tick();
    return () => void (stop = true);
  }, [id]);

  const stage = !id ? "uploading" : job?.stage ?? "watching";
  const done = job?.stage === "done";
  const stepIdx = done ? STEPS.length : Math.max(0, STEPS.findIndex((s) => s.key === stage));
  const pct = useMemo(() => {
    if (done) return 100;
    const s = STEPS[Math.max(0, Math.min(stepIdx, STEPS.length - 1))];
    if (s.key === "uploading") return s.from + (s.to - s.from) * upload;
    if (s.key === "checking" && loop) return s.from + ((s.to - s.from) * Math.min(loop.k + (loop.stage === "done" ? 1 : 0.5), ROUNDS)) / ROUNDS;
    // No fine-grained signal: ease toward the end of the step so the bar always moves, but never claims to finish.
    const elapsed = (now - t0) / 1000;
    return s.from + (s.to - s.from) * 0.9 * (1 - Math.exp(-elapsed / 45));
  }, [done, stepIdx, upload, loop, now, t0]);

  // Rough time left from overall progress (a real build is ~5 minutes; the demo replay ~26 s).
  const total = demo ? 26 : 300;
  const secs = Math.max(0, total * (1 - pct / 100));
  const left = secs < 20 ? "Almost there" : secs < 75 ? "Under a minute left" : `About ${Math.round(secs / 60)} min left`;

  const detail =
    stage === "uploading" ? `${Math.round(upload * 100)}%` :
    stage === "checking" && loop ? (loop.k === 0 ? "Scoring the first draft" : `Trying fixes, round ${Math.min(loop.k, ROUNDS)} of ${ROUNDS}`) :
    stage === "watching" ? "Finding the walls, doors and furniture" :
    stage === "drawing" ? "Writing the room as shapes you can walk through" : "";

  const save = () => {
    const n = name.trim();
    if (id && n) void renameRoom(id, n).catch(() => {});
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-40 flex flex-col bg-ink">
      <div className="flex items-center justify-between px-8 pt-6">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          placeholder="Naming your room…"
          aria-label="Room name"
          className="w-[360px] rounded-lg border border-transparent bg-transparent px-2 py-1 text-2xl font-semibold tracking-tight outline-none transition hover:border-line focus:border-accent/60 focus:bg-panel"
        />
        <div className="flex items-center gap-4">
          {demo && <span className="rounded-full border border-line px-3 py-1 text-[12px] text-muted">Demo mode · replaying a finished build</span>}
        <button onClick={() => useApp.setState({ building: null })} className="text-[13px] text-muted hover:text-fg">
          {done || error ? "Close" : "Hide"}
        </button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-[1fr_340px] gap-8 px-8 pt-6 pb-4">
        <div className="relative min-h-0 overflow-hidden rounded-2xl border border-line bg-black">
          {building.src ? <video src={building.src} className="h-full w-full object-contain" autoPlay muted loop playsInline /> : <div className="grid h-full place-items-center text-muted">Your video</div>}
        </div>

        <div className="flex flex-col justify-center gap-5">
          {error ? (
            <div className="rounded-xl border border-bad/50 bg-bad/10 p-4">
              <div className="text-[15px] font-semibold text-bad">That didn't work</div>
              <div className="mt-1 text-[13px] text-fg/80">{error}</div>
              <button onClick={() => useApp.setState({ building: null, uploadOpen: true })} className="mt-3 rounded-full bg-fg px-4 py-1.5 text-[13px] font-semibold text-ink">
                Try another video
              </button>
            </div>
          ) : (
            <>
              <ol className="flex flex-col gap-3">
                {STEPS.map((s, i) => {
                  const state = i < stepIdx ? "done" : i === stepIdx ? "now" : "todo";
                  return (
                    <li key={s.key} className={`flex items-start gap-3 ${state === "todo" ? "opacity-40" : ""}`}>
                      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] ${state === "done" ? "border-accent bg-accent text-ink" : state === "now" ? "border-accent text-accent" : "border-line"}`}>
                        {state === "done" ? "✓" : state === "now" ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> : ""}
                      </span>
                      <div>
                        <div className="text-[15px] font-medium">{s.title}</div>
                        {state === "now" && detail && <div className="text-[12px] text-muted">{detail}</div>}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {done && (
                <motion.button
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => id && openRoom(id)}
                  className="self-start rounded-full bg-accent px-6 py-2.5 text-[14px] font-semibold text-ink shadow-[0_0_30px_-6px_rgba(198,243,107,0.6)] hover:brightness-110"
                >
                  Step inside →
                </motion.button>
              )}
            </>
          )}
        </div>
      </div>

      {/* timeline: filmstrip with a playhead that follows overall progress */}
      <div className="px-8 pb-8">
        <div className="mb-2 flex items-center justify-between text-[12px] text-muted">
          <span>{done ? "Your room is ready" : error ? "Stopped" : STEPS[Math.min(stepIdx, STEPS.length - 1)].title + "…"}</span>
          <span className="tabular">{!done && !error && <span className="mr-3">{left}</span>}{Math.round(pct)}%</span>
        </div>
        <div className="relative h-[72px] overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex h-full">
            {Array.from({ length: FRAMES }, (_, i) => (
              <div key={i} className="h-full flex-1 border-r border-black/40 bg-panel-2 bg-cover bg-center" style={frames[i] ? { backgroundImage: `url(${frames[i]})` } : undefined} />
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 bg-accent/15" style={{ width: `${pct}%`, transition: "width 0.8s ease" }} />
          <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent shadow-[0_0_12px_rgba(198,243,107,0.9)]" style={{ left: `${pct}%`, transition: "left 0.8s ease" }}>
            <div className="absolute -top-1 -left-[5px] h-2.5 w-3 rounded-b-sm bg-accent" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
