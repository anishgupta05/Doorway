// scene.json → MuJoCo MJCF. Scene space is y-up (three.js); MuJoCo is z-up, so
// (x, y, z) maps to (x, -z, y). Rotations about scene +y become rotations about
// MuJoCo +z with the same angle, because the mapping is a proper rotation.
import type { Opening, Scene, SceneObject, Vec3 } from "@doorway/schema";
import { ROBOT_HEIGHT, ROBOT_RADIUS, robotStart } from "./floor";

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
      // frictionloss keeps a pushed door where the robot left it instead of drifting.
      return `<joint name="${o.id}_hinge" type="hinge" axis="${v(mj(a.axis))}" pos="${v(mj(a.pivot))}" range="${f(lo)} ${f(hi)}" limited="true" damping="${f(damping)}" frictionloss="1"/>`;
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

/**
 * Collision bits. Two geoms collide if (contype1 & conaffinity2) || (contype2 & conaffinity1).
 *   1 static furniture (MuJoCo's default), 2 doors and fitted parts, 4 walls and floor.
 * - Doors hit furniture (a swing can't pass through a sofa) but not walls or the floor, so the
 *   frame they hang in doesn't hold them.
 * - Fitted parts (drawers, hinged cabinet fronts) hit only each other, not the cabinet around them.
 * - Moving bodies (chairs, the robot) hit everything.
 */
const GROUPS = {
  none: `contype="0" conaffinity="0"`,
  door: `contype="2" conaffinity="3"`,
  fitted: `contype="2" conaffinity="2"`,
  moving: `contype="3" conaffinity="7"`,
  structure: `contype="4" conaffinity="4"`,
};

/** One collision shape in the object's local frame (scene axes, y-up; `at` is the shape's center). */
type Shape = { shape: "box" | "cylinder" | "sphere"; at: Vec3; size: Vec3 };

/**
 * Collision shapes that follow the viewer's builders where a bounding box would be wrong:
 * a table is a top and four legs (so a chair tucked under it doesn't start inside it),
 * a chair is a seat block and a backrest. Explicit parts win; everything else is its box.
 */
function shapes(o: SceneObject): Shape[] {
  const [w, h, d] = o.size;
  if (o.parts?.length) return o.parts.map((p) => ({ shape: p.shape, at: p.offset, size: p.size }));
  if (o.type === "table") {
    const top = 0.04;
    const legs: Shape[] = [];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) legs.push({ shape: "box", at: [sx * (w / 2 - 0.06), (h - top) / 2, sz * (d / 2 - 0.06)], size: [0.04, h - top, 0.04] });
    return [{ shape: "box", at: [0, h - top / 2, 0], size: [w, top, d] }, ...legs];
  }
  if (o.type === "chair") {
    const seat = Math.min(0.47, h * 0.53) + 0.035;
    return [
      { shape: "box", at: [0, seat / 2, 0], size: [w, seat, d] },
      { shape: "box", at: [0, seat + (h - seat) / 2, -d / 2 + 0.05], size: [w * 0.94, h - seat, 0.06] },
    ];
  }
  const shape = o.physics?.collider === "cylinder" ? "cylinder" : o.physics?.collider === "sphere" ? "sphere" : "box";
  return [{ shape, at: [0, h / 2, 0], size: o.size }];
}

const volume = ({ shape, size: [w, h, d] }: Shape) =>
  shape === "box" ? w * h * d : shape === "cylinder" ? Math.PI * (Math.max(w, d) / 2) ** 2 * h : (4 / 3) * Math.PI * (Math.max(w, h, d) / 2) ** 3;

function geoms(o: SceneObject) {
  const parts = shapes(o);
  const mass = o.physics?.mass;
  const total = parts.reduce((n, p) => n + volume(p), 0);
  const friction = o.physics?.friction ?? 0.5;
  // Rugs and decor never collide (see GROUPS); a 1 cm solid slab only snags the robot and
  // chairs, and the schema lets decor rest on or overlap other objects.
  const kind = o.articulation?.kind;
  const group =
    o.physics?.collider === "none" || o.type === "rug" || o.decor
      ? GROUPS.none
      : o.type === "door" && kind === "hinge"
        ? GROUPS.door
        : kind === "hinge" || kind === "slide"
          ? GROUPS.fitted
          : kind === "free" || o.physics?.body === "dynamic"
            ? GROUPS.moving
            : null;
  return parts.map((p, i) => {
    const [w, h, d] = p.size;
    const size = p.shape === "box" ? v([w / 2, d / 2, h / 2]) : p.shape === "cylinder" ? v([Math.max(w, d) / 2, h / 2]) : v([Math.max(w, h, d) / 2]);
    const attrs = [
      `name="${o.id}_geom${parts.length > 1 ? `_${i}` : ""}"`,
      `type="${p.shape}"`,
      `size="${size}"`,
      `pos="${v(mj(p.at))}"`,
      `material="mat_${o.id}"`,
      `friction="${f(friction)} 0.005 0.0001"`,
      // Split a given mass across the shapes by volume; otherwise a light, wood-like density.
      mass ? `mass="${f((mass * volume(p)) / total)}"` : `density="400"`,
    ];
    if (group) attrs.push(group);
    return `<geom ${attrs.join(" ")}/>`;
  });
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
      out.push(`<geom name="wall_${wl.wall}_${i}" type="box" size="${v(half)}" pos="${v(mj([sx, (y0 + y1) / 2, sz]))}" material="mat_wall" ${GROUPS.structure}/>`);
    });
  }
  return out;
}

/**
 * A small planar mobile base (no wheels): world-aligned x/y slides and a yaw hinge, driven by
 * velocity actuators (collision group "moving"). It floats 1 cm off the floor so only its sides touch anything, and faces
 * local +x. Base and mast match the viewer's robot, so it can't drive under a desk the viewer
 * robot's mast would hit.
 */
function robotBody([x, z]: [number, number]) {
  return `    <!-- robot: planar base, commands are world-frame velocities -->
    <body name="robot" pos="${v(mj([x, 0.01, z]))}">
      <joint name="robot_x" type="slide" axis="1 0 0"/>
      <joint name="robot_y" type="slide" axis="0 1 0"/>
      <joint name="robot_yaw" type="hinge" axis="0 0 1"/>
      <geom name="robot_base" type="cylinder" size="${f(ROBOT_RADIUS)} 0.1" pos="0 0 0.1" mass="8" rgba="0.91 0.91 0.89 1" ${GROUPS.moving}/>
      <geom name="robot_mast" type="capsule" size="0.03" fromto="0 0 0.2 0 0 ${f(ROBOT_HEIGHT)}" mass="1" rgba="0.13 0.15 0.16 1" ${GROUPS.moving}/>
      <site name="robot_front" pos="${f(ROBOT_RADIUS)} 0 0.1"/>
    </body>`;
}

const ROBOT_ACTUATORS = `  <actuator>
    <velocity name="robot_vx" joint="robot_x" kv="250" ctrlrange="-0.6 0.6" forcerange="-120 120"/>
    <velocity name="robot_vy" joint="robot_y" kv="250" ctrlrange="-0.6 0.6" forcerange="-120 120"/>
    <velocity name="robot_wz" joint="robot_yaw" kv="40" ctrlrange="-2.5 2.5" forcerange="-30 30"/>
  </actuator>
`;

export type MJCFOptions = {
  /** Add the sim robot: true picks a free start spot, or give scene [x, z]. */
  robot?: boolean | [number, number];
};

export function toMJCF(scene: Scene, opts: MJCFOptions = {}): string {
  const g = scene.room.gravity ?? [0, -9.81, 0];
  const robot = opts.robot === true ? robotStart(scene) : opts.robot || null;
  const materials = [
    `<material name="mat_wall" rgba="${rgba(scene.room.wallColor)}"/>`,
    `<material name="mat_floor" rgba="${rgba(scene.room.floorColor)}"/>`,
    ...scene.objects.map((o) => `<material name="mat_${o.id}" rgba="${rgba(o.color ?? (o.type === "partition" ? scene.room.wallColor : undefined))}"/>`),
  ];
  const bodies = scene.objects.map((o) => {
    const light = o.light
      ? `\n      <light name="${o.id}_light" pos="0 0 ${f(o.size[1] * 0.8)}" diffuse="${rgba(o.light.color).split(" ").slice(0, 3).join(" ")}" attenuation="1 0 ${f(1 / Math.max(o.light.distance, 0.1) ** 2)}" active="${o.articulation?.kind === "switch" && o.articulation.initial ? "true" : "false"}"/>`
      : "";
    const j = joint(o);
    return `    <!-- ${o.type}${o.label ? `: ${o.label.replace(/--/g, "-")}` : ""} -->
    <body name="${o.id}" pos="${v(mj(o.position))}" euler="0 0 ${f(o.rotationY)}">${j ? `\n      ${j}` : ""}
      ${geoms(o).join("\n      ")}${light}
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
    <!-- MuJoCo takes the higher friction of two touching geoms, so the floor stays low and objects keep their own. -->
    <geom name="floor" type="plane" size="${f(scene.room.width / 2 + 1.5)} ${f(scene.room.depth / 2 + 1.5)} 0.05" material="mat_floor" friction="0.4 0.005 0.0001" ${GROUPS.structure}/>
    ${wallGeoms(scene).join("\n    ")}
${bodies.join("\n")}${robot ? `\n${robotBody(robot)}` : ""}
  </worldbody>
${robot ? ROBOT_ACTUATORS : ""}</mujoco>
`;
}
