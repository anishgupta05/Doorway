// First-person walk: pointer lock, WASD, eye height, bump-out collision with
// furniture footprints, and a crosshair ray that drives hover + E to interact.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import * as THREE from "three";
import type { Scene, SceneObject } from "@doorway/schema";
import { defaultJoint } from "../scene/Placed";
import { useApp } from "../store";
import { sfx } from "../sfx";

const EYE = 1.6;
const RADIUS = 0.22;
const REACH = 2.4;
const SOLID = new Set<SceneObject["type"]>(["table", "chair", "cabinet", "shelf", "sofa", "bed", "plant", "box", "other"]);

/** Free articulations and dynamic physics bodies get pushed; everything else articulated gets toggled. */
const pushable = (o: SceneObject) => o.articulation?.kind === "free" || (!o.articulation && o.physics?.body === "dynamic");
export const interactive = (o: SceneObject | undefined) => !!o && (!!o.articulation || pushable(o));

/** Finds the scene object id for a hit by walking up to the Placed group. */
export function objectIdOf(o: THREE.Object3D | null): string | null {
  while (o) {
    if (o.userData?.objectId) return o.userData.objectId as string;
    o = o.parent;
  }
  return null;
}

/** E / click on the hovered object: toggle hinges, slides and switches; push free objects away from the viewer. */
export function interact(scene: Scene, id: string, camera: THREE.Camera) {
  const obj = scene.objects.find((o) => o.id === id);
  const s = useApp.getState();
  if (!obj || !interactive(obj)) return;
  if (pushable(obj)) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0;
    dir.normalize().multiplyScalar(0.35);
    s.push(id, dir.x, dir.z);
    sfx.scrape();
  } else {
    const wasOpen = (s.joints[id] ?? defaultJoint(obj)) > 0;
    s.toggleJoint(id, defaultJoint(obj));
    const kind = obj.articulation?.kind;
    if (kind === "hinge") sfx.creak(!wasOpen);
    else if (kind === "slide") sfx.slide();
    else sfx.click();
  }
}

export function Walk({ scene }: { scene: Scene }) {
  const { camera, scene: three } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const vel = useRef(new THREE.Vector3());
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const intro = useRef(0);
  const frame = useRef(0);
  const fwd = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const want = useMemo(() => new THREE.Vector3(), []);
  const centre = useMemo(() => new THREE.Vector2(0, 0), []);
  const from = useRef({ pos: new THREE.Vector3(), quat: new THREE.Quaternion() });
  // Start a few steps from the door, facing it: the judge's first move is to open it.
  const to = useMemo(() => {
    const door = scene.objects.find((o) => o.type === "door");
    const { width, depth } = scene.room;
    let pos: THREE.Vector3;
    let look: THREE.Vector3;
    if (door) {
      const inward = new THREE.Vector3(-door.position[0], 0, -door.position[2]).setY(0);
      // Snap to the axis of the wall the door sits in.
      if (Math.abs(door.position[2]) / depth > Math.abs(door.position[0]) / width) inward.set(0, 0, -Math.sign(door.position[2]));
      else inward.set(-Math.sign(door.position[0]), 0, 0);
      pos = new THREE.Vector3(door.position[0], EYE, door.position[2]).addScaledVector(inward, 2.9);
      pos.x = THREE.MathUtils.clamp(pos.x - 0.5 * inward.z, -width / 2 + 0.5, width / 2 - 0.5);
      pos.z = THREE.MathUtils.clamp(pos.z, -depth / 2 + 0.5, depth / 2 - 0.5);
      look = new THREE.Vector3(door.position[0], EYE - 0.35, door.position[2]);
    } else {
      const k = scene.camera_path[0];
      pos = new THREE.Vector3(k.position[0], EYE, k.position[2]);
      look = new THREE.Vector3(k.lookAt[0], EYE - 0.15, k.lookAt[2]);
    }
    const m = new THREE.Matrix4().lookAt(pos, look, new THREE.Vector3(0, 1, 0));
    return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(m) };
  }, [scene]);

  useEffect(() => {
    from.current.pos.copy(camera.position);
    from.current.quat.copy(camera.quaternion);
    intro.current = 0;
    const down = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
      if (e.code === "KeyE") {
        const h = useApp.getState().hovered;
        if (h) interact(scene, h, camera);
      }
    };
    const up = (e: KeyboardEvent) => void (keys.current[e.code] = false);
    const click = () => {
      const h = useApp.getState().hovered;
      if (h && document.pointerLockElement) interact(scene, h, camera);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("mousedown", click);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("mousedown", click);
      useApp.getState().setHovered(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 30);
    // Glide from wherever the camera was into the walk start pose.
    if (intro.current < 1) {
      intro.current = Math.min(1, intro.current + dt / 1.4);
      const t = 1 - Math.pow(1 - intro.current, 3);
      camera.position.lerpVectors(from.current.pos, to.pos, t);
      camera.quaternion.slerpQuaternions(from.current.quat, to.quat, t);
      return;
    }

    const k = keys.current;
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    right.crossVectors(fwd, camera.up).normalize();
    want.set(0, 0, 0);
    if (k.KeyW || k.ArrowUp) want.add(fwd);
    if (k.KeyS || k.ArrowDown) want.sub(fwd);
    if (k.KeyD || k.ArrowRight) want.add(right);
    if (k.KeyA || k.ArrowLeft) want.sub(right);
    const speed = k.ShiftLeft || k.ShiftRight ? 2.6 : 1.5;
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(speed);
    vel.current.x = THREE.MathUtils.damp(vel.current.x, want.x, 10, dt);
    vel.current.z = THREE.MathUtils.damp(vel.current.z, want.z, 10, dt);

    const p = camera.position;
    p.x += vel.current.x * dt;
    p.z += vel.current.z * dt;
    collide(p, scene);
    // A tiny head bob while moving sells the walk.
    const moving = Math.hypot(vel.current.x, vel.current.z);
    p.y = THREE.MathUtils.damp(p.y, EYE + Math.sin(performance.now() / 160) * 0.012 * Math.min(moving / 1.5, 1), 12, dt);

    // Crosshair hover. 20 Hz is plenty and keeps the scene-wide raycast off most frames.
    if (++frame.current % 3 !== 0) return;
    ray.setFromCamera(centre, camera);
    ray.far = REACH;
    const hits = ray.intersectObjects(three.children, true);
    let hovered: string | null = null;
    for (const h of hits) {
      const id = objectIdOf(h.object);
      if (!id) {
        if (h.object.type === "Mesh") break; // a wall is in the way
        continue;
      }
      if (interactive(scene.objects.find((o) => o.id === id))) hovered = id;
      break;
    }
    const s = useApp.getState();
    if (s.hovered !== hovered) s.setHovered(hovered);
  });

  // No selector: any click while walking (re)captures the mouse, including the cover overlay.
  return <PointerLockControls makeDefault />;
}

/** Keeps the viewer inside the room and outside solid furniture footprints. */
function collide(p: THREE.Vector3, scene: Scene) {
  const { width, depth } = scene.room;
  p.x = THREE.MathUtils.clamp(p.x, -width / 2 + RADIUS, width / 2 - RADIUS);
  p.z = THREE.MathUtils.clamp(p.z, -depth / 2 + RADIUS, depth / 2 - RADIUS);
  const pushes = useApp.getState().pushes;
  for (const o of scene.objects) {
    if (!SOLID.has(o.type) || o.position[1] > 1.2) continue;
    const [dx, dz] = pushes[o.id] ?? [0, 0];
    const cx = o.position[0] + dx;
    const cz = o.position[2] + dz;
    // Into the object's local frame.
    const c = Math.cos(-o.rotationY);
    const s = Math.sin(-o.rotationY);
    const lx = (p.x - cx) * c + (p.z - cz) * s;
    const lz = -(p.x - cx) * s + (p.z - cz) * c;
    const hx = o.size[0] / 2 + RADIUS;
    const hz = o.size[2] / 2 + RADIUS;
    if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
      const ox = hx - Math.abs(lx);
      const oz = hz - Math.abs(lz);
      let nx = lx;
      let nz = lz;
      if (ox < oz) nx = Math.sign(lx || 1) * hx;
      else nz = Math.sign(lz || 1) * hz;
      // Back to world.
      p.x = cx + nx * Math.cos(o.rotationY) + nz * Math.sin(o.rotationY);
      p.z = cz - nx * Math.sin(o.rotationY) + nz * Math.cos(o.rotationY);
    }
  }
}
