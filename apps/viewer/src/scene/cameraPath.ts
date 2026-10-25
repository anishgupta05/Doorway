// Smooth sampling of the camera path Argon recovered from the video.
// Catmull-Rom through the keys (keys can be unevenly spaced in time).
import * as THREE from "three";
import type { CameraKey } from "@doorway/schema";

const cr = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

function sampleVec(keys: CameraKey[], pick: (k: CameraKey) => number[], t: number, out: THREE.Vector3) {
  const n = keys.length;
  if (t <= keys[0].t) return out.fromArray(pick(keys[0]));
  if (t >= keys[n - 1].t) return out.fromArray(pick(keys[n - 1]));
  let i = 0;
  while (i < n - 2 && keys[i + 1].t < t) i++;
  const a = keys[Math.max(i - 1, 0)];
  const b = keys[i];
  const c = keys[i + 1];
  const d = keys[Math.min(i + 2, n - 1)];
  const u = (t - b.t) / Math.max(c.t - b.t, 1e-6);
  const [pa, pb, pc, pd] = [a, b, c, d].map(pick);
  return out.set(cr(pa[0], pb[0], pc[0], pd[0], u), cr(pa[1], pb[1], pc[1], pd[1], u), cr(pa[2], pb[2], pc[2], pd[2], u));
}

export function cameraAt(keys: CameraKey[], t: number, pos = new THREE.Vector3(), look = new THREE.Vector3()) {
  sampleVec(keys, (k) => k.position, t, pos);
  sampleVec(keys, (k) => k.lookAt, t, look);
  return { pos, look };
}

export const pathDuration = (keys: CameraKey[]) => keys[keys.length - 1].t;

/** Dense polyline of the path for drawing. */
export function pathPoints(keys: CameraKey[], steps = 240) {
  const end = pathDuration(keys);
  return Array.from({ length: steps + 1 }, (_, i) => cameraAt(keys, (i / steps) * end).pos.clone());
}
