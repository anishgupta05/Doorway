// scene.json → MuJoCo MJCF. Scene space is y-up (three.js); MuJoCo is z-up, so
// (x, y, z) maps to (x, -z, y). Rotations about scene +y become rotations about
// MuJoCo +z with the same angle, because the mapping is a proper rotation.
import type { Opening, Scene, SceneObject, Vec3 } from "@doorway/schema";

const WALL_T = 0.12;
const f = (n: number) => (Math.abs(n) < 1e-9 ? "0" : Number(n.toFixed(4)).toString());
const v = (a: number[]) => a.map(f).join(" ");
/** Scene (y-up) vector → MuJoCo (z-up). */
const mj = ([x, y, z]: Vec3 | number[]) => [x, -z, y];

function rgba(hex: string | undefined, alpha = 1) {
  const h = (hex ?? "#cccccc").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return v([((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha]);
}

function joint(o: SceneObject) {
  const a = o.articulation;
  const damping = o.physics?.damping ?? 1;
  if (!a) return o.physics?.body === "dynamic" ? `<freejoint name="${o.id}_free"/>` : "";
  switch (a.kind) {
    case "hinge": {
      const [lo, hi] = [...a.range].sort((p, q) => p - q);
      return `<joint name="${o.id}_hinge" type="hinge" axis="${v(mj(a.axis))}" pos="${v(mj(a.pivot))}" range="${f(lo)} ${f(hi)}" limited="true" damping="${f(damping)}"/>`;
    }
    case "slide": {
      const [lo, hi] = [...a.range].sort((p, q) => p - q);
      return `<joint name="${o.id}_slide" type="slide" axis="${v(mj(a.axis))}" range="${f(lo)} ${f(hi)}" limited="true" damping="${f(damping)}"/>`;
    }
    case "free":
      return `<freejoint name="${o.id}_free"/>`;
    case "switch":
      return "";
  }
}

function geom(o: SceneObject) {
  const [w, h, d] = o.size;
  const mass = o.physics?.mass;
  const friction = o.physics?.friction ?? 0.5;
  const shape = o.physics?.collider === "cylinder" ? "cylinder" : o.physics?.collider === "sphere" ? "sphere" : "box";
  const size =
    shape === "box" ? v([w / 2, d / 2, h / 2]) : shape === "cylinder" ? v([Math.max(w, d) / 2, h / 2]) : v([Math.max(w, h, d) / 2]);
  const attrs = [
    `name="${o.id}_geom"`,
    `type="${shape}"`,
    `size="${size}"`,
    `pos="0 0 ${f(h / 2)}"`,
    `material="mat_${o.id}"`,
    `friction="${f(friction)} 0.005 0.0001"`,
    mass ? `mass="${f(mass)}"` : `density="400"`,
  ];
  // Collision groups: static geoms are 1/1. Hinged and sliding parts are 2/2 so they don't
  // fight the frame or cabinet they're mounted in; dynamic bodies are 3/3 and hit everything.
  const kind = o.articulation?.kind;
  if (o.physics?.collider === "none") attrs.push(`contype="0" conaffinity="0"`);
  else if (kind === "hinge" || kind === "slide") attrs.push(`contype="2" conaffinity="2"`);
  else if (kind === "free" || o.physics?.body === "dynamic") attrs.push(`contype="3" conaffinity="3"`);
  return `<geom ${attrs.join(" ")}/>`;
}

function wallGeoms(scene: Scene) {
  const { width: w, depth: d, height: H, openings } = scene.room;
  const walls = [
    { wall: "north", len: w + 2 * WALL_T, at: (u: number) => [u, -d / 2 - WALL_T / 2], alongX: true },
    { wall: "south", len: w + 2 * WALL_T, at: (u: number) => [u, d / 2 + WALL_T / 2], alongX: true },
    { wall: "east", len: d, at: (u: number) => [w / 2 + WALL_T / 2, u], alongX: false },
    { wall: "west", len: d, at: (u: number) => [-w / 2 - WALL_T / 2, u], alongX: false },
  ] as const;
  const out: string[] = [];
  for (const wl of walls) {
    const ops = openings.filter((o: Opening) => o.wall === wl.wall).sort((a, b) => a.offset - b.offset);
    const pieces: [number, number, number, number][] = [];
    let cursor = -wl.len / 2;
    for (const o of ops) {
      const a = o.offset - o.width / 2;
      const b = o.offset + o.width / 2;
      if (a > cursor) pieces.push([cursor, a, 0, H]);
      if (o.sill > 0) pieces.push([a, b, 0, o.sill]);
      if (o.sill + o.height < H) pieces.push([a, b, o.sill + o.height, H]);
      cursor = Math.max(cursor, b);
    }
    if (cursor < wl.len / 2) pieces.push([cursor, wl.len / 2, 0, H]);
    pieces.forEach(([u0, u1, y0, y1], i) => {
      const [sx, sz] = wl.at((u0 + u1) / 2);
      const half = wl.alongX ? [(u1 - u0) / 2, WALL_T / 2, (y1 - y0) / 2] : [WALL_T / 2, (u1 - u0) / 2, (y1 - y0) / 2];
      out.push(`<geom name="wall_${wl.wall}_${i}" type="box" size="${v(half)}" pos="${v(mj([sx, (y0 + y1) / 2, sz]))}" material="mat_wall"/>`);
    });
  }
  return out;
}

export function toMJCF(scene: Scene): string {
  const g = scene.room.gravity ?? [0, -9.81, 0];
  const materials = [
    `<material name="mat_wall" rgba="${rgba(scene.room.wallColor)}"/>`,
    `<material name="mat_floor" rgba="${rgba(scene.room.floorColor)}"/>`,
    ...scene.objects.map((o) => `<material name="mat_${o.id}" rgba="${rgba(o.color)}"/>`),
  ];
  const bodies = scene.objects.map((o) => {
    const light = o.light
      ? `\n      <light name="${o.id}_light" pos="0 0 ${f(o.size[1] * 0.8)}" diffuse="${rgba(o.light.color).split(" ").slice(0, 3).join(" ")}" attenuation="1 0 ${f(1 / Math.max(o.light.distance, 0.1) ** 2)}" active="${o.articulation?.kind === "switch" && o.articulation.initial ? "true" : "false"}"/>`
      : "";
    const j = joint(o);
    return `    <!-- ${o.type}${o.label ? `: ${o.label.replace(/--/g, "-")}` : ""} -->
    <body name="${o.id}" pos="${v(mj(o.position))}" euler="0 0 ${f(o.rotationY)}">${j ? `\n      ${j}` : ""}
      ${geom(o)}${light}
    </body>`;
  });
  return `<mujoco model="${scene.name.replace(/"/g, "'")}">
  <!-- Generated by Doorway from scene.json. Units: meters, kilograms, radians. -->
  <compiler angle="radian"/>
  <option gravity="${v(mj(g))}" timestep="0.002"/>
  <visual><headlight ambient="0.4 0.4 0.4" diffuse="0.6 0.6 0.6"/></visual>
  <asset>
    ${materials.join("\n    ")}
  </asset>
  <worldbody>
    <light name="sun" directional="true" pos="0 0 6" dir="0.2 0.3 -1"/>
    <geom name="floor" type="plane" size="${f(scene.room.width / 2 + 1)} ${f(scene.room.depth / 2 + 1)} 0.05" material="mat_floor"/>
    ${wallGeoms(scene).join("\n    ")}
${bodies.join("\n")}
  </worldbody>
</mujoco>
`;
}
