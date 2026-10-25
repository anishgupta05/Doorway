// The verification loop. Each iteration:
//   render the current scene along the footage's camera path (the viewer's own renderer)
//   → Argon compares footage vs renders and lists issues
//   → Argon proposes N different patches
//   → each branch, in parallel: guards (hooks + interaction tests) → render → Argon re-scores
//   → the best branch survives if it beats the current scene, otherwise the current scene stays.
// Everything is written in the runs/<id> layout the viewer reads, and the manifest is
// rewritten after every iteration with status "running", so the viewer updates live.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { RunManifest, Scene, type Branch, type Issue, type Iteration } from "@doorway/schema";
import { compare, propose, score, type Candidate, type Critique } from "./critique.js";
import { fakeCompare, fakePropose } from "./fake.js";
import { guard, interactionTests, type TestResult } from "./guards.js";
import { uploadVideo, type UploadedVideo } from "./model.js";
import { Renderer, sampleTimes } from "./render.js";

export const RUNS = resolve(import.meta.dirname, "../../../runs");

export type LoopOptions = {
  id: string;
  iters: number;
  branches: number;
  frames: number;
  /** Test the plumbing against runs/<id>/truth.json instead of calling Argon. */
  fake?: boolean;
  log?: (s: string) => void;
};

type Progress = { stage: string; k: number; detail: string; updatedAt: number };

export async function runLoop(o: LoopOptions) {
  const log = o.log ?? console.log;
  const dir = join(RUNS, o.id);
  const v0 = Scene.parse(JSON.parse(readFileSync(join(dir, "scene.v0.json"), "utf8")));
  const truth = o.fake ? Scene.parse(JSON.parse(readFileSync(join(dir, "truth.json"), "utf8"))) : null;
  const videoFile = ["video.mp4", "video.webm"].find((f) => existsSync(join(dir, f))) ?? null;
  if (!o.fake && videoFile !== "video.mp4") throw new Error(`runs/${o.id}/video.mp4 is required (run describe first)`);
  const video: UploadedVideo | undefined = o.fake ? undefined : await uploadVideo(join(dir, "video.mp4"));

  const write = (rel: string, data: unknown) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");
  };
  const progress = (stage: string, k: number, detail: string) => {
    write("progress.json", { stage, k, detail, updatedAt: Date.now() } satisfies Progress);
    log(`[iter ${k}] ${stage}: ${detail}`);
  };

  const manifest: RunManifest = {
    id: o.id,
    title: (o.fake ? "[FAKE MODEL] " : "") + v0.name,
    video: videoFile,
    status: "running",
    iterations: [],
  };
  const saveManifest = () => write("manifest.json", RunManifest.parse(manifest));

  const renderer = await new Renderer().start();
  const times = sampleTimes(v0.camera_path[v0.camera_path.length - 1].t, o.frames);

  const critique = async (scene: Scene, rel: string): Promise<Critique> => {
    const crit = truth ? fakeCompare(truth, scene) : compare({ video: video!, scene, frames: await renderer.frames(o.id, rel, times), times });
    return withTestIssues(await crit, scene);
  };
  // What earlier branches tried and why it failed, so propose does not repeat itself.
  const lessons: string[] = [];

  try {
    // Iteration 0: the one-pass scene from generate.
    progress("compare", 0, "scoring the one-pass scene against the footage");
    write("iter_0/branch_0/scene.json", v0);
    await renderer.thumb(o.id, "iter_0/branch_0/scene.json", join(dir, "iter_0/branch_0/thumb.png"));
    let current = { scene: v0, crit: await critique(v0, "iter_0/branch_0/scene.json") };
    let currentScore = score(current.crit);
    write("iter_0/issues.json", current.crit.issues);
    write("iter_0/branch_0/tests.json", interactionTests(v0));
    manifest.iterations.push({
      k: 0,
      selected: 0,
      issues: "iter_0/issues.json",
      branches: [{ i: 0, score: currentScore, verdict: "pass", reason: null, hypothesis: "One-pass generation from the video", scene: "iter_0/branch_0/scene.json", thumb: "iter_0/branch_0/thumb.png" }],
    });
    saveManifest();
    log(`[iter 0] score ${currentScore}, ${current.crit.issues.length} issues`);

    for (let k = 1; k <= o.iters; k++) {
      if (!current.crit.issues.length) {
        log(`no issues left after iteration ${k - 1}; stopping`);
        break;
      }
      progress("propose", k, `Argon proposing ${o.branches} fixes for ${current.crit.issues.length} issues`);
      const candidates: Candidate[] = truth
        ? fakePropose(truth, current.scene, current.crit.issues, o.branches, k)
        : await propose({ scene: current.scene, issues: current.crit.issues, n: o.branches, video, lessons: lessons.slice(-8) });

      progress("test", k, `${candidates.length} branches: guards, interaction tests, render, re-score`);
      const results = await Promise.all(
        candidates.map(async (c, i): Promise<{ branch: Branch; scene?: Scene; crit?: Critique; tests?: TestResult[] }> => {
          const rel = `iter_${k}/branch_${i}/scene.json`;
          const thumb = `iter_${k}/branch_${i}/thumb.png`;
          const base = { i, hypothesis: c.hypothesis, scene: rel };
          if (!c.patch) {
            write(rel, current.scene);
            return { branch: { ...base, score: 0, verdict: "fail", reason: `Hook: ${c.error}`, thumb: null } };
          }
          const v = guard(current.scene, c.patch);
          write(rel, v.scene ?? current.scene);
          if (v.tests) write(`iter_${k}/branch_${i}/tests.json`, v.tests);
          await renderer.thumb(o.id, rel, join(dir, thumb)).catch(() => {});
          if (!v.ok) return { branch: { ...base, score: 0, verdict: "fail", reason: v.reason, thumb } };
          const crit = await critique(v.scene, rel);
          return { branch: { ...base, score: score(crit), verdict: "pass", reason: null, thumb }, scene: v.scene, crit, tests: v.tests };
        }),
      );

      for (const r of results) {
        if (r.branch.verdict === "fail") lessons.push(`"${r.branch.hypothesis}" was rejected: ${String(r.branch.reason).replace(/\s+/g, " ").slice(0, 160)}`);
        else if (r.branch.score <= currentScore) lessons.push(`"${r.branch.hypothesis}" scored ${r.branch.score} which did not beat ${currentScore}`);
      }
      const passing = results.filter((r) => r.branch.verdict === "pass");
      const best = passing.sort((a, b) => b.branch.score - a.branch.score)[0];
      const branches = results.map((r) => r.branch).sort((a, b) => a.i - b.i);
      let selected: number;
      if (best && best.branch.score > currentScore) {
        selected = best.branch.i;
        current = { scene: best.scene!, crit: best.crit! };
        currentScore = best.branch.score;
      } else {
        // Nothing beat the current scene: it survives, shown as its own card.
        selected = branches.length;
        const rel = `iter_${k}/branch_${selected}/scene.json`;
        write(rel, current.scene);
        copyFileSync(join(dir, manifest.iterations[k - 1].branches[manifest.iterations[k - 1].selected].thumb ?? "iter_0/branch_0/thumb.png"), join(dir, `iter_${k}/branch_${selected}/thumb.png`));
        branches.push({ i: selected, score: currentScore, verdict: "pass", reason: null, hypothesis: "No branch beat the current scene: keep it", scene: rel, thumb: `iter_${k}/branch_${selected}/thumb.png` });
      }
      write(`iter_${k}/issues.json`, current.crit.issues satisfies Issue[]);
      const it: Iteration = { k, selected, issues: `iter_${k}/issues.json`, branches };
      manifest.iterations.push(it);
      saveManifest();
      const rejected = branches.filter((b) => b.verdict === "fail");
      log(`[iter ${k}] score ${currentScore} · ${rejected.length} rejected${rejected.map((b) => `\n         ✗ branch ${b.i}: ${b.reason}`).join("")}`);
    }
    manifest.status = "done";
    saveManifest();
    progress("done", manifest.iterations.length - 1, `final score ${currentScore}`);
  } finally {
    await renderer.stop();
  }
  return manifest;
}

/** Interaction-test failures are issues too: they lower the score and tell propose what to fix. */
function withTestIssues(c: Critique, scene: Scene): Critique {
  const fails = interactionTests(scene)
    .filter((t) => !t.ok)
    .map((t): Issue => ({ objectId: t.id, severity: "high", message: `Interaction test fails: ${t.id} ${t.text}. Fix its hinge side, pivot, range or clearance so it can really be used.` }));
  return { ...c, issues: [...fails, ...c.issues] };
}
