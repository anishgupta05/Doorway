// Guard hooks the loop runs on every branch before it spends a model call on it.
import { deletedIds, type Scene } from "@doorway/schema";

/** Guard hooks that need no renderer. Render-based checks can be added to this list. */
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
  // An added or resized object must stay furniture-sized: the loop once "fixed" a score by adding a 4.4 m partition that hid the room.
  const limit = 0.75 * Math.min(child.room.width, child.room.depth);
  for (const o of child.objects) {
    const before = parent.objects.find((x) => x.id === o.id);
    // A thin decor panel (whiteboard, mural, poster) is a wall surface, not furniture: it may span a wall.
    if (o.decor && Math.min(...o.size) <= 0.1) continue;
    const longest = Math.max(o.size[0], o.size[2]);
    // Only new objects and objects that got longer count: an already-long desk must not doom every patch that touches it.
    if (before && longest <= Math.max(before.size[0], before.size[2])) continue;
    if (longest > limit) return `Hook: ${o.id} is ${longest.toFixed(1)} m long, over ${limit.toFixed(1)} m (75% of the room): too big to be furniture`;
  }
  if (child.interactions.length < parent.interactions.length) return "Hook: removed an interaction";
  return null;
}
