// Floor, walls with real openings, trim, window and what's outside it.
// From outside (overview), walls between the camera and the room are moved to a
// shadow-only layer: they vanish from view like a dollhouse cutaway but still
// block sunlight, so light keeps falling through the window.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { Opening, Room as RoomSpec, Wall } from "@doorway/schema";
import { useApp } from "../store";
import { floorTexture, material, wallMaterial } from "./materials";

export const WALL_T = 0.12;
export const SHADOW_ONLY_LAYER = 1;

type Piece = { u0: number; u1: number; y0: number; y1: number };

function wallPieces(length: number, height: number, openings: Opening[]): Piece[] {
  const out: Piece[] = [];
  let cursor = -length / 2;
  for (const o of [...openings].sort((a, b) => a.offset - b.offset)) {
    const a = o.offset - o.width / 2;
    const b = o.offset + o.width / 2;
    if (a > cursor) out.push({ u0: cursor, u1: a, y0: 0, y1: height });
    if (o.sill > 0) out.push({ u0: a, u1: b, y0: 0, y1: o.sill });
    const top = o.sill + o.height;
    if (top < height) out.push({ u0: a, u1: b, y0: top, y1: height });
    cursor = Math.max(cursor, b);
  }
  if (cursor < length / 2) out.push({ u0: cursor, u1: length / 2, y0: 0, y1: height });
  return out;
}

type WallFrame = { wall: Wall; length: number; center: THREE.Vector3; normal: THREE.Vector3; alongX: boolean };

function wallFrames(room: RoomSpec): WallFrame[] {
  const { width: w, depth: d } = room;
  return [
    { wall: "north", length: w + 2 * WALL_T, center: new THREE.Vector3(0, 0, -d / 2 - WALL_T / 2), normal: new THREE.Vector3(0, 0, -1), alongX: true },
    { wall: "south", length: w + 2 * WALL_T, center: new THREE.Vector3(0, 0, d / 2 + WALL_T / 2), normal: new THREE.Vector3(0, 0, 1), alongX: true },
    { wall: "east", length: d, center: new THREE.Vector3(w / 2 + WALL_T / 2, 0, 0), normal: new THREE.Vector3(1, 0, 0), alongX: false },
    { wall: "west", length: d, center: new THREE.Vector3(-w / 2 - WALL_T / 2, 0, 0), normal: new THREE.Vector3(-1, 0, 0), alongX: false },
  ];
}

/** Position on a wall (u along it, y up, n into the room from its inner face). */
function onWall(f: WallFrame, u: number, y: number, n = 0): THREE.Vector3Tuple {
  const inward = f.normal.clone().multiplyScalar(-(WALL_T / 2 + n));
  return f.alongX ? [u, y, f.center.z + inward.z] : [f.center.x + inward.x, y, u];
}
const sizeOnWall = (f: WallFrame, along: number, h: number, thick: number): THREE.Vector3Tuple =>
  f.alongX ? [along, h, thick] : [thick, h, along];

const tmp = new THREE.Vector3();

export function Room({ room, cutaway }: { room: RoomSpec; cutaway: boolean }) {
  const frames = useMemo(() => wallFrames(room), [room]);
  const trim = material("paint", "#f4f2ed");
  const groups = useRef<(THREE.Group | null)[]>([]);
  const outside = useRef<THREE.Group>(null!);
  const walls = useRef<THREE.Group>(null!);
  const root = useRef<THREE.Group>(null!);
  const local = useMemo(() => new THREE.Vector3(), []);
  const floor = useMemo(() => {
    const tex = floorTexture(room.floorColor, room.floorMaterial, room.width + 2 * WALL_T, room.depth + 2 * WALL_T);
    return new THREE.MeshStandardMaterial({ map: tex, roughness: room.floorMaterial === "tile" ? 0.35 : 0.68 });
  }, [room.floorColor, room.floorMaterial, room.width, room.depth]);

  useFrame(({ camera }) => {
    const cam = root.current.worldToLocal(local.copy(camera.position));
    const inside = Math.abs(cam.x) < room.width / 2 + 0.05 && Math.abs(cam.z) < room.depth / 2 + 0.05 && cam.y < room.height;
    const hidden: string[] = [];
    frames.forEach((f, i) => {
      const g = groups.current[i];
      if (!g) return;
      const facing = tmp.copy(cam).sub(f.center).setY(0).dot(f.normal) > 0;
      const hide = cutaway && !inside && facing;
      if (hide) hidden.push(f.wall);
      g.traverse((o) => {
        if (hide) o.layers.set(SHADOW_ONLY_LAYER);
        else o.layers.set(0);
      });
    });
    const prev = useApp.getState().hiddenWalls;
    if (prev.length !== hidden.length || prev.some((w, k) => w !== hidden[k])) useApp.setState({ hiddenWalls: hidden });
    outside.current.visible = inside || !cutaway;
    const start = useApp.getState().buildStart;
    const rise = start === null ? 1 : Math.min(1, Math.max(0, (performance.now() - start) / 900));
    walls.current.scale.y = 1 - Math.pow(1 - rise, 3) || 0.0001;
  });

  return (
    <group ref={root}>
      {/* plinth: the room sits on a dark slab like an architectural model */}
      <RoundedBox
        args={[room.width + 2 * WALL_T + 0.5, 0.12, room.depth + 2 * WALL_T + 0.5]}
        radius={0.03}
        position={[0, -0.061, 0]}
        material={material("paint", "#1a1c20")}
        receiveShadow
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0005, 0]} material={floor} receiveShadow>
        <planeGeometry args={[room.width + 2 * WALL_T, room.depth + 2 * WALL_T]} />
      </mesh>
      {/* ceiling: faces down, so it is culled when seen from above */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, room.height, 0]} material={material("paint", "#f1eee9")} castShadow receiveShadow>
        <planeGeometry args={[room.width, room.depth]} />
      </mesh>

      <group ref={walls}>
      {frames.map((f, i) => {
        if (room.unseenWalls?.includes(f.wall)) return <group key={f.wall} ref={(g) => void (groups.current[i] = g)} />; // never filmed: leave it open
        const openings = room.openings.filter((o) => o.wall === f.wall);
        const pieces = wallPieces(f.length, room.height, openings);
        const look = room.wallLooks?.[f.wall] ?? room.wallLook;
        // A wall with a rounded opening is cut from an outline; plain walls stay as boxes around rectangles.
        const curved = openings.some((o) => o.shape === "arch");
        return (
          <group key={f.wall} ref={(g) => void (groups.current[i] = g)}>
            {curved && <CutWall f={f} room={room} openings={openings} look={look} />}
            {pieces.map((p, j) => {
              const along = p.u1 - p.u0;
              const h = p.y1 - p.y0;
              return (
                <group key={j}>
                  {!curved && (
                    <mesh position={onWall(f, (p.u0 + p.u1) / 2, (p.y0 + p.y1) / 2, -WALL_T / 2)} material={wallMaterial(look, room.wallColor, along, h)} castShadow receiveShadow>
                      <boxGeometry args={sizeOnWall(f, along, h, WALL_T)} />
                    </mesh>
                  )}
                  {p.y0 === 0 && (
                    <mesh position={onWall(f, (p.u0 + p.u1) / 2, 0.04, 0.006)} material={trim} castShadow receiveShadow>
                      <boxGeometry args={sizeOnWall(f, along, 0.08, 0.012)} />
                    </mesh>
                  )}
                </group>
              );
            })}
            {openings.map((o, j) =>
              o.shape === "arch" ? (
                <ArchFrame key={j} f={f} o={o} trim={trim} room={room} />
              ) : o.kind === "door" ? (
                <DoorCasing key={j} f={f} o={o} trim={trim} />
              ) : (
                <WindowFrame key={j} f={f} o={o} trim={trim} />
              ),
            )}
          </group>
        );
      })}
      </group>

      <group ref={outside}>
        <Outside room={room} />
      </group>
    </group>
  );
}

/** Outline of an opening in wall coordinates (u along the wall, y up). Arches get a semicircular top. */
function openingPath(o: Opening): THREE.Path {
  const a = o.offset - o.width / 2;
  const b = o.offset + o.width / 2;
  const top = o.sill + o.height;
  const path = new THREE.Path();
  path.moveTo(a, o.sill);
  path.lineTo(b, o.sill);
  if (o.shape === "arch") {
    // Radius is half the width, unless the opening is too short for that (then a flatter half-round).
    const r = Math.min(o.width / 2, o.height);
    const spring = top - r;
    path.lineTo(b, spring);
    path.absellipse(o.offset, spring, o.width / 2, r, 0, Math.PI, false, 0);
    path.lineTo(a, o.sill);
  } else {
    path.lineTo(b, top);
    path.lineTo(a, top);
    path.lineTo(a, o.sill);
  }
  return path;
}

/** Puts wall-local (u along the wall, y up, z = thickness from the inside face outward) into the room. */
function wallTransform(f: WallFrame, room: RoomSpec): { position: THREE.Vector3Tuple; rotation: THREE.Vector3Tuple } {
  const { width: w, depth: d } = room;
  switch (f.wall) {
    // Local z runs from the inside face (z = 0) outward (z = WALL_T) after these transforms.
    case "north": return { position: [0, 0, -d / 2], rotation: [0, Math.PI, 0] };
    case "south": return { position: [0, 0, d / 2], rotation: [0, 0, 0] };
    case "east": return { position: [w / 2, 0, 0], rotation: [0, Math.PI / 2, 0] };
    case "west": return { position: [-w / 2, 0, 0], rotation: [0, -Math.PI / 2, 0] };
  }
}

/** A whole wall cut from an outline with real holes, so rounded windows look round. */
function CutWall({ f, room, openings, look }: { f: WallFrame; room: RoomSpec; openings: Opening[]; look: RoomSpec["wallLook"] }) {
  const geom = useMemo(() => {
    const shape = new THREE.Shape();
    const L = f.length / 2;
    shape.moveTo(-L, 0);
    shape.lineTo(L, 0);
    shape.lineTo(L, room.height);
    shape.lineTo(-L, room.height);
    shape.lineTo(-L, 0);
    // The wall's local u runs left→right as seen from inside; mirror north/east so offsets match the room's axes.
    const flip = f.wall === "north" || f.wall === "east";
    for (const o of openings) shape.holes.push(openingPath(flip ? { ...o, offset: -o.offset } : o));
    return new THREE.ExtrudeGeometry(shape, { depth: WALL_T, bevelEnabled: false, curveSegments: 40 });
  }, [f, room.height, openings]);
  // Extruded UVs are in metres, so the look tiles at its real size (along = h = 1).
  const mat = wallMaterial(look, room.wallColor, 1, 1);
  const t = wallTransform(f, room);
  return (
    <group position={t.position} rotation={t.rotation}>
      <mesh geometry={geom} material={mat} castShadow receiveShadow />
    </group>
  );
}

/** Frame, glass and fan-shaped glazing bars for a rounded window (or a casing for a rounded doorway). */
function ArchFrame({ f, o, trim, room }: { f: WallFrame; o: Opening; trim: THREE.Material; room: RoomSpec }) {
  const flip = f.wall === "north" || f.wall === "east";
  const u = flip ? -o.offset : o.offset;
  const top = o.sill + o.height;
  const r = Math.min(o.width / 2, o.height);
  const spring = top - r;
  const glass = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color: "#dfefff", roughness: 0.04, metalness: 0, transparent: true, opacity: 0.12, envMapIntensity: 2.5, side: THREE.DoubleSide }),
    [],
  );
  const { frame, pane } = useMemo(() => {
    const pts: THREE.Vector3[] = [new THREE.Vector3(u - o.width / 2, o.sill, 0), new THREE.Vector3(u - o.width / 2, spring, 0)];
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI - (Math.PI * i) / 40;
      pts.push(new THREE.Vector3(u + (o.width / 2) * Math.cos(a), spring + r * Math.sin(a), 0));
    }
    pts.push(new THREE.Vector3(u + o.width / 2, o.sill, 0));
    const frame = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.01), 160, 0.03, 8, false);
    const pane = new THREE.ShapeGeometry(new THREE.Shape(openingPath({ ...o, offset: u }).getPoints(48)));
    return { frame, pane };
  }, [o, u, r, spring]);
  const t = wallTransform(f, room);
  const isWindow = o.kind === "window";
  return (
    <group position={t.position} rotation={t.rotation}>
      <group position={[0, 0, WALL_T / 2]}>
        <mesh geometry={frame} material={trim} castShadow />
        {isWindow && (
          <>
            <mesh geometry={pane} material={glass} />
            {/* bottom rail, centre mullion and two fan bars, like a lunette window */}
            <mesh position={[u, o.sill + 0.02, 0]} material={trim} castShadow>
              <boxGeometry args={[o.width, 0.04, 0.06]} />
            </mesh>
            {[Math.PI / 2, Math.PI / 4, (3 * Math.PI) / 4].map((a) => {
              const len = Math.hypot(Math.cos(a) * (o.width / 2), Math.sin(a) * r);
              const ang = Math.atan2(Math.sin(a) * r, Math.cos(a) * (o.width / 2));
              return (
                <mesh key={a} position={[u + (Math.cos(a) * (o.width / 2)) / 2, spring + (Math.sin(a) * r) / 2, 0]} rotation={[0, 0, ang - Math.PI / 2]} material={trim} castShadow>
                  <boxGeometry args={[0.03, len, 0.05]} />
                </mesh>
              );
            })}
            {spring > o.sill + 0.05 && (
              <mesh position={[u, (o.sill + spring) / 2, 0]} material={trim} castShadow>
                <boxGeometry args={[0.03, spring - o.sill, 0.05]} />
              </mesh>
            )}
          </>
        )}
      </group>
      {isWindow && (
        <mesh position={[u, o.sill - 0.015, -0.03]} material={trim} castShadow receiveShadow>
          <boxGeometry args={[o.width + 0.12, 0.03, 0.1]} />
        </mesh>
      )}
    </group>
  );
}

function DoorCasing({ f, o, trim }: { f: WallFrame; o: Opening; trim: THREE.Material }) {
  const depth = WALL_T + 0.03;
  const a = o.offset - o.width / 2;
  const b = o.offset + o.width / 2;
  const top = o.sill + o.height;
  return (
    <>
      {[a - 0.035, b + 0.035].map((u) => (
        <mesh key={u} position={onWall(f, u, top / 2 + 0.02, -WALL_T / 2)} material={trim} castShadow receiveShadow>
          <boxGeometry args={sizeOnWall(f, 0.07, top + 0.04, depth)} />
        </mesh>
      ))}
      <mesh position={onWall(f, o.offset, top + 0.035, -WALL_T / 2)} material={trim} castShadow receiveShadow>
        <boxGeometry args={sizeOnWall(f, o.width + 0.14, 0.07, depth)} />
      </mesh>
    </>
  );
}

function WindowFrame({ f, o, trim }: { f: WallFrame; o: Opening; trim: THREE.Material }) {
  const glass = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color: "#dfefff", roughness: 0.04, metalness: 0, transparent: true, opacity: 0.12, envMapIntensity: 2.5 }),
    [],
  );
  const fw = 0.05;
  const depth = 0.07;
  const top = o.sill + o.height;
  const mid = o.sill + o.height / 2;
  return (
    <>
      <mesh position={onWall(f, o.offset, o.sill + fw / 2, -WALL_T / 2)} material={trim} castShadow>
        <boxGeometry args={sizeOnWall(f, o.width, fw, depth)} />
      </mesh>
      <mesh position={onWall(f, o.offset, top - fw / 2, -WALL_T / 2)} material={trim} castShadow>
        <boxGeometry args={sizeOnWall(f, o.width, fw, depth)} />
      </mesh>
      {[o.offset - o.width / 2 + fw / 2, o.offset + o.width / 2 - fw / 2, o.offset].map((u, i) => (
        <mesh key={i} position={onWall(f, u, mid, -WALL_T / 2)} material={trim} castShadow>
          <boxGeometry args={sizeOnWall(f, i === 2 ? 0.035 : fw, o.height, depth)} />
        </mesh>
      ))}
      <mesh position={onWall(f, o.offset, mid, -WALL_T / 2)} material={glass} rotation={[0, f.alongX ? 0 : Math.PI / 2, 0]}>
        <planeGeometry args={[o.width - 2 * fw, o.height - 2 * fw]} />
      </mesh>
      {/* interior sill */}
      <mesh position={onWall(f, o.offset, o.sill - 0.015, 0.03)} material={trim} castShadow receiveShadow>
        <boxGeometry args={sizeOnWall(f, o.width + 0.12, 0.03, 0.1)} />
      </mesh>
    </>
  );
}

/** Soft daylight backdrop behind windows and a short corridor behind doors. Only shown from inside. */
function Outside({ room }: { room: RoomSpec }) {
  const sky = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 256;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#bcd3ea");
    grad.addColorStop(0.55, "#eef3f6");
    grad.addColorStop(0.62, "#c9cfc4");
    grad.addColorStop(1, "#8f9a86");
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: t, toneMapped: false, color: new THREE.Color(1.15, 1.15, 1.15) });
  }, []);
  const day = useMemo(() => new THREE.Color(1.15, 1.15, 1.15), []);
  const night = useMemo(() => new THREE.Color(0.07, 0.09, 0.16), []);
  useFrame((_, dt) => void sky.color.lerp(useApp.getState().night ? night : day, 1 - Math.exp(-3 * Math.min(dt, 1 / 30))));
  const frames = wallFrames(room);
  const neighbour = useMemo(
    () =>
      ["#a59d91", "#a59d91", "#c9c3b9", "#6e5f50", "#958c80", "#958c80"].map(
        (c) => new THREE.MeshStandardMaterial({ color: c, side: THREE.BackSide, roughness: 0.9 }),
      ),
    [],
  );
  // Box faces: +x, -x, ceiling, floor, +z, -z. Darker floor and end wall give the corridor depth.
  const corridor = useMemo(
    () =>
      ["#c9c0b2", "#c9c0b2", "#e9e5dd", "#7d6c5a", "#b3a998", "#b3a998"].map(
        (c) => new THREE.MeshStandardMaterial({ color: c, side: THREE.BackSide, roughness: 0.85 }),
      ),
    [],
  );
  return (
    <>
      {room.openings.map((o, i) => {
        const f = frames.find((fr) => fr.wall === o.wall)!;
        const out = f.normal;
        if (o.kind === "window" && o.view === "indoors") {
          // A dim neighbouring room behind interior glass, instead of daylight.
          const len = 3;
          const pos: THREE.Vector3Tuple = f.alongX
            ? [o.offset, room.height / 2, f.center.z + out.z * (WALL_T / 2 + len / 2)]
            : [f.center.x + out.x * (WALL_T / 2 + len / 2), room.height / 2, o.offset];
          const size: THREE.Vector3Tuple = f.alongX ? [o.width + 2.4, room.height, len] : [len, room.height, o.width + 2.4];
          return (
            <mesh key={i} position={pos} receiveShadow material={neighbour}>
              <boxGeometry args={size} />
            </mesh>
          );
        }
        if (o.kind === "window") {
          const dist = 4;
          const pos: THREE.Vector3Tuple = f.alongX ? [o.offset, 1.4, f.center.z + out.z * dist] : [f.center.x + out.x * dist, 1.4, o.offset];
          return (
            <mesh key={i} position={pos} rotation={[0, Math.atan2(-out.x, -out.z), 0]} material={sky}>
              <planeGeometry args={[14, 7]} />
            </mesh>
          );
        }
        const len = 2.2;
        const pos: THREE.Vector3Tuple = f.alongX
          ? [o.offset, room.height / 2, f.center.z + out.z * (WALL_T / 2 + len / 2)]
          : [f.center.x + out.x * (WALL_T / 2 + len / 2), room.height / 2, o.offset];
        const size: THREE.Vector3Tuple = f.alongX ? [o.width + 1.4, room.height, len] : [len, room.height, o.width + 1.4];
        return (
          <mesh key={i} position={pos} receiveShadow material={corridor}>
            <boxGeometry args={size} />
          </mesh>
        );
      })}
    </>
  );
}
