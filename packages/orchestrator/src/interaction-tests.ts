// Interaction tests: does the scene *behave* right, not just look right?
// Every hinge must sweep its full range and every drawer must slide out without
// hitting a wall or another object's footprint. The loop rejects branches that fail.
// (Patch-level hooks such as "no deleted objects" live in branch.ts.)
import type { Scene, SceneObject } from "@doorway/schema";

export type TestResult = { id: string; ok: boolean; text: string };

/** Types that block movement. Rugs, lamps and monitors sit on or under things. */
const SOLID = new Set<SceneObject["type"]>(["table", "chair", "cabinet", "shelf", "sofa", "bed", "plant", "box", "partition", "other"]);

type Box = { id: string; cx: number; cz: number; hw: number; hd: number; rot: number };

const footprint = (o: SceneObject): Box => ({ id: o.id, cx: o.position[0], cz: o.position[2], hw: o.size[0] / 2, hd: o.size[2] / 2, rot: o.rotationY });

/** Object-local → world, matching three.js rotation about +y. */
function toWorld(o: SceneObject, lx: number, lz: number): [number, number] {
  const c = Math.cos(o.rotationY);
  const s = Math.sin(o.rotationY);
  return [o.position[0] + lx * c + lz * s, o.position[2] - lx * s + lz * c];
}

function inside(b: Box, x: number, z: number, margin = 0) {
  const c = Math.cos(-b.rot);
  const s = Math.sin(-b.rot);
  const lx = (x - b.cx) * c + (z - b.cz) * s;
  const lz = -(x - b.cx) * s + (z - b.cz) * c;
  return Math.abs(lx) < b.hw - margin && Math.abs(lz) < b.hd - margin;
}

export function interactionTests(scene: Scene): TestResult[] {
  const { width, depth } = scene.room;
  const inRoom = (x: number, z: number) => Math.abs(x) <= width / 2 + 0.02 && Math.abs(z) <= depth / 2 + 0.02;
  const out: TestResult[] = [];
  for (const o of scene.objects) {
    const a = o.articulation;
    if (!a) continue;
    // Anything this object could hit: solid things on the floor, except itself and what it's mounted in.
    const obstacles = scene.objects
      .filter((x) => x.id !== o.id && SOLID.has(x.type) && x.position[1] < 1.2)
      .filter((x) => !(o.type === "drawer" && x.type === "cabinet" && inside(footprint(x), o.position[0], o.position[2])))
      .map(footprint);

    if (a.kind === "hinge") {
      const [lo, hi] = a.range;
      const sweep = Math.abs(hi - lo);
      if (sweep < (60 * Math.PI) / 180) {
        out.push({ id: o.id, ok: false, text: `swings only ${Math.round((sweep * 180) / Math.PI)}°` });
        continue;
      }
      // The free edge of the door, swept from closed to open.
      const len = o.size[0];
      const dir = a.pivot[0] <= 0 ? 1 : -1;
      let hit: string | null = null;
      for (let i = 1; i <= 24 && !hit; i++) {
        const ang = lo + ((hi - lo) * i) / 24;
        for (const f of [0.35, 0.7, 1]) {
          const lx = a.pivot[0] + dir * len * f * Math.cos(ang);
          const lz = a.pivot[2] - dir * len * f * Math.sin(ang);
          // Doors face out (local +z): beyond their own wall is the corridor, not furniture.
          if (o.type === "door" && lz > 0.01) continue;
          const [x, z] = toWorld(o, lx, lz);
          if (!inRoom(x, z)) hit = "the wall";
          const b = obstacles.find((ob) => inside(ob, x, z, 0.02));
          if (b) hit = b.id;
          if (hit) break;
        }
      }
      out.push(hit ? { id: o.id, ok: false, text: `hits ${hit} while opening` } : { id: o.id, ok: true, text: `swings ${Math.round((sweep * 180) / Math.PI)}° clear` });
    } else if (a.kind === "slide") {
      const travel = Math.max(...a.range.map(Math.abs));
      if (travel < 0.1) {
        out.push({ id: o.id, ok: false, text: "slides less than 10 cm" });
        continue;
      }
      const [x, z] = toWorld(o, a.axis[0] * travel, o.size[2] / 2 + a.axis[2] * travel);
      const b = obstacles.find((ob) => inside(ob, x, z, 0.02));
      out.push(b ? { id: o.id, ok: false, text: `hits ${b.id} when pulled out` } : { id: o.id, ok: true, text: `slides ${Math.round(travel * 100)} cm clear` });
    } else if (a.kind === "switch") {
      out.push(o.light || o.type === "monitor" ? { id: o.id, ok: true, text: "switches" } : { id: o.id, ok: false, text: "switch with no light" });
    }
  }
  return out;
}
