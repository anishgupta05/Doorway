// Camera rigs per mode. Overview/convergence: dollhouse orbit with an idle
// "attract" drift. Compare: the render camera rides the recovered camera path at
// the footage's current time, so render and video line up frame for frame.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import * as THREE from "three";
import type { Scene } from "@doorway/schema";
import { useApp } from "../store";
import { footageTime } from "../video";
import { cameraAt } from "./cameraPath";

export const COMPARE_FOV = 55;

/** The overview camera, so on-screen buttons can drive it. */
export const view: { controls: CameraControls | null } = { controls: null };
const IDLE_SECONDS = 20;

export function OverviewRig({ room, wide = false }: { room: Scene["room"]; wide?: boolean }) {
  const ref = useRef<CameraControls>(null!);
  const mode = useApp((s) => s.mode);
  const viewNonce = useApp((s) => s.viewNonce);
  const keys = useRef(new Set<string>());
  const lastInput = useRef(performance.now());
  const { camera } = useThree();

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    (camera as THREE.PerspectiveCamera).fov = 42;
    camera.updateProjectionMatrix();
    // Frame small rooms (phone booths) as if they were at least 3.6 m across.
    const r = Math.max(room.width, room.depth, 3.6);
    // Look from the north-east so the door wall stays standing in the background.
    if (wide) c.setLookAt(r * 0.25, r * 1.55, -r * 2.15, 0, -0.3, 0.3, true);
    else if (mode === "convergence") c.setLookAt(r * 1.05, r * 1.45, -r * 1.15, 0, -1.1, -0.2, true);
    else {
      // ?az=<degrees> turns the overview around the room (render mode screenshots of any wall).
      const az = (Number(new URLSearchParams(location.search).get("az")) || 0) * (Math.PI / 180);
      const [x, z] = [r * 1.1, -r * 1.2];
      c.setLookAt(x * Math.cos(az) + z * Math.sin(az), r * 0.9, -x * Math.sin(az) + z * Math.cos(az), 0, 0.3, 0.2, true);
    }
  }, [mode, wide, room.width, room.depth, camera, viewNonce]);

  useEffect(() => {
    const bump = () => void (lastInput.current = performance.now());
    window.addEventListener("pointerdown", bump);
    window.addEventListener("wheel", bump);
    window.addEventListener("keydown", bump);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("wheel", bump);
      window.removeEventListener("keydown", bump);
    };
  }, []);

  // WASD / arrow-free panning: W,S move in and out, A,D slide sideways, Q,Z go up and down.
  useEffect(() => {
    const MOVE = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyZ"]);
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (MOVE.has(e.code)) keys.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => void keys.current.delete(e.code);
    const clear = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);

  useFrame((_, dt) => {
    const idle = (performance.now() - lastInput.current) / 1000 > IDLE_SECONDS;
    useApp.getState().idle !== idle && useApp.setState({ idle });
    const c = ref.current;
    if (idle && c) c.azimuthAngle += dt * 0.07;
    if (c && keys.current.size) {
      // Faster when zoomed out, slower up close.
      const v = Math.max(1.2, c.distance * 0.7) * dt;
      const k = keys.current;
      c.forward(((k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0)) * v, false);
      c.truck(((k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0)) * v, ((k.has("KeyZ") ? 1 : 0) - (k.has("KeyQ") ? 1 : 0)) * v, false);
    }
  });

  return (
    <CameraControls
      ref={(c) => {
        ref.current = c as CameraControls;
        view.controls = c;
      }}
      makeDefault
      minDistance={0.8}
      maxDistance={30}
      maxPolarAngle={Math.PI * 0.49}
      dollyToCursor
      dollySpeed={1.4}
      smoothTime={0.3}
      draggingSmoothTime={0.08}
      // camera-controls ACTION values: ROTATE=1, TRUCK=2 (move), DOLLY=16 (zoom). Left drag orbits, right drag moves, wheel and middle drag zoom.
      mouseButtons={{ left: 1, middle: 16, right: 2, wheel: 16 } as never}
    />
  );
}

export function CompareRig({ scene }: { scene: Scene }) {
  const { camera } = useThree();
  const pos = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const blend = useRef(0);
  const from = useRef({ p: new THREE.Vector3(), q: new THREE.Quaternion() });
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useEffect(() => {
    from.current.p.copy(camera.position);
    from.current.q.copy(camera.quaternion);
    blend.current = 0;
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = COMPARE_FOV;
    cam.updateProjectionMatrix();
  }, [camera]);

  useFrame((_, dt) => {
    const t = footageTime(useApp.getState().videoTime);
    cameraAt(scene.camera_path, t, pos, look);
    if (useApp.getState().shake) {
      // Handheld phone: low-frequency sway plus a little high-frequency jitter.
      const n = (f: number, o: number) => Math.sin(t * f + o) * 0.6 + Math.sin(t * f * 2.7 + o * 1.3) * 0.4;
      pos.x += n(1.3, 0.2) * 0.018;
      pos.y += n(1.7, 1.1) * 0.014;
      look.x += n(0.9, 2.3) * 0.05;
      look.y += n(1.1, 0.7) * 0.04;
    }
    // Matrix4.lookAt uses the camera convention (looking down -z).
    q.setFromRotationMatrix(m.lookAt(pos, look, up));
    blend.current = useApp.getState().renderMode ? 1 : Math.min(1, blend.current + dt / 1.1);
    const e = 1 - Math.pow(1 - blend.current, 3);
    camera.position.lerpVectors(from.current.p, pos, e);
    camera.quaternion.slerpQuaternions(from.current.q, q, e);
  });
  return null;
}
