import { useEffect, useState } from "react";
import { Issue, RunManifest, Scene } from "@doorway/schema";
import { iterFor, runIdFor, useApp, type RunIndex } from "../store";

export const runUrl = (runId: string, rel: string) => `/runs/${runId}/${rel}`;

async function getJson(url: string) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

const sceneCache = new Map<string, Promise<Scene>>();
export function loadScene(runId: string, rel: string) {
  const url = runUrl(runId, rel);
  let p = sceneCache.get(url);
  if (!p) {
    p = getJson(url).then((j) => Scene.parse(j));
    p.catch(() => sceneCache.delete(url));
    sceneCache.set(url, p);
  }
  return p;
}

export async function loadIssues(runId: string, rel: string | null) {
  if (!rel) return [];
  try {
    return Issue.array().parse(await getJson(runUrl(runId, rel)));
  } catch {
    return [];
  }
}

/** Loads runs/index.json and both manifests; polls while a run is still in progress. */
export function useRunData() {
  const { setIndex, setManifest } = useApp.getState();
  const index = useApp((s) => s.index);

  useEffect(() => {
    const want = new URLSearchParams(location.search).get("run");
    getJson("/runs/index.json")
      .then((j) => setIndex(want ? { ...(j as RunIndex), live: want } : (j as RunIndex)))
      .catch((e) => {
        console.error("runs/index.json", e);
        useApp.setState({ loadError: true });
      });
  }, [setIndex]);

  useEffect(() => {
    if (!index) return;
    let stop = false;
    const ids = [...new Set([index.live, index.backup])];
    const tick = async () => {
      let running = false;
      for (const id of ids) {
        try {
          const m = RunManifest.parse(await getJson(runUrl(id, "manifest.json")));
          if (id === index.live) useApp.setState({ loadError: false });
          getJson(runUrl(id, "meta.json"))
            .then((meta) => meta?.name && useApp.setState((s) => ({ names: { ...s.names, [id]: String(meta.name) } })))
            .catch(() => {});
          const prev = useApp.getState().manifests[id];
          if (!prev || JSON.stringify(prev) !== JSON.stringify(m)) setManifest(id, m);
          running ||= m.status === "running";
        } catch (e) {
          console.error(`manifest ${id}`, e);
          if (id === index.live) useApp.setState({ loadError: true });
        }
      }
      if (!stop && running) setTimeout(tick, 3000);
    };
    tick();
    return () => void (stop = true);
  }, [index, setManifest]);
}

/** The scene (and its open issues) the stage should currently show. */
export function useCurrentScene() {
  const version = useApp((s) => s.version);
  const index = useApp((s) => s.index);
  const iterOverride = useApp((s) => s.iter);
  const runId = runIdFor(version, index);
  const manifest = useApp((s) => (runId ? s.manifests[runId] : undefined));
  const preview = useApp((s) => s.preview);
  const k = preview?.k ?? iterFor(version, manifest, iterOverride);
  const iteration = k !== null ? manifest?.iterations[k] : undefined;
  const branch = iteration?.branches[preview?.i ?? iteration.selected];

  const [state, setState] = useState<{ key: string; scene: Scene; issues: Issue[] } | null>(null);
  const key = runId && branch ? `${runId}/${branch.scene}` : null;

  useEffect(() => {
    if (!runId || !branch || !key) return;
    let live = true;
    Promise.all([loadScene(runId, branch.scene), loadIssues(runId, iteration?.issues ?? null)]).then(
      ([scene, issues]) => live && setState({ key, scene, issues }),
      (e) => console.error(e),
    );
    return () => void (live = false);
  }, [key, runId, branch, iteration?.issues]);

  // Previous scene for before/after diffs: the selected branch of the iteration before this one.
  const prevBranch = k !== null && k > 0 ? manifest?.iterations[k - 1]?.branches[manifest.iterations[k - 1].selected] : undefined;
  const [prev, setPrev] = useState<Scene | null>(null);
  useEffect(() => {
    if (!runId || !prevBranch) return setPrev(null);
    let live = true;
    loadScene(runId, prevBranch.scene).then((s) => live && setPrev(s), () => live && setPrev(null));
    return () => void (live = false);
  }, [runId, prevBranch?.scene]);

  // Previous iteration's issues: whatever is gone now is what this iteration fixed.
  const prevIssuesRel = k !== null && k > 0 ? manifest?.iterations[k - 1]?.issues ?? null : null;
  const [prevIssues, setPrevIssues] = useState<Issue[]>([]);
  useEffect(() => {
    if (!runId || !prevIssuesRel) return setPrevIssues([]);
    let live = true;
    loadIssues(runId, prevIssuesRel).then((i) => live && setPrevIssues(i));
    return () => void (live = false);
  }, [runId, prevIssuesRel]);
  const issues = state?.issues ?? [];
  const issueKey = (i: Issue) => `${i.objectId}|${i.message}`;
  const open = new Set(issues.map(issueKey));
  const fixed = prevIssues.filter((i) => !open.has(issueKey(i)));
  const prevScore = k !== null && k > 0 ? manifest?.iterations[k - 1]?.branches[manifest.iterations[k - 1].selected]?.score : undefined;

  return {
    runId,
    fixed,
    prevScore,
    manifest,
    k,
    iteration,
    branch,
    preview: !!preview,
    scene: state?.scene ?? null,
    prevScene: prev,
    issues,
  };
}
