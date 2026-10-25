// A stand-in for Argon's compare/propose, for testing the loop's plumbing with no API
// key: "the footage" is a known ground-truth scene (runs/<id>/truth.json). Never used
// for a real run; the CLI labels fake runs in their title.
import type { Issue, Patch, Scene, SceneObject } from "@doorway/schema";
import type { Comparison } from "./compare.js";
import type { Proposal } from "./fixes.js";

function diff(truth: SceneObject, o: SceneObject): Issue[] {
  const out: Issue[] = [];
  const moved = Math.hypot(truth.position[0] - o.position[0], truth.position[2] - o.position[2]);
  if (moved > 0.12) out.push({ objectId: o.id, message: `about ${moved.toFixed(1)} m from where the footage shows it`, severity: moved > 0.4 ? "high" : "medium" });
  if (truth.size.some((s, i) => Math.abs(s - o.size[i]) > 0.1)) out.push({ objectId: o.id, message: `wrong size: footage shows ${truth.size.map((s) => s.toFixed(1)).join("×")} m`, severity: "medium" });
  const turn = Math.abs(Math.atan2(Math.sin(truth.rotationY - o.rotationY), Math.cos(truth.rotationY - o.rotationY)));
  if (turn > 0.3) out.push({ objectId: o.id, message: "facing the wrong way", severity: "medium" });
  if ((truth.color ?? "") !== (o.color ?? "")) out.push({ objectId: o.id, message: "colour doesn't match the footage", severity: "low" });
  if (JSON.stringify(truth.articulation) !== JSON.stringify(o.articulation)) out.push({ objectId: o.id, message: "opens the wrong way", severity: "high" });
  return out;
}

export function fakeCompare(truth: Scene, scene: Scene): Comparison {
  const issues: Issue[] = [];
  for (const t of truth.objects) {
    const o = scene.objects.find((x) => x.id === t.id);
    if (!o) issues.push({ objectId: t.id, message: `${t.label ?? t.type} in the footage is missing`, severity: "high" });
    else issues.push(...diff(t, o));
  }
  return { issues: issues.slice(0, 8), score: Number(Math.max(0.2, 1 - issues.length * 0.08).toFixed(2)) };
}

/** Candidate 0 fixes the top two issues, 1 fixes one, 2 is a deliberately bad patch the guards must catch. */
export function fakePropose(truth: Scene, scene: Scene, issues: Issue[], n: number, k: number): Proposal[] {
  const fix = (issue: Issue): Patch => {
    const t = truth.objects.find((o) => o.id === issue.objectId)!;
    const i = scene.objects.findIndex((o) => o.id === issue.objectId);
    if (i < 0) return [{ op: "add", path: "/objects/-", value: t }];
    return [{ op: "replace", path: `/objects/${i}`, value: t }];
  };
  const ids = [...new Set(issues.map((x) => x.objectId))];
  const first = issues.filter((x) => x.objectId === ids[0]);
  const second = issues.filter((x) => x.objectId === ids[1]);
  const out: Proposal[] = [];
  if (ids[0]) out.push({ hypothesis: `Fix ${ids.slice(0, 2).join(" and ")} to match the footage`, patch: [...fix(first[0]), ...(second[0] ? fix(second[0]) : [])] });
  if (ids[0]) out.push({ hypothesis: `Fix only ${ids[0]}`, patch: fix(first[0]) });
  const victim = scene.objects.findIndex((o) => o.type === "chair");
  const door = scene.objects.findIndex((o) => o.articulation?.kind === "hinge");
  out.push(
    k % 2 && victim >= 0
      ? { hypothesis: "Merge the chairs into one bench", patch: [{ op: "remove", path: `/objects/${victim}` }] }
      : door >= 0
        ? { hypothesis: "Re-fit the door to the opening", patch: [{ op: "replace", path: `/objects/${door}/articulation/range`, value: [0, 0.6] }] }
        : { hypothesis: "Nudge everything 1 m north", patch: [{ op: "replace", path: "/objects/0/position/2", value: -50 }] },
  );
  return out.slice(0, n);
}
