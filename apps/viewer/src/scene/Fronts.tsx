// The moving parts of furniture that doesn't move as a whole:
//   hinged cabinets, wardrobes → front door leaves that swing out, around their neighbours
//   lockers / pigeonholes      → a grid of small doors with keypads, opening in a ripple
//   things that "slide"        → a drawer front that pulls out
//   switchable devices         → a status light and a soft glow
// Anything with front doors is built as a hollow shell (see Shell), so opening it shows an inside.
// All are driven by the object's joint value (0 closed/off → 1 open/on) from Placed.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { Scene, SceneObject } from "@doorway/schema";
import { hashSeed, material, mulberry32 } from "./materials";
import { useJointValue, wholeBodyJoint } from "./Placed";
import { useSceneCtx } from "./sceneContext";

const LEAF_MAX = 0.6; // metres per cabinet door leaf
const CELL = 0.45; // metres per locker door
const OPEN_ANGLE = (100 * Math.PI) / 180;
const T = 0.018; // panel thickness

/** Has doors on its front that open while the body stays put. */
export const hasFrontDoors = (o: SceneObject) => o.articulation?.kind === "hinge" && !wholeBodyJoint(o) && !o.decor;

const isGrid = (o: SceneObject) => !!o.cells || /locker|pigeon|cubby|cubbies/i.test(`${o.label ?? ""} ${o.id}`);
export function gridOf(o: SceneObject): [number, number] {
  if (o.cells) return o.cells;
  return [Math.max(1, Math.round(o.size[0] / CELL)), Math.max(1, Math.round(o.size[1] / CELL))];
}

/** Low cabinets (counters) keep a plinth and a top; tall ones nearly fill their front. */
const frame = (h: number) => ({ bottom: h < 1.2 ? 0.08 : 0.03, top: h < 1.2 ? 0.05 : 0.03 });

export function Fronts({ obj }: { obj: SceneObject }) {
  const a = obj.articulation;
  if (!a || wholeBodyJoint(obj) || obj.decor) return null;
  if (a.kind === "hinge") return isGrid(obj) ? <LockerDoors obj={obj} /> : <Leaves obj={obj} />;
  if (a.kind === "slide") return <DrawerFront obj={obj} travel={Math.max(...a.range.map(Math.abs), 0.25)} />;
  if (a.kind === "switch" && obj.type !== "lamp") return <StatusLight obj={obj} />;
  return null;
}

const shade = (c: string | undefined, l: number) => `#${new THREE.Color(c ?? "#e3e1dc").offsetHSL(0, 0, l).getHexString()}`;

/** A cabinet carcass: sides, top, bottom, back and shelves (or a cell grid for lockers), open at the front. */
export function Shell({ o }: { o: SceneObject }) {
  const [w, h, d] = o.size;
  const outer = material(o.material ?? "paint", o.color ?? "#e3e1dc");
  const inner = material("paint", shade(o.color, -0.18));
  const { bottom, top } = frame(h);
  const grid = isGrid(o);
  const [cols, rows] = grid ? gridOf(o) : [1, Math.max(1, Math.round((h - bottom - top) / 0.36))];
  const innerH = h - bottom - top;
  const contents = useMemo(() => {
    if (grid) return [];
    // A few binders and boxes on the shelves, so an open cabinet reads as storage.
    const rand = mulberry32(hashSeed(o.id));
    const out: { p: [number, number, number]; s: [number, number, number]; c: string }[] = [];
    const colors = ["#3b5b7a", "#9a3c34", "#d6c27a", "#5d7a55", "#efe9dc", "#2d2f33"];
    for (let r = 0; r < rows; r++) {
      let x = -w / 2 + T + 0.03;
      const y0 = bottom + T + (r * innerH) / rows;
      const space = innerH / rows - T - 0.03;
      while (x < w / 2 - T - 0.08) {
        if (rand() < 0.35) {
          x += 0.1 + rand() * 0.2;
          continue;
        }
        const bw = 0.04 + rand() * 0.06;
        const bh = Math.min(space, 0.18 + rand() * 0.12);
        out.push({ p: [x + bw / 2, y0 + bh / 2, -d / 2 + T + (d * 0.55) / 2], s: [bw, bh, d * 0.55], c: colors[Math.floor(rand() * colors.length)] });
        x += bw + 0.004;
      }
    }
    return out;
  }, [grid, o.id, rows, w, d, bottom, innerH]);
  return (
    <group>
      {/* plinth, top, sides, back */}
      <mesh position={[0, bottom / 2, -0.01]} material={outer} castShadow receiveShadow>
        <boxGeometry args={[w - 0.02, bottom, d - 0.03]} />
      </mesh>
      <mesh position={[0, h - top / 2, 0]} material={outer} castShadow receiveShadow>
        <boxGeometry args={[w, top, d]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * (w - T)) / 2, h / 2, 0]} material={outer} castShadow receiveShadow>
          <boxGeometry args={[T, h, d]} />
        </mesh>
      ))}
      <mesh position={[0, h / 2, -d / 2 + T / 2]} material={outer} castShadow receiveShadow>
        <boxGeometry args={[w - 2 * T, h - 0.001, T]} />
      </mesh>
      {/* interior: darker lining, shelves or the locker grid */}
      <mesh position={[0, bottom + innerH / 2, -d / 2 + T + 0.001]} material={inner}>
        <planeGeometry args={[w - 2 * T, innerH]} />
      </mesh>
      <mesh position={[0, bottom + T / 2, 0]} material={inner} receiveShadow>
        <boxGeometry args={[w - 2 * T, T, d - T]} />
      </mesh>
      {Array.from({ length: rows - 1 }, (_, r) => (
        <mesh key={`r${r}`} position={[0, bottom + ((r + 1) * innerH) / rows, 0.005]} material={inner} castShadow receiveShadow>
          <boxGeometry args={[w - 2 * T, T, d - T - 0.01]} />
        </mesh>
      ))}
      {grid &&
        Array.from({ length: cols - 1 }, (_, c) => (
          <mesh key={`c${c}`} position={[-w / 2 + T + ((c + 1) * (w - 2 * T)) / cols, bottom + innerH / 2, 0.005]} material={inner} castShadow receiveShadow>
            <boxGeometry args={[T, innerH, d - T - 0.01]} />
          </mesh>
        ))}
      {contents.map((b, i) => (
        <mesh key={i} position={b.p} material={material("paint", b.c)} castShadow receiveShadow>
          <boxGeometry args={b.s} />
        </mesh>
      ))}
    </group>
  );
}

type LeafPlan = { hingeLeft: boolean; max: number };

/**
 * How far each leaf can open without going through a wall or another object, and on which
 * side it should hinge. A leaf against a neighbour hinges on the other side, and if both
 * sides are tight it stops short instead of swinging through.
 */
function planLeaves(o: SceneObject, scene: Scene | null, n: number): LeafPlan[] {
  const [w, h, d] = o.size;
  const leaf = w / n;
  const { bottom } = frame(h);
  const y0 = o.position[1] + bottom;
  const y1 = o.position[1] + h;
  const others = (scene?.objects ?? []).filter((x) => x.id !== o.id && !x.decor && x.type !== "rug" && x.position[1] < y1 && x.position[1] + x.size[1] > y0);
  const room = scene?.room;
  const c = Math.cos(o.rotationY);
  const s = Math.sin(o.rotationY);
  const blocked = (lx: number, lz: number) => {
    const x = o.position[0] + lx * c + lz * s;
    const z = o.position[2] - lx * s + lz * c;
    if (room && (Math.abs(x) > room.width / 2 - 0.01 || Math.abs(z) > room.depth / 2 - 0.01)) return true;
    return others.some((b) => {
      const cb = Math.cos(-b.rotationY);
      const sb = Math.sin(-b.rotationY);
      const bx = (x - b.position[0]) * cb + (z - b.position[2]) * sb;
      const bz = -(x - b.position[0]) * sb + (z - b.position[2]) * cb;
      return Math.abs(bx) < b.size[0] / 2 && Math.abs(bz) < b.size[2] / 2;
    });
  };
  const reach = (i: number, hingeLeft: boolean) => {
    const hx = -w / 2 + i * leaf + (hingeLeft ? 0 : leaf);
    const dir = hingeLeft ? 1 : -1;
    let max = 0;
    for (let deg = 5; deg <= 100; deg += 5) {
      const t = (deg * Math.PI) / 180;
      const hit = [0.5, 1].some((f) => blocked(hx + dir * leaf * f * Math.cos(t), d / 2 + leaf * f * Math.sin(t)));
      if (hit) break;
      max = t;
    }
    return max;
  };
  return Array.from({ length: n }, (_, i) => {
    const preferLeft = n === 1 || i % 2 === 0;
    const a = reach(i, preferLeft);
    if (a >= (80 * Math.PI) / 180) return { hingeLeft: preferLeft, max: Math.min(a, OPEN_ANGLE) };
    const b = reach(i, !preferLeft);
    return b > a ? { hingeLeft: !preferLeft, max: b } : { hingeLeft: preferLeft, max: a };
  });
}

/** Cabinet doors: one leaf per ~60 cm, hinged and limited so they never swing through anything. */
function Leaves({ obj }: { obj: SceneObject }) {
  const [w, h, d] = obj.size;
  const n = Math.max(1, Math.ceil(w / LEAF_MAX));
  const leaf = w / n;
  const { bottom, top } = frame(h);
  const lh = Math.max(0.1, h - bottom - top);
  const scene = useSceneCtx();
  const plans = useMemo(() => planLeaves(obj, scene, n), [obj, scene, n]);
  const mat = material(obj.material ?? "paint", shade(obj.color, 0.03));
  const value = useJointValue();
  const hinges = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    hinges.current.forEach((g, i) => {
      if (!g) return;
      const p = plans[i];
      g.rotation.y = (p.hingeLeft ? -1 : 1) * p.max * Math.max(0, Math.min(1.05, value.current));
    });
  });
  return (
    <>
      {plans.map((p, i) => {
        const x0 = -w / 2 + i * leaf;
        const hx = p.hingeLeft ? x0 : x0 + leaf;
        const dir = p.hingeLeft ? 1 : -1;
        return (
          <group key={i} ref={(g) => void (hinges.current[i] = g)} position={[hx, bottom, d / 2]}>
            <RoundedBox args={[leaf - 0.006, lh, 0.02]} radius={0.004} smoothness={2} position={[(dir * leaf) / 2, lh / 2, 0.01]} material={mat} castShadow receiveShadow />
            <mesh position={[dir * (leaf - 0.05), lh * (h < 1.2 ? 0.8 : 0.5), 0.032]} material={material("metal", "#2b2b2b")} castShadow>
              <boxGeometry args={[0.014, Math.min(0.16, lh * 0.25), 0.018]} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

/** A grid of small locker doors with keypad plates; opening ripples across the grid. */
function LockerDoors({ obj }: { obj: SceneObject }) {
  const [w, h, d] = obj.size;
  const [cols, rows] = gridOf(obj);
  const { bottom, top } = frame(h);
  const cw = (w - 2 * T) / cols;
  const ch = (h - bottom - top) / rows;
  const mat = material(obj.material ?? "metal", shade(obj.color ?? "#2f3438", 0.02));
  const keypad = material("plastic", "#d9d8d2");
  const value = useJointValue();
  const hinges = useRef<(THREE.Group | null)[]>([]);
  const n = cols * rows;
  useFrame(() => {
    const v = Math.max(0, Math.min(1, value.current));
    hinges.current.forEach((g, i) => {
      if (!g) return;
      // Each door starts a little after the previous one: a ripple, not a slam.
      const delay = (i / n) * 0.6;
      const t = Math.max(0, Math.min(1, (v - delay) / 0.4));
      g.rotation.y = -t * (95 * Math.PI) / 180;
    });
  });
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const x = -w / 2 + T + c * cw;
        const y = bottom + (rows - 1 - r) * ch;
        return (
          <group key={i} ref={(g) => void (hinges.current[i] = g)} position={[x, y, d / 2]}>
            <RoundedBox args={[cw - 0.008, ch - 0.008, 0.016]} radius={0.003} smoothness={2} position={[cw / 2, ch / 2, 0.008]} material={mat} castShadow receiveShadow />
            <mesh position={[cw * 0.72, ch * 0.55, 0.019]} material={keypad}>
              <boxGeometry args={[Math.min(0.09, cw * 0.3), Math.min(0.03, ch * 0.12), 0.008]} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

/** The top section of the front pulls out along +z, with a tray behind it. */
function DrawerFront({ obj, travel }: { obj: SceneObject; travel: number }) {
  const [w, h, d] = obj.size;
  const fh = Math.min(0.22, h * 0.25);
  const y = h - fh / 2 - 0.03;
  const depth = Math.min(d - 0.04, travel + 0.08);
  const value = useJointValue();
  const g = useRef<THREE.Group>(null!);
  useFrame(() => void (g.current.position.z = d / 2 + travel * Math.max(0, Math.min(1, value.current))));
  const mat = material(obj.material ?? "paint", shade(obj.color, 0.03));
  const inner = material("paint", "#d9d6cf");
  return (
    <group ref={g} position={[0, 0, d / 2]}>
      <RoundedBox args={[w - 0.03, fh - 0.01, 0.02]} radius={0.004} smoothness={2} position={[0, y, 0.01]} material={mat} castShadow receiveShadow />
      <mesh position={[0, y + fh * 0.15, 0.03]} material={material("metal", "#2b2b2b")}>
        <boxGeometry args={[Math.min(0.2, w * 0.3), 0.016, 0.018]} />
      </mesh>
      <mesh position={[0, y - fh / 2 + 0.02, -depth / 2]} material={inner} castShadow receiveShadow>
        <boxGeometry args={[w - 0.06, 0.012, depth]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * (w - 0.07)) / 2, y - 0.01, -depth / 2]} material={inner}>
          <boxGeometry args={[0.012, fh - 0.04, depth]} />
        </mesh>
      ))}
    </group>
  );
}

/** A green LED and a faint panel glow when on. */
function StatusLight({ obj }: { obj: SceneObject }) {
  const [w, h, d] = obj.size;
  const value = useJointValue();
  const led = useMemo(() => new THREE.MeshStandardMaterial({ color: "#1b1f1b", emissive: new THREE.Color("#7dff8a"), emissiveIntensity: 0, toneMapped: false }), []);
  const panel = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#20303a", emissive: new THREE.Color("#9fd4ff"), emissiveIntensity: 0, roughness: 0.3 }),
    [],
  );
  useFrame(() => {
    const v = Math.max(0, Math.min(1, value.current));
    led.emissiveIntensity = 0.1 + v * 6;
    panel.emissiveIntensity = v * 0.9;
  });
  const top = Math.min(h - 0.03, h * 0.9);
  return (
    <group position={[0, 0, d / 2 + 0.004]}>
      <mesh position={[w / 2 - 0.05, top, 0]} material={led}>
        <sphereGeometry args={[0.012, 12, 8]} />
      </mesh>
      <mesh position={[w / 2 - 0.14, top - 0.01, 0]} material={panel}>
        <planeGeometry args={[Math.min(0.12, w * 0.3), 0.06]} />
      </mesh>
    </group>
  );
}
