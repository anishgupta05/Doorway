// Which wall (if any) an object belongs to, so it can hide together with that wall in the cutaway view.
// Anything within WALL_BAND (10 cm) of a wall plane belongs to it; decor resting on such an object follows it.
import type { Scene, SceneObject } from "@doorway/schema";

const WALL_BAND = 0.1;

export function wallOf(scene: Scene): Map<string, string> {
  const { width: W, depth: D } = scene.room;
  const out = new Map<string, string>();
  const nearest = (o: SceneObject) => {
    const c = Math.abs(Math.cos(o.rotationY)), s = Math.abs(Math.sin(o.rotationY));
    const hx = (o.size[0] * c + o.size[2] * s) / 2, hz = (o.size[0] * s + o.size[2] * c) / 2;
    const gaps: [string, number][] = [
      ["west", o.position[0] - hx + W / 2], ["east", W / 2 - (o.position[0] + hx)],
      ["north", o.position[2] - hz + D / 2], ["south", D / 2 - (o.position[2] + hz)],
    ];
    return gaps.reduce((a, b) => (b[1] < a[1] ? b : a));
  };
  for (const o of scene.objects) {
    if (o.decor) continue;
    const [wall, gap] = nearest(o);
    if (gap < WALL_BAND) out.set(o.id, wall);
  }
  // Decor on top of something inherits that thing's wall.
  for (const o of scene.objects.filter((x) => x.decor)) {
    for (const p of scene.objects) {
      const wall = out.get(p.id);
      if (!wall || p === o || p.decor) continue;
      const dx = o.position[0] - p.position[0], dz = o.position[2] - p.position[2];
      const lx = dx * Math.cos(p.rotationY) - dz * Math.sin(p.rotationY), lz = dx * Math.sin(p.rotationY) + dz * Math.cos(p.rotationY);
      if (Math.abs(lx) <= p.size[0] / 2 + 0.05 && Math.abs(lz) <= p.size[2] / 2 + 0.05 && Math.abs(o.position[1] - (p.position[1] + p.size[1])) < 0.15) out.set(o.id, wall);
    }
    if (!out.has(o.id)) {
      const [wall, gap] = nearest(o);
      if (gap < WALL_BAND) out.set(o.id, wall);
    }
  }
  return out;
}
