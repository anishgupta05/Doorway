// One branch of the loop: apply a proposed patch to the parent scene, run the hooks, then score it.
import { applyPatch, deletedIds, type Scene } from "@doorway/schema";
import type { Description } from "./describe.js";
import type { UploadedVideo } from "./model.js";
import { compareScene, type Comparison } from "./compare.js";
import type { Proposal } from "./fixes.js";

export interface BranchResult {
  ok: boolean;
  /** Human-readable rejection, shown verbatim in the viewer ("Hook: deleted chair_2"). */
  reason: string | null;
  hypothesis: string;
  scene: Scene | null;
  comparison: Comparison | null;
}

/** Guard hooks that need no renderer. Person 3's render-based checks can be added to this list. */
export function guards(parent: Scene, child: Scene): string | null {
  const gone = deletedIds(parent, child);
  if (gone.length) return `Hook: deleted ${gone.join(", ")}`;
  for (const o of parent.objects) {
    const c = child.objects.find((x) => x.id === o.id);
    if (o.articulation && c?.articulation?.kind !== o.articulation.kind) return `Hook: ${o.id} lost its ${o.articulation.kind}`;
    if (o.articulation?.kind === "hinge" && c?.articulation?.kind === "hinge" && c.articulation.range[0] === c.articulation.range[1]) {
      return `Interaction test: ${o.id} no longer opens (range collapsed to 0)`;
    }
  }
  if (child.interactions.length < parent.interactions.length) return "Hook: removed an interaction";
  return null;
}

export async function evaluateBranch(parent: Scene, p: Proposal, description: Description, video?: UploadedVideo): Promise<BranchResult> {
  let child: Scene;
  try {
    child = applyPatch(parent, p.patch); // schema + checkScene (sizes, duplicate ids, dangling interactions...)
  } catch (e) {
    return { ok: false, reason: `Hook: ${(e as Error).message.split("\n")[0].slice(0, 140)}`, hypothesis: p.hypothesis, scene: null, comparison: null };
  }
  const bad = guards(parent, child);
  if (bad) return { ok: false, reason: bad, hypothesis: p.hypothesis, scene: child, comparison: null };
  const comparison = await compareScene(child, description, video);
  return { ok: true, reason: null, hypothesis: p.hypothesis, scene: child, comparison };
}
