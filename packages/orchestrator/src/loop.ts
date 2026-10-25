// The verification loop, built from Person 2's stages (compare.ts, fixes.ts, branch.ts).
// Each iteration:
//   render the current scene along the footage's camera path (the viewer's own renderer)
//   → Argon compares footage vs scene + renders and lists issues (compareScene)
//   → Argon proposes N different patches, remembering earlier rejections (proposeFixes)
//   → each branch, in parallel: hooks (branch.ts guards) → interaction tests → render → Argon re-scores
//   → the best branch survives if it beats the current scene, otherwise the current scene stays.
// Everything is written in the runs/<id> layout the viewer reads, and the manifest is
// rewritten after every iteration with status "running", so the viewer updates live.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { RunManifest, Scene, applyPatch, type Branch, type Issue, type Iteration, type Patch } from "@doorway/schema";
import { compareScene, type Comparison } from "./compare.js";
import { proposeFixes, type Proposal } from "./fixes.js";
import { guards } from "./branch.js";
import type { Description } from "./describe.js";
import { fakeCompare, fakePropose } from "./fake.js";
import { normalizeColors, resolveLayout, toHex } from "./generate.js";
import { interactionTests, type TestResult } from "./interaction-tests.js";
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
  // Repair what is safe to repair, so guards judge each fix on what *it* changes.
  const v0 = repairScene(Scene.parse(JSON.parse(readFileSync(join(dir, "scene.v0.json"), "utf8"))));
  const truth = o.fake ? Scene.parse(JSON.parse(readFileSync(join(dir, "truth.json"), "utf8"))) : null;
  const videoFile = ["video.mp4", "video.webm"].find((f) => existsSync(join(dir, f))) ?? null;
  if (!o.fake && videoFile !== "video.mp4") throw new Error(`runs/${o.id}/video.mp4 is required (run describe first)`);
  const video: UploadedVideo | undefined = o.fake ? undefined : await uploadVideo(join(dir, "video.mp4"));
  const description: Description | null = o.fake ? null : JSON.parse(readFileSync(join(dir, "description.json"), "utf8"));
  /** Rejected attempts, fed back to proposeFixes so it doesn't repeat them. */
  const lessons: string[] = [];

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

  const critique = async (scene: Scene, rel: string): Promise<Comparison> => {
    if (truth) return withTestIssues(fakeCompare(truth, scene), scene);
    const frames = await renderer.frames(o.id, rel, times);
    return withTestIssues(await compareScene(scene, description!, video, { frames, times }), scene);
  };

  try {
    // Iteration 0: the one-pass scene from generate.
    progress("compare", 0, "scoring the one-pass scene against the footage");
    write("iter_0/branch_0/scene.json", v0);
    await renderer.thumb(o.id, "iter_0/branch_0/scene.json", join(dir, "iter_0/branch_0/thumb.png"));
    let current = { scene: v0, crit: await critique(v0, "iter_0/branch_0/scene.json") };
    let currentScore = current.crit.score;
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
      const candidates: Proposal[] = truth
        ? fakePropose(truth, current.scene, current.crit.issues, o.branches, k)
        : await proposeFixes(current.scene, current.crit, o.branches, lessons, video);

      progress("test", k, `${candidates.length} branches: guards, interaction tests, render, re-score`);
      const results = await Promise.all(
        candidates.map(async (c, i): Promise<{ branch: Branch; scene?: Scene; crit?: Comparison; tests?: TestResult[] }> => {
          const rel = `iter_${k}/branch_${i}/scene.json`;
          const thumb = `iter_${k}/branch_${i}/thumb.png`;
          const base = { i, hypothesis: c.hypothesis, scene: rel };
          const reject = (reason: string, scene: Scene = current.scene) => {
            write(rel, scene);
            lessons.push(`${c.hypothesis} → rejected: ${reason}`);
            return renderer
              .thumb(o.id, rel, join(dir, thumb))
              .catch(() => {})
              .then(() => ({ branch: { ...base, score: 0, verdict: "fail" as const, reason, thumb } }));
          };
          c.patch = repairPatch(c.patch);
          const deleted = deletedByPatch(current.scene, c.patch);
          if (deleted.length) return reject(`Hook: deleted ${deleted.join(", ")}`);
          let child: Scene;
          try {
            child = applyPatch(current.scene, c.patch, (sc) => { resolveLayout(sc); }); // small overlaps are nudged apart, not rejected
          } catch (e) {
            return reject(`Hook: ${readableError(e as Error)}`);
          }
          const hook = guards(current.scene, child);
          if (hook) return reject(hook, child);
          const tests = interactionTests(child);
          write(`iter_${k}/branch_${i}/tests.json`, tests);
          // A scene that already fails a test (e.g. the one-pass door clips a wall) must not doom every patch:
          // only a failure the parent did not have rejects the branch.
          const alreadyFailing = new Set(interactionTests(current.scene).filter((t) => !t.ok).map((t) => t.id));
          const failed = tests.find((t) => !t.ok && !alreadyFailing.has(t.id));
          if (failed) return reject(`Interaction test: ${failed.id} ${failed.text}`, child);
          write(rel, child);
          await renderer.thumb(o.id, rel, join(dir, thumb)).catch(() => {});
          const crit = await critique(child, rel);
          return { branch: { ...base, score: crit.score, verdict: "pass", reason: null, thumb }, scene: child, crit, tests };
        }),
      );

      for (const r of results) if (r.branch.verdict === "pass" && r.branch.score <= currentScore) lessons.push(`${r.branch.hypothesis} → scored ${r.branch.score}, which did not beat ${currentScore}`);
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

/** Object removals, named plainly before their side effects (dangling interactions) can mask them. */
function deletedByPatch(scene: Scene, patch: Patch): string[] {
  return patch
    .map((op) => (op.op === "remove" ? /^\/objects\/(\d+)$/.exec(op.path) : null))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => scene.objects[Number(m[1])]?.id)
    .filter((id): id is string => !!id);
}

/** Interaction-test failures are issues too: they lower the score and tell proposeFixes what to repair. */
function withTestIssues(c: Comparison, scene: Scene): Comparison {
  if (process.env.DOORWAY_TESTISSUES === "0") return c; // experiment: do not treat test failures as issues
  const fails = interactionTests(scene)
    .filter((t) => !t.ok)
    .map((t): Issue => ({ objectId: t.id, severity: "high", message: `Interaction test fails: ${t.id} ${t.text}. Fix its hinge side, pivot, range or clearance so it can really be used.` }));
  if (!fails.length) return c;
  const penalty = Math.min(0.3, fails.length * 0.1);
  return { score: Math.max(0, Number((c.score - penalty).toFixed(3))), issues: [...fails, ...c.issues] };
}

/** Colour names → hex; decor can't move or have physics. Both are safe, mechanical fixes. */
export function repairScene(scene: Scene): Scene {
  const s = structuredClone(scene);
  normalizeColors(s);
  const decor = new Set<string>();
  for (const o of s.objects) {
    if (o.decor) {
      decor.add(o.id);
      delete o.articulation;
      delete o.physics;
    }
  }
  s.interactions = s.interactions.filter((i) => !decor.has(i.target));
  // An interaction must match what its object can do: "toggle" gets a switch, impossible "open"s are dropped.
  const byId = new Map(s.objects.map((o) => [o.id, o]));
  s.interactions = s.interactions.filter((i) => {
    const o = byId.get(i.target);
    if (!o) return false;
    if (i.verb === "toggle" && !o.articulation) o.articulation = { kind: "switch", initial: false };
    // Furniture meant to open but given no joint gets front doors (a hinge), rather than losing the action.
    if (i.verb === "open" && !o.articulation && ["cabinet", "shelf", "box", "other"].includes(o.type)) {
      o.articulation = { kind: "hinge", axis: [0, 1, 0], pivot: [-o.size[0] / 2, 0, o.size[2] / 2], range: [0, 1.6] };
    }
    if (i.verb === "toggle") return o.articulation?.kind === "switch";
    if (i.verb === "open") return o.articulation?.kind === "hinge" || o.articulation?.kind === "slide";
    return true;
  });
  return Scene.parse(s);
}

/** The same colour repair, applied to the values a proposed patch writes. */
function repairPatch(patch: Patch): Patch {
  return patch.map((op) => {
    if (op.value === undefined) return op;
    if (/colou?r$/i.test(op.path) && typeof op.value === "string") return { ...op, value: toHex(op.value) ?? "#c8c6c2" };
    const value = structuredClone(op.value);
    normalizeColors(value);
    return { ...op, value };
  });
}

/** zod errors arrive as a JSON array of issues; turn them into one readable line. */
function readableError(e: Error): string {
  try {
    const issues = JSON.parse(e.message) as { path: (string | number)[]; message: string }[];
    return issues.slice(0, 2).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 160);
  } catch {
    return e.message.split("\n")[0].slice(0, 160);
  }
}
