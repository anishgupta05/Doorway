// The selected physics-trained task: its job (polled while the agents work), the current
// attempt's training curve, and, once it passes, the replay data for the stage.
import { useMemo } from "react";
import { useApp } from "../store";
import { ACTIVE, getJob, getSpec, getTrainLog, getTrajectory, listTasks, usePoll } from "../data/tasks";

export function useTrained(run: string | null) {
  const sel = useApp((s) => (s.trained && s.trained.run === run ? s.trained.task : null));
  const tasks = usePoll(useMemo(() => (run ? () => listTasks(run) : null), [run]), true, 3000) ?? [];
  const polled = usePoll(useMemo(() => (run && sel ? () => getJob(run, sel) : null), [run, sel]), true, 1000);
  const job = polled && polled.id === sel ? polled : null;
  const live = !!job && ACTIVE.includes(job.status);
  const n = job?.attempts.length ?? 0;
  const log = usePoll(useMemo(() => (run && sel && n ? () => getTrainLog(run, sel, n) : null), [run, sel, n]), live, 1000) ?? [];
  const path = job?.status === "done" ? job.trajectory : undefined;
  const replay = usePoll(
    useMemo(
      () => (run && sel && path ? async () => ({ traj: await getTrajectory(run, sel, path), spec: await getSpec(run, sel, n).catch(() => null) }) : null),
      [run, sel, path, n],
    ),
    false,
  );
  return { sel, job, tasks, log, replay };
}
