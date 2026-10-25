// Give the robot a job: pick what it should open or switch on (or where to go), in order,
// and run it. Each step shows its route length and live status.
import { useState } from "react";
import { motion } from "framer-motion";
import type { Scene } from "@doorway/schema";
import { useApp } from "../store";
import { sfx } from "../sfx";
import { gridOf } from "../scene/Fronts";
import type { Action } from "./actions";
import type { Mission } from "./mission";

export function RobotTabs() {
  const tab = useApp((s) => s.robotTab);
  return (
    <div className="flex gap-1 rounded-full border border-line p-0.5 font-mono text-[10.5px]">
      {(["mission", "compare"] as const).map((t) => (
        <button
          key={t}
          onClick={() => {
            sfx.tick();
            useApp.setState({ robotTab: t, mission: null, joints: {} });
          }}
          className={`rounded-full px-2.5 py-0.5 transition ${tab === t ? "bg-fg text-ink" : "text-muted hover:text-fg"}`}
        >
          {t === "mission" ? "Give it a job" : "First pass vs verified"}
        </button>
      ))}
    </div>
  );
}

export function MissionPanel({ scene, actions, mission }: { scene: Scene; actions: Action[]; mission: Mission | null }) {
  const queue = useApp((s) => s.missionQueue);
  const run = useApp((s) => s.mission);
  const byId = new Map(actions.map((a) => [a.id, a]));
  const add = (id: string) => {
    sfx.tick();
    useApp.setState((s) => ({ missionQueue: [...s.missionQueue, id], mission: null }));
  };
  const groups = ["Lockers", "Doors & cabinets", "Devices", "Go to"] as const;
  const lockers = scene.objects.filter((o) => actions.some((a) => a.group === "Lockers" && a.target === o.id));

  return (
    <motion.div
      initial={{ x: -30, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -30, opacity: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 28 }}
      className="absolute top-20 bottom-6 left-5 z-20 flex w-[380px] flex-col overflow-hidden rounded-2xl border border-line bg-ink/90 shadow-2xl backdrop-blur-md"
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="text-sm font-medium">Robot</div>
        <RobotTabs />
      </div>

      <Ask scene={scene} actions={actions} />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
        {groups.map((g) => {
          const items = actions.filter((a) => a.group === g);
          if (!items.length) return null;
          return (
            <div key={g} className="mt-3">
              <div className="mb-1.5 font-mono text-[10px] tracking-[0.16em] text-muted uppercase">{g}</div>
              {g === "Lockers" ? (
                lockers.map((o) => {
                  const [cols] = gridOf(o);
                  const cells = items.filter((a) => a.target === o.id);
                  return (
                    <div key={o.id} className="grid w-fit gap-1" style={{ gridTemplateColumns: `repeat(${cols}, 2rem)` }}>
                      {cells.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => add(a.id)}
                          title={a.label}
                          className={`h-7 rounded border font-mono text-[10px] transition ${queue.includes(a.id) ? "border-accent/70 bg-accent/15 text-accent" : "border-line bg-panel text-muted hover:text-fg"}`}
                        >
                          {(a.part ?? 0) + 1}
                        </button>
                      ))}
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {items.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => add(a.id)}
                      className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-muted transition hover:text-fg"
                    >
                      {a.label.replace(/^Open |^Turn on |^Go to /, "")}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-line px-4 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <div className="font-mono text-[10px] tracking-[0.16em] text-muted uppercase">The job ({queue.length} steps)</div>
          {queue.length > 0 && (
            <button className="font-mono text-[10.5px] text-dim hover:text-fg" onClick={() => useApp.setState({ missionQueue: [], mission: null, joints: {} })}>
              clear
            </button>
          )}
        </div>
        {queue.length === 0 && <div className="text-[12.5px] text-dim">Pick things above: the robot will go and open them in order.</div>}
        <ol className="flex max-h-44 flex-col gap-1 overflow-y-auto">
          {queue.map((id, i) => {
            const a = byId.get(id);
            const leg = mission?.legs[i];
            const status = run?.status[i];
            return (
              <li key={`${id}-${i}`} className="flex items-center gap-2 text-[12.5px]">
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-[10px] ${leg && !leg.plan.ok ? "bg-bad text-ink" : "bg-panel-2 text-muted"}`}>{i + 1}</span>
                <span className="flex-1 truncate">{a?.label ?? id}</span>
                <span className="font-mono text-[10.5px] text-dim">
                  {status === "done" ? <span className="text-accent">✓ done</span> : status === "failed" ? <span className="text-bad">✗ can't reach</span> : status === "driving" ? "driving…" : status === "acting" ? "opening…" : leg && !leg.plan.ok ? <span className="text-bad">no path</span> : leg ? `${leg.plan.length.toFixed(1)} m` : ""}
                </span>
                {!run && (
                  <button className="text-dim hover:text-fg" onClick={() => useApp.setState((s) => ({ missionQueue: s.missionQueue.filter((_, j) => j !== i) }))}>
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ol>
        <button
          disabled={!queue.length}
          onClick={() => {
            sfx.whoosh();
            useApp.setState({ joints: {}, mission: { key: `${Date.now()}`, current: 0, status: queue.map(() => "pending") } });
          }}
          className="mt-3 w-full rounded-xl bg-accent py-2 text-[13px] font-medium text-ink transition disabled:opacity-30"
        >
          {run ? "Run again" : "Run the job"}
        </button>
        {mission && queue.length > 0 && (
          <div className="mt-2 font-mono text-[10px] text-dim">
            {mission.total.toFixed(1)} m in total · A* on the replica · stands clear of every door's swing
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** Plain-language job: Argon turns the sentence into steps from this room's actions, then the robot runs them. */
function Ask({ scene, actions }: { scene: Scene; actions: Action[] }) {
  const apiOk = useApp((s) => s.apiOk);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  if (!apiOk) return null;
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setReply(null);
    sfx.tick();
    try {
      const r = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          room: scene.name,
          actions: actions.map(({ id, label, group }) => ({ id, label, group })),
          objects: scene.objects.filter((o) => !o.decor).map((o) => ({ id: o.id, label: o.label ?? o.type, position: o.position })),
        }),
      });
      const out = (await r.json()) as { steps?: string[]; reply?: string; error?: string };
      if (!r.ok || !out.steps) throw new Error(out.error ?? "no plan");
      setReply(out.reply ?? null);
      // Queue the steps and set off straight away.
      useApp.setState({ missionQueue: out.steps, joints: {}, mission: out.steps.length ? { key: `${Date.now()}`, current: 0, status: out.steps.map(() => "pending") } : null });
      sfx.whoosh();
    } catch {
      setReply("Sorry, I couldn't work that out. Try naming what to open.");
      sfx.reject();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-y border-line bg-panel/60 px-4 py-3">
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation(); // typing must not trigger the demo hotkeys
            if (e.key === "Enter") void send();
          }}
          placeholder="Tell the robot what to do…"
          className="min-w-0 flex-1 rounded-lg border border-line bg-ink px-3 py-2 text-[13px] text-fg outline-none placeholder:text-dim focus:border-accent/60"
        />
        <button onClick={() => void send()} disabled={busy || !text.trim()} className="rounded-lg bg-accent px-3 text-[12.5px] font-medium text-ink disabled:opacity-40">
          {busy ? "Thinking…" : "Go"}
        </button>
      </div>
      {reply && <div className="mt-2 text-[12.5px] text-muted">🤖 {reply}</div>}
      {!reply && !busy && <div className="mt-1.5 font-mono text-[10px] text-dim">e.g. "open the top-left locker, then turn on the printer"</div>}
    </div>
  );
}
