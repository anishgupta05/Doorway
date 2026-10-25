// "Train it in physics": type a task, and three agents take it from there. The clarifier
// checks it's something this robot can physically do, the trainer runs PPO in the MuJoCo
// export of this room, the verifier tests it from 10 starts. A passing task replays in the room.
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { Scene } from "@doorway/schema";
import { useApp } from "../store";
import { sfx } from "../sfx";
import { ACTIVE, startTask, type TaskJob, type TaskStatus, type TrainPoint } from "../data/tasks";
import type { useTrained } from "./useTrained";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const DOT: Record<TaskStatus, string> = {
  clarifying: "bg-warn", training: "bg-warn", verifying: "bg-warn", done: "bg-accent", failed: "bg-bad", rejected: "bg-bad", asking: "bg-muted", error: "bg-bad",
};

/** A few tasks this room can actually support, as starting points. */
function suggestions(scene: Scene) {
  const name = (id: string) => (scene.objects.find((o) => o.id === id)?.label ?? id).toLowerCase();
  const out: string[] = [];
  if (scene.objects.some((o) => o.type === "door" && o.articulation?.kind === "hinge")) out.push("Open the door");
  const loose = scene.objects.filter((o) => !o.decor && (o.articulation?.kind === "free" || (!o.articulation && o.physics?.body === "dynamic")));
  const fixed = scene.objects.filter((o) => !o.decor && o.type !== "door" && o.type !== "rug" && o.type !== "partition" && !loose.includes(o));
  if (loose[0]) {
    const other = loose[1] ?? fixed[0];
    if (other) out.push(`Push the ${name(loose[0].id)} next to the ${name(other.id)}`);
  }
  if (fixed[0]) out.push(`Drive to the ${name(fixed[0].id)}`);
  out.push("Turn on the lamp");
  return out;
}

export function TrainPanel({ run, scene, t }: { run: string; scene: Scene; t: ReturnType<typeof useTrained> }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ideas = useMemo(() => suggestions(scene), [scene]);
  const go = async (request: string) => {
    if (!request.trim()) return;
    setError(null);
    sfx.tick();
    try {
      const { id } = await startTask(run, request);
      useApp.setState({ trained: { run, task: id } });
      setText("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const pick = (task: string) => {
    sfx.tick();
    useApp.setState((s) => ({ trained: { run, task }, trainedNonce: s.trainedNonce + 1 }));
  };

  return (
    <motion.div
      initial={{ x: 30, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 30, opacity: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 28 }}
      className="absolute top-20 right-5 z-20 w-[350px] overflow-hidden rounded-2xl border border-line bg-ink/90 shadow-2xl backdrop-blur-md"
    >
      <div className="flex items-center justify-between px-4 pt-3">
        <div className="text-sm font-medium">Train it in physics</div>
        <div className="font-mono text-[10px] text-muted">MuJoCo · PPO on this laptop</div>
      </div>
      <form
        className="flex gap-2 px-4 pt-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          go(text);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Tell the robot what to do…"
          className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px] text-fg outline-none placeholder:text-dim focus:border-accent/60"
        />
        <button type="submit" disabled={!text.trim()} className="rounded-lg bg-accent px-3 text-[12px] font-semibold text-ink transition enabled:hover:brightness-110 disabled:opacity-40">
          Train
        </button>
      </form>
      <div className="flex flex-wrap gap-1.5 px-4 pt-2 pb-3">
        {ideas.map((x) => (
          <button key={x} onClick={() => go(x)} className="rounded-full border border-line px-2.5 py-0.5 text-[11.5px] text-muted transition hover:text-fg">
            {x}
          </button>
        ))}
      </div>
      {error && <div className="border-t border-line px-4 py-2 text-[12px] text-bad">{error}</div>}

      {t.tasks.length > 0 && (
        <div className="border-t border-line px-4 py-2.5">
          <div className="mb-1.5 font-mono text-[10px] tracking-[0.16em] text-muted uppercase">Tasks in this room</div>
          <div className="flex max-h-[92px] flex-col gap-0.5 overflow-y-auto">
            {t.tasks.map((x) => (
              <button
                key={x.id}
                onClick={() => pick(x.id)}
                className={`flex items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] transition ${x.id === t.sel ? "bg-panel-2 text-fg" : "text-muted hover:bg-panel hover:text-fg"}`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[x.status]}`} />
                <span className="truncate">{x.summary ?? x.request}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {t.job && <JobView job={t.job} log={t.log} />}
    </motion.div>
  );
}

function JobView({ job, log }: { job: TaskJob; log: TrainPoint[] }) {
  const c = job.clarification;
  const attempt = job.attempts[job.attempts.length - 1];
  const stage = (s: TaskStatus) => (job.status === s ? "active" : ACTIVE.indexOf(job.status) > ACTIVE.indexOf(s) || job.status === "done" || job.status === "failed" ? "done" : "todo");
  const by = (b?: string) => (b ? <span className="ml-1 font-mono text-[9.5px] text-dim">{b}</span> : null);
  return (
    <div className="border-t border-line px-4 py-3">
      <div className="text-[13px] text-fg">{c?.decision === "do" ? c.summary : `“${job.request}”`}</div>
      <div className="mt-2.5 flex flex-col gap-1.5">
        <Agent n={1} name="Clarifier" state={job.status === "rejected" || job.status === "asking" ? "stopped" : stage("clarifying")}>
          {job.status === "rejected" && <span className="text-bad">✗ {job.message}</span>}
          {job.status === "asking" && <span className="text-warn">? {job.message}</span>}
          {c?.decision === "do" && (
            <span>
              {c.type?.replace("_", " ")} · <span className="font-mono">{c.object}</span>
              {c.near ? <> → <span className="font-mono">{c.near}</span></> : null}
              {by(c.by)}
            </span>
          )}
        </Agent>
        {c?.decision === "do" && (
          <>
            <Agent n={2} name="Trainer" state={stage("training")}>
              {attempt && (
                <span>
                  attempt {attempt.n} · {(attempt.plan.train_steps / 1000).toFixed(0)}k steps max{by(attempt.plan.by)}
                </span>
              )}
            </Agent>
            {log.length > 0 && <Curve log={log} />}
            <Agent n={3} name="Verifier" state={stage("verifying")}>
              {attempt?.judgement && (
                <span className={attempt.judgement.pass ? "text-accent" : "text-bad"}>
                  {attempt.judgement.pass ? "✓" : "✗"} {pct(attempt.judgement.success_rate)} of 10 test runs{by(attempt.judgement.by)}
                </span>
              )}
            </Agent>
          </>
        )}
      </div>
      <div className={`mt-2.5 text-[12px] leading-snug ${job.status === "done" ? "text-accent" : job.status === "failed" || job.status === "error" ? "text-bad" : "text-muted"}`}>
        {job.status === "rejected" || job.status === "asking" ? null : job.message}
      </div>
      {job.status === "done" && (
        <button
          onClick={() => {
            sfx.whoosh();
            useApp.setState((s) => ({ trainedNonce: s.trainedNonce + 1 }));
          }}
          className="mt-2 rounded-full border border-accent/60 px-3 py-1 text-[12px] text-accent transition hover:bg-accent/10"
        >
          ↻ Replay in the room
        </button>
      )}
    </div>
  );
}

function Agent({ n, name, state, children }: { n: number; name: string; state: "todo" | "active" | "done" | "stopped"; children?: React.ReactNode }) {
  const mark = state === "done" ? "✓" : state === "active" ? "…" : state === "stopped" ? "■" : String(n);
  return (
    <div className="flex items-baseline gap-2 text-[12px]">
      <span className={`w-3 shrink-0 font-mono text-[11px] ${state === "done" ? "text-accent" : state === "active" ? "text-warn" : "text-dim"}`}>{mark}</span>
      <span className={`w-[62px] shrink-0 ${state === "todo" ? "text-dim" : "text-fg"}`}>{name}</span>
      <span className="min-w-0 text-muted">{children}</span>
    </div>
  );
}

/** Success rate of training episodes as PPO learns. */
function Curve({ log }: { log: TrainPoint[] }) {
  const w = 290;
  const h = 46;
  const max = log[log.length - 1].steps || 1;
  const pts = log.map((p) => `${(p.steps / max) * (w - 6) + 3},${h - 4 - p.success_rate * (h - 10)}`).join(" ");
  const last = log[log.length - 1];
  return (
    <div className="ml-5 rounded-lg border border-line bg-panel/60 px-2 py-1.5">
      <svg width={w} height={h} className="block overflow-visible">
        <line x1={3} x2={w - 3} y1={6} y2={6} stroke="var(--color-line)" strokeDasharray="2 3" />
        <polyline points={pts} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" />
      </svg>
      <div className="mt-0.5 flex justify-between font-mono text-[9.5px] text-dim">
        <span>{(last.steps / 1000).toFixed(0)}k steps · {last.elapsed_s.toFixed(0)} s</span>
        <span className="text-accent">{pct(last.success_rate)} succeeding</span>
      </div>
    </div>
  );
}
