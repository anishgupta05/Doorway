// The robot task, step by step, with the numbers a robotics engineer would ask for.
import { motion } from "framer-motion";
import { useApp } from "../store";
import { sfx } from "../sfx";
import { CELL, ROBOT_RADIUS } from "./planner";
import { goToStep, type useRobotTask } from "./useRobotTask";

const cm = (m: number) => `${Math.round(m * 100)} cm`;

export function RobotPanel({ t }: { t: ReturnType<typeof useRobotTask> }) {
  const { tasks, task, step, plans, finished } = t;
  if (!task || !plans) {
    return (
      <Shell>
        <div className="px-4 py-3 text-[13px] text-muted">This room needs a first pass and at least one improved version to compare.</div>
      </Shell>
    );
  }
  const { p0, p1, hit, blocker, opened0, opened1 } = plans;
  const doorNote = (ids: string[]) =>
    ids.length ? <div className="mt-1 font-mono text-[10.5px] text-muted">{ids.join(", ")} was closed: opened it first, waiting clear of the swing</div> : null;
  const steps: { n: 1 | 2 | 3; title: string; sub: string; result: React.ReactNode }[] = [
    {
      n: 1,
      title: "Plan in the first-pass room",
      sub: "What a robot would do with the one-pass reconstruction.",
      result: p0.ok ? (
        <>
          <Metrics items={[["path", `${p0.length.toFixed(2)} m`], ["tightest gap", cm(p0.minGap)], ["planned in", `${p0.ms.toFixed(1)} ms`]]} good />
          {doorNote(opened0)}
        </>
      ) : (
        <Bad>{p0.reason}</Bad>
      ),
    },
    {
      n: 2,
      title: "Run that plan in the verified room",
      sub: "The same route, against the room as it really is.",
      result: !p0.ok ? (
        <Bad>No plan to run.</Bad>
      ) : hit ? (
        <Bad>
          Collides with <span className="font-mono">{hit.what}</span> after {hit.distance.toFixed(2)} m
        </Bad>
      ) : (
        <Good>Still safe in the real room.</Good>
      ),
    },
    {
      n: 3,
      title: "Replan in the verified room",
      sub: "What the robot does once the replica is checked.",
      result: p1.ok ? (
        <>
          <Metrics items={[["path", `${p1.length.toFixed(2)} m`], ["tightest gap", cm(p1.minGap)], ["planned in", `${p1.ms.toFixed(1)} ms`]]} good />
          {doorNote(opened1)}
        </>
      ) : (
        <Good>
          No safe path: <span className="font-mono">{blocker}</span> is in the way. The robot knows <span className="text-fg">before it moves</span>.
        </Good>
      ),
    },
  ];
  return (
    <Shell>
      <div className="border-b border-line px-4 pt-3 pb-2.5">
        <div className="mb-2 font-mono text-[10px] tracking-[0.16em] text-muted uppercase">Task</div>
        <div className="flex flex-wrap gap-1.5">
          {tasks.map((x) => (
            <button
              key={x.id}
              onClick={() => {
                sfx.tick();
                useApp.setState({ robotTask: x.id, robotDone: {} });
                goToStep(0);
              }}
              className={`rounded-full border px-2.5 py-1 text-[12px] transition ${x.id === task.id ? "border-accent/70 bg-accent/10 text-fg" : "border-line text-muted hover:text-fg"}`}
            >
              {x.label.replace("Drive in and reach ", "Reach ")}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1 p-2">
        {steps.map((s) => {
          const active = step === s.n;
          const shown = step > s.n || (active && finished) || (active && s.n === 3 && !p1.ok);
          return (
            <button
              key={s.n}
              onClick={() => {
                sfx.whoosh();
                useApp.setState((st) => ({ robotDone: { ...st.robotDone, [`${task.id}-${s.n}`]: false } }));
                goToStep(s.n);
              }}
              className={`rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-accent/50 bg-panel-2" : "border-transparent hover:bg-panel"}`}
            >
              <div className="flex items-baseline gap-2">
                <span className={`font-mono text-[11px] ${active ? "text-accent" : "text-dim"}`}>{s.n}</span>
                <span className={`text-[13px] ${active ? "text-fg" : "text-muted"}`}>{s.title}</span>
              </div>
              {active && <div className="mt-0.5 pl-5 text-[11.5px] text-dim">{s.sub}</div>}
              {shown && <div className="mt-1.5 pl-5">{s.result}</div>}
            </button>
          );
        })}
      </div>
      <div className="border-t border-line px-4 py-2 font-mono text-[10px] text-dim">
        A* on a {Math.round(CELL * 100)} cm grid · robot radius {cm(ROBOT_RADIUS)} · Enter: next step · P: close
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ x: -30, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -30, opacity: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 28 }}
      className="absolute top-20 left-5 z-20 w-[360px] overflow-hidden rounded-2xl border border-line bg-ink/90 shadow-2xl backdrop-blur-md"
    >
      <div className="flex items-center justify-between px-4 pt-3">
        <div className="text-sm font-medium">Robot task</div>
        <div className="font-mono text-[10px] text-muted">planning in the replica</div>
      </div>
      {children}
    </motion.div>
  );
}

const Metrics = ({ items, good }: { items: [string, string][]; good?: boolean }) => (
  <div className="flex gap-4">
    {items.map(([k, v]) => (
      <div key={k}>
        <div className={`font-mono text-[13px] tabular ${good ? "text-accent" : "text-fg"}`}>{v}</div>
        <div className="font-mono text-[9px] tracking-wider text-dim uppercase">{k}</div>
      </div>
    ))}
  </div>
);
const Bad = ({ children }: { children: React.ReactNode }) => <div className="text-[12.5px] text-bad">✗ {children}</div>;
const Good = ({ children }: { children: React.ReactNode }) => <div className="text-[12.5px] text-accent">✓ {children}</div>;
