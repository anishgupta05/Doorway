// The shared contract between the model loop, the guards and the viewer.
// Conventions: meters, y-up, origin at the center of the room's floor.
// An object's `position` is the center of its footprint at its base (y = bottom),
// and its front faces local +z before `rotationY` is applied.
import { z } from "zod";

export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;

export const MaterialKind = z.enum([
  "wood",
  "darkwood",
  "fabric",
  "leather",
  "metal",
  "plastic",
  "glass",
  "ceramic",
  "paint",
  "plant",
]);
export type MaterialKind = z.infer<typeof MaterialKind>;

export const ObjectType = z.enum([
  "door",
  "drawer",
  "table",
  "chair",
  "cabinet",
  "shelf",
  "lamp",
  "rug",
  "plant",
  "monitor",
  "sofa",
  "bed",
  "box",
  /** Interior wall, half wall or column. size = [length, height, thickness]; length runs along local x. */
  "partition",
  "other",
]);
export type ObjectType = z.infer<typeof ObjectType>;

/**
 * Surface pattern the viewer paints procedurally (no image files). Argon picks the one that
 * matches what the footage shows; without it the material kind's default look is used.
 */
export const Look = z.enum(["brick", "plaster", "concrete", "carpet", "weave", "plush", "paper", "wood", "tile"]);
export type Look = z.infer<typeof Look>;

/** Optional explicit geometry. Without parts, the viewer builds a type-appropriate shape from `size`. */
export const Part = z.object({
  shape: z.enum(["box", "cylinder", "sphere"]),
  offset: Vec3,
  size: Vec3,
  color: z.string().optional(),
  material: MaterialKind.optional(),
});
export type Part = z.infer<typeof Part>;

export const Articulation = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("hinge"),
    axis: Vec3.default([0, 1, 0]),
    /** Pivot in the object's local frame. */
    pivot: Vec3,
    /** [closed, open] in radians. */
    range: z.tuple([z.number(), z.number()]),
  }),
  z.object({
    kind: z.literal("slide"),
    axis: Vec3.default([0, 0, 1]),
    /** [closed, open] in meters along `axis`. */
    range: z.tuple([z.number(), z.number()]),
  }),
  z.object({ kind: z.literal("free") }),
  z.object({ kind: z.literal("switch"), initial: z.boolean().default(false) }),
]);
export type Articulation = z.infer<typeof Articulation>;

export const LightSpec = z.object({
  color: z.string().default("#ffd9a0"),
  intensity: z.number().default(3),
  distance: z.number().default(6),
});

/**
 * Rigid-body properties shared by the runtime physics and sim export.
 * static = fixed in the world, dynamic = pushed by forces and gravity,
 * kinematic = driven by its articulation (e.g. a door on its hinge).
 */
export const Physics = z.object({
  body: z.enum(["static", "dynamic", "kinematic"]),
  /** kg */
  mass: z.number().positive(),
  friction: z.number().min(0).max(2).default(0.5),
  collider: z.enum(["box", "cylinder", "sphere", "none"]).default("box"),
  /** Resistance while an articulation moves; runtime picks a default if omitted. */
  damping: z.number().min(0).optional(),
});
export type Physics = z.infer<typeof Physics>;

export const SceneObject = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  type: ObjectType,
  label: z.string().optional(),
  position: Vec3,
  rotationY: z.number().default(0),
  size: Vec3,
  color: z.string().optional(),
  material: MaterialKind.optional(),
  parts: z.array(Part).optional(),
  /** Surface pattern, e.g. "weave" for upholstery, "paper" for a notebook. */
  look: Look.optional(),
  /**
   * Small clutter that makes the room feel lived in (bottles, papers, plush toys). Decor is
   * drawn but never scored, tested or patched by the loop, and may rest on or overlap other objects.
   */
  decor: z.boolean().default(false),
  articulation: Articulation.optional(),
  light: LightSpec.optional(),
  /** Grid of small doors on the front, [columns, rows], e.g. a 4×4 locker bank. */
  cells: z.tuple([z.number().int().min(1).max(12), z.number().int().min(1).max(12)]).optional(),
  physics: Physics.optional(),
});
export type SceneObject = z.infer<typeof SceneObject>;

export const Wall = z.enum(["north", "south", "east", "west"]);
export type Wall = z.infer<typeof Wall>;

export const Opening = z.object({
  wall: Wall,
  kind: z.enum(["door", "window"]),
  /** Center of the opening along the wall, measured from the wall's midpoint (+x for north/south, +z for east/west). */
  offset: z.number(),
  width: z.number(),
  height: z.number(),
  sill: z.number().default(0),
  /**
   * What's on the other side of a window. "indoors" = it looks into another room
   * (glass partition, interior window). Objects seen through it are NOT part of this scene.
   */
  view: z.enum(["outdoors", "indoors"]).default("outdoors"),
  /**
   * Outline of the opening. "arch" = a rectangle with a semicircular top (radius width/2);
   * if height ≤ width/2 it is a half-round window with a flat bottom.
   */
  shape: z.enum(["rect", "arch"]).default("rect"),
});
export type Opening = z.infer<typeof Opening>;

export const Room = z.object({
  /** Extent along x. */
  width: z.number().positive(),
  /** Extent along z. North wall is at -depth/2. */
  depth: z.number().positive(),
  height: z.number().positive(),
  wallColor: z.string().default("#ece8e1"),
  floorColor: z.string().default("#cfc8bd"),
  floorMaterial: z.enum(["wood", "concrete", "carpet", "tile"]).default("wood"),
  /** Pattern painted on the walls, e.g. "brick". Default is plain painted plaster. */
  wallLook: Look.optional(),
  /** Per-wall override of wallLook, e.g. { north: "brick" } for a single brick wall. */
  wallLooks: z.partialRecord(Wall, Look).optional(),
  /** Walls the video never showed. The viewer draws them open instead of inventing a surface. */
  unseenWalls: z.array(Wall).default([]),
  openings: z.array(Opening).default([]),
  /** m/s^2, default [0, -9.81, 0]. */
  gravity: Vec3.optional(),
});
export type Room = z.infer<typeof Room>;

export const Interaction = z.object({
  verb: z.enum(["open", "toggle", "push"]),
  target: z.string(),
  effect: z.string().optional(),
});
export type Interaction = z.infer<typeof Interaction>;

export const CameraKey = z.object({
  /** Seconds into the source video. */
  t: z.number().nonnegative(),
  position: Vec3,
  lookAt: Vec3,
});
export type CameraKey = z.infer<typeof CameraKey>;

export const Scene = z.object({
  version: z.literal(1),
  name: z.string(),
  room: Room,
  objects: z.array(SceneObject),
  interactions: z.array(Interaction).default([]),
  camera_path: z.array(CameraKey).min(2),
});
export type Scene = z.infer<typeof Scene>;
export type SceneInput = z.input<typeof Scene>;

// ---- run artifacts written by the orchestrator, read by the viewer ----

export const Issue = z.object({
  objectId: z.string(),
  message: z.string(),
  severity: z.enum(["low", "medium", "high"]),
});
export type Issue = z.infer<typeof Issue>;

export const Branch = z.object({
  i: z.number().int().nonnegative(),
  /** 0..1, higher is closer to the real footage. */
  score: z.number(),
  verdict: z.enum(["pass", "fail"]),
  /** Why a guard hook or interaction test rejected the branch. */
  reason: z.string().nullable(),
  /** What this branch tried, e.g. "move chair_2 toward the window". */
  hypothesis: z.string().optional(),
  /** Paths relative to the run directory. */
  scene: z.string(),
  thumb: z.string().nullable(),
});
export type Branch = z.infer<typeof Branch>;

export const Iteration = z.object({
  k: z.number().int().nonnegative(),
  /** Index of the surviving branch. */
  selected: z.number().int().nonnegative(),
  issues: z.string().nullable(),
  branches: z.array(Branch).min(1),
});
export type Iteration = z.infer<typeof Iteration>;

export const RunManifest = z.object({
  id: z.string(),
  title: z.string().optional(),
  /** Source video, relative to the run directory. */
  video: z.string().nullable(),
  status: z.enum(["running", "done"]).default("done"),
  iterations: z.array(Iteration),
});
export type RunManifest = z.infer<typeof RunManifest>;

export function parseScene(input: unknown): Scene {
  return Scene.parse(input);
}

export * from "./patch.js";
