import { z } from "zod";

// DRAFT v0 from the README table. Person 3 owns the final version; keep field names stable.

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const Articulation = z.object({
  kind: z.enum(["hinge", "slide", "free", "switch"]),
  axis: Vec3,
  pivot: Vec3,
  range: z.tuple([z.number(), z.number()]), // degrees for hinge, metres for slide
  damping: z.number().min(0).optional(), // resistance while moving; runtime default if omitted
});

// Rigid-body properties so the runtime physics (and sim export) agree with the 3D layout.
// static = fixed in the world, dynamic = pushed by forces/gravity, kinematic = driven by its articulation.
export const Physics = z.object({
  body: z.enum(["static", "dynamic", "kinematic"]),
  mass: z.number().positive(), // kg
  friction: z.number().min(0).max(2),
  collider: z.enum(["box", "cylinder", "sphere", "none"]),
});

export const Part = z.object({
  primitive: z.enum(["box", "cylinder", "sphere"]),
  pose: z.object({ position: Vec3, rotation: Vec3 }),
  size: Vec3,
  color: z.string(),
});

export const SceneObject = z.object({
  id: z.string(),
  type: z.string(), // door, chair, table, lamp, cabinet...
  parts: z.array(Part).min(1), // one part for a plain primitive, several for a composite
  pose: z.object({ position: Vec3, rotation: Vec3 }),
  size: Vec3,
  color: z.string(),
  articulation: Articulation.optional(),
  physics: Physics.optional(),
});

export const Interaction = z.object({
  verb: z.enum(["open", "toggle", "push"]),
  target: z.string(),
  effect: z.enum(["light"]).optional(),
});

export const CameraKey = z.object({
  t: z.number().min(0), // seconds into the video
  position: Vec3,
  lookAt: Vec3,
});

export const Opening = z.object({
  wall: z.enum(["north", "south", "east", "west"]),
  kind: z.enum(["door", "window"]),
  offset: z.number(),
  width: z.number(),
  height: z.number(),
});

export const Room = z.object({
  dimensions: Vec3, // width (x), height (y), depth (z) in metres
  wallColor: z.string(),
  floorColor: z.string(),
  ceilingColor: z.string(),
  openings: z.array(Opening),
  gravity: Vec3.optional(), // default [0, -9.81, 0]
});

export const Scene = z.object({
  room: Room,
  objects: z.array(SceneObject),
  interactions: z.array(Interaction),
  camera_path: z.array(CameraKey).min(2),
});

export type Scene = z.infer<typeof Scene>;
export type SceneObject = z.infer<typeof SceneObject>;

// Gemini's responseSchema takes a JSON Schema subset; this is the source for it.
export const sceneJsonSchema = () => z.toJSONSchema(Scene);

export * from "./patch.js";
