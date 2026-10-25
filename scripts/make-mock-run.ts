// Generates a realistic fake refinement run from the fixture so the viewer can be
// built before the real loop exists. The fixture is treated as "reality"; v0 is the
// fixture with a set of believable mistakes, and each iteration fixes some of them
// while sibling branches either fix less or get rejected by a guard.
//
// Usage: npx tsx scripts/make-mock-run.ts [runId=mock]
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Scene, RunManifest, type Issue, type Iteration } from "@doorway/schema";

const runId = process.argv[2] ?? "mock";
const root = join(import.meta.dirname, "..");
const outDir = join(root, "runs", runId);
const truth = Scene.parse(JSON.parse(readFileSync(join(root, "fixtures/sample_room.json"), "utf8")));

type Mistake = {
  id: string;
  issue: Issue;
  /** Applies the mistake to a scene (mutates). */
  apply: (s: Scene) => void;
};

const obj = (s: Scene, id: string) => {
  const o = s.objects.find((o) => o.id === id);
  if (!o) throw new Error(`no object ${id}`);
  return o;
};

const mistakes: Mistake[] = [
  {
    id: "door_hinge",
    issue: { objectId: "door_1", message: "Hinge is on the wrong side: door swings toward the wall", severity: "high" },
    apply: (s) => {
      const d = obj(s, "door_1");
      if (d.articulation?.kind === "hinge") {
        d.articulation.pivot = [0.45, 0, 0];
        d.articulation.range = [0, -1.6];
      }
    },
  },
  {
    id: "lamp_missing",
    issue: { objectId: "lamp_1", message: "Desk lamp visible at 0:04 is missing", severity: "high" },
    apply: (s) => {
      s.objects = s.objects.filter((o) => o.id !== "lamp_1");
      s.interactions = s.interactions.filter((i) => i.target !== "lamp_1");
    },
  },
  {
    id: "desk_offset",
    issue: { objectId: "desk_1", message: "Desk sits ~0.4 m too far from the west wall", severity: "medium" },
    apply: (s) => {
      for (const id of ["desk_1", "monitor_1", "lamp_1"]) {
        const o = s.objects.find((o) => o.id === id);
        if (o) o.position = [o.position[0] + 0.4, o.position[1], o.position[2]];
      }
    },
  },
  {
    id: "shelf_short",
    issue: { objectId: "shelf_1", message: "Bookshelf too short: ~1.4 m vs ~1.9 m in footage", severity: "medium" },
    apply: (s) => {
      const o = obj(s, "shelf_1");
      o.size = [o.size[0], 1.4, o.size[2]];
    },
  },
  {
    id: "chair2_pose",
    issue: { objectId: "chair_2", message: "Side chair ~0.7 m off and facing the wrong way", severity: "medium" },
    apply: (s) => {
      const o = obj(s, "chair_2");
      o.position = [o.position[0] + 0.55, 0, o.position[2] + 0.45];
      o.rotationY = 0.4;
    },
  },
  {
    id: "rug_small",
    issue: { objectId: "rug_1", message: "Rug footprint too small", severity: "low" },
    apply: (s) => {
      const o = obj(s, "rug_1");
      o.size = [1.5, o.size[1], 1.0];
    },
  },
  {
    id: "sofa_color",
    issue: { objectId: "sofa_1", message: "Sofa color too blue: footage shows warm grey", severity: "low" },
    apply: (s) => {
      obj(s, "sofa_1").color = "#5c6e8a";
    },
  },
];

// Which mistakes each iteration's surviving branch fixes, plus the sibling branches.
type Sibling = { fixes: string[]; score: number; hypothesis: string } | { fail: string; hypothesis: string; breakWith: (s: Scene) => void };
const schedule: { fixes: string[]; score: number; hypothesis: string; siblings: Sibling[] }[] = [
  {
    fixes: ["door_hinge", "lamp_missing"],
    score: 0.63,
    hypothesis: "Flip door_1 hinge to the left jamb; add lamp_1 on desk",
    siblings: [
      { fixes: ["lamp_missing"], score: 0.55, hypothesis: "Add lamp_1 on desk" },
      {
        fail: "Hook: deleted chair_2",
        hypothesis: "Replace chair_2 + chair_1 with a single bench",
        breakWith: (s) => void (s.objects = s.objects.filter((o) => o.id !== "chair_2")),
      },
    ],
  },
  {
    fixes: ["desk_offset", "shelf_short"],
    score: 0.76,
    hypothesis: "Shift desk group 0.4 m west; stretch shelf_1 to 1.9 m",
    siblings: [
      {
        fail: "Interaction test: door_1 no longer opens (range collapsed to 0)",
        hypothesis: "Re-fit door_1 to opening width",
        breakWith: (s) => {
          const d = obj(s, "door_1");
          if (d.articulation?.kind === "hinge") d.articulation.range = [0, 0];
        },
      },
      { fixes: ["shelf_short"], score: 0.7, hypothesis: "Stretch shelf_1 to 1.9 m" },
    ],
  },
  {
    fixes: ["chair2_pose", "rug_small"],
    score: 0.87,
    hypothesis: "Turn chair_2 toward the sofa and move it 0.7 m in; enlarge rug_1",
    siblings: [
      { fixes: ["rug_small"], score: 0.8, hypothesis: "Enlarge rug_1 to 2.2 × 1.5 m" },
      {
        fail: "Interaction test: chair_1 intersects desk_1 after push",
        hypothesis: "Tuck chair_1 under desk",
        breakWith: (s) => {
          const c = obj(s, "chair_1");
          c.position = [c.position[0], 0, -1.45];
        },
      },
    ],
  },
  {
    fixes: ["sofa_color"],
    score: 0.94,
    hypothesis: "Shift sofa_1 to warm grey #8c8f86",
    siblings: [
      {
        fail: "Interaction test: drawer_1 no longer opens",
        hypothesis: "Merge drawer_1 into cabinet_1 geometry",
        breakWith: (s) => {
          const d = obj(s, "drawer_1");
          delete d.articulation;
        },
      },
      { fixes: [], score: 0.89, hypothesis: "Retint walls slightly warmer" },
    ],
  },
];

const clone = <T>(x: T): T => structuredClone(x);
const build = (remaining: Set<string>): Scene => {
  const s = clone(truth);
  s.name = "Sample office (reconstruction)";
  for (const m of mistakes) if (remaining.has(m.id)) m.apply(s);
  return Scene.parse(s);
};
const issuesFor = (remaining: Set<string>) => mistakes.filter((m) => remaining.has(m.id)).map((m) => m.issue);

const write = (rel: string, data: unknown) => {
  const p = join(outDir, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
};

rmSync(outDir, { recursive: true, force: true });
const iterations: Iteration[] = [];
let remaining = new Set(mistakes.map((m) => m.id));

write("iter_0/branch_0/scene.json", build(remaining));
write("iter_0/issues.json", issuesFor(remaining));
iterations.push({
  k: 0,
  selected: 0,
  issues: "iter_0/issues.json",
  branches: [{ i: 0, score: 0.46, verdict: "pass", reason: null, hypothesis: "One-pass generation from video", scene: "iter_0/branch_0/scene.json", thumb: null }],
});

schedule.forEach((step, idx) => {
  const k = idx + 1;
  const parent = remaining;
  const branches: Iteration["branches"] = [];
  const all = [{ fixes: step.fixes, score: step.score, hypothesis: step.hypothesis }, ...step.siblings];
  // Put the winner in the middle so the UI doesn't always highlight branch 0.
  const order = [1, 0, 2];
  order.forEach((which, i) => {
    const b = all[which];
    const rel = `iter_${k}/branch_${i}/scene.json`;
    if ("fail" in b) {
      const s = build(parent);
      b.breakWith(s);
      write(rel, s);
      branches.push({ i, score: 0, verdict: "fail", reason: b.fail, hypothesis: b.hypothesis, scene: rel, thumb: null });
    } else {
      const next = new Set([...parent].filter((id) => !b.fixes.includes(id)));
      write(rel, build(next));
      branches.push({ i, score: b.score, verdict: "pass", reason: null, hypothesis: b.hypothesis, scene: rel, thumb: null });
    }
  });
  remaining = new Set([...parent].filter((id) => !step.fixes.includes(id)));
  write(`iter_${k}/issues.json`, issuesFor(remaining));
  iterations.push({ k, selected: order.indexOf(0), issues: `iter_${k}/issues.json`, branches });
});

// The "real" footage for the mock: fixtures/room.webm if present (see scripts/record-truth.ts).
const truthVideo = join(root, "fixtures", "room.webm");
const video = existsSync(truthVideo) ? "video.webm" : null;
if (video) copyFileSync(truthVideo, join(outDir, video));
// Ground truth, for recording stand-in footage (scripts/record-truth.ts).
write("truth.json", truth);
const manifest = RunManifest.parse({ id: runId, title: "Sample office", video, status: "done", iterations });
write("manifest.json", manifest);

// runs/index.json tells the viewer which run is "live" and which is the demo backup.
const indexPath = join(root, "runs", "index.json");
if (!existsSync(indexPath)) writeFileSync(indexPath, JSON.stringify({ live: runId, backup: runId }, null, 2) + "\n");

console.log(`wrote runs/${runId}: ${iterations.length} iterations, video: ${video ?? "none"}`);
