// Turns a scene object into furniture. Argon only has to give a type and a bounding
// box; each builder fills that box with a believable, consistent shape. Local frame:
// origin at the base center, front facing +z.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Instance, Instances, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { MaterialKind, Part, SceneObject, Vec3 } from "@doorway/schema";
import { hashSeed, material, mulberry32 } from "./materials";
import { useJointValue } from "./Placed";
import { ModelBody, modelFor } from "./models";

type V3 = [number, number, number];

function RB({ s, p, r = 0.01, m, rot }: { s: V3; p: V3; r?: number; m: THREE.Material; rot?: V3 }) {
  const radius = Math.max(0.0005, Math.min(r, Math.min(...s) / 2 - 0.0005));
  return (
    <RoundedBox args={s} radius={radius} smoothness={3} position={p} rotation={rot} material={m} castShadow receiveShadow />
  );
}

function Cyl({ r, rb, h, p, m, rot, seg = 32 }: { r: number; rb?: number; h: number; p: V3; m: THREE.Material; rot?: V3; seg?: number }) {
  return (
    <mesh position={p} rotation={rot} material={m} castShadow receiveShadow>
      <cylinderGeometry args={[r, rb ?? r, h, seg]} />
    </mesh>
  );
}

const DEFAULTS: Partial<Record<SceneObject["type"], { kind: MaterialKind; color: string }>> = {
  door: { kind: "paint", color: "#d9cdbb" },
  drawer: { kind: "metal", color: "#e6e4df" },
  table: { kind: "wood", color: "#c49a6c" },
  chair: { kind: "fabric", color: "#55606b" },
  cabinet: { kind: "metal", color: "#e3e1dc" },
  shelf: { kind: "darkwood", color: "#5b4636" },
  lamp: { kind: "metal", color: "#2b2b2b" },
  rug: { kind: "fabric", color: "#8a5a44" },
  plant: { kind: "plant", color: "#4f7a4a" },
  monitor: { kind: "plastic", color: "#1d1f22" },
  sofa: { kind: "fabric", color: "#8c8f86" },
  bed: { kind: "fabric", color: "#d7d2c8" },
};

const mainMat = (o: SceneObject) => {
  const d = DEFAULTS[o.type] ?? { kind: "paint" as const, color: "#cfcac2" };
  return material(o.material ?? d.kind, o.color ?? d.color, o.look);
};
const steel = () => material("metal", "#2a2b2d");
const brushed = () => material("metal", "#b9b7b2");

export function ObjectBody({ obj }: { obj: SceneObject }) {
  const model = obj.parts?.length ? null : modelFor(obj);
  return model ? <ModelBody name={model} obj={obj} fallback={<ProceduralBody obj={obj} />} /> : <ProceduralBody obj={obj} />;
}

function ProceduralBody({ obj }: { obj: SceneObject }) {
  if (obj.parts?.length) return <Parts parts={obj.parts} fallback={mainMat(obj)} />;
  switch (obj.type) {
    case "door": return <Door o={obj} />;
    case "drawer": return <Drawer o={obj} />;
    case "table": return <Table o={obj} />;
    case "chair": return <Chair o={obj} />;
    case "cabinet": return <Cabinet o={obj} />;
    case "shelf": return <Shelf o={obj} />;
    case "lamp": return <Lamp o={obj} />;
    case "rug": return <Rug o={obj} />;
    case "plant": return <Plant o={obj} />;
    case "monitor": return <Monitor o={obj} />;
    case "sofa": return <Sofa o={obj} />;
    default: return <RB s={obj.size} p={[0, obj.size[1] / 2, 0]} r={0.02} m={mainMat(obj)} />;
  }
}

function Parts({ parts, fallback }: { parts: Part[]; fallback: THREE.Material }) {
  return (
    <>
      {parts.map((part, i) => {
        const m = part.color || part.material ? material(part.material ?? "paint", part.color ?? "#cfcac2") : fallback;
        const [w, h, d] = part.size;
        if (part.shape === "cylinder") return <Cyl key={i} r={w / 2} h={h} p={part.offset} m={m} />;
        if (part.shape === "sphere")
          return (
            <mesh key={i} position={part.offset} scale={[w / 2, h / 2, d / 2]} material={m} castShadow receiveShadow>
              <sphereGeometry args={[1, 24, 16]} />
            </mesh>
          );
        return <RB key={i} s={part.size} p={part.offset as V3} m={m} />;
      })}
    </>
  );
}

function Door({ o }: { o: SceneObject }) {
  const [w, h, d] = o.size;
  const m = mainMat(o);
  const panel = material("paint", `#${new THREE.Color(o.color ?? "#d9cdbb").offsetHSL(0, 0, -0.03).getHexString()}`);
  const hingeLeft = o.articulation?.kind !== "hinge" || o.articulation.pivot[0] <= 0;
  const hx = (hingeLeft ? 1 : -1) * (w / 2 - 0.08);
  return (
    <group>
      <RB s={[w - 0.006, h - 0.006, d]} p={[0, h / 2, 0]} r={0.006} m={m} />
      {[1, -1].map((side) => (
        <group key={side}>
          <RB s={[w - 0.22, h * 0.36, 0.006]} p={[0, h * 0.72, (side * d) / 2]} r={0.002} m={panel} />
          <RB s={[w - 0.22, h * 0.36, 0.006]} p={[0, h * 0.28, (side * d) / 2]} r={0.002} m={panel} />
          <Cyl r={0.028} h={0.012} p={[hx, 1.0, side * (d / 2 + 0.006)]} rot={[Math.PI / 2, 0, 0]} m={brushed()} />
          <RB s={[0.13, 0.02, 0.02]} p={[hx - (hingeLeft ? 0.055 : -0.055), 1.0, side * (d / 2 + 0.03)]} r={0.008} m={brushed()} />
        </group>
      ))}
    </group>
  );
}

function Drawer({ o }: { o: SceneObject }) {
  const [w, h, d] = o.size;
  const m = mainMat(o);
  const inner = material("paint", "#d9d6cf");
  const t = 0.012;
  return (
    <group>
      <RB s={[w, h, 0.02]} p={[0, h / 2, d / 2 - 0.01]} r={0.004} m={m} />
      <RB s={[0.2, 0.022, 0.026]} p={[0, h * 0.62, d / 2 + 0.013]} r={0.008} m={brushed()} />
      <RB s={[w - 0.04, t, d - 0.03]} p={[0, 0.02, -0.005]} r={0.002} m={inner} />
      <RB s={[t, h - 0.06, d - 0.03]} p={[-(w / 2 - 0.02), h / 2 - 0.01, -0.005]} r={0.002} m={inner} />
      <RB s={[t, h - 0.06, d - 0.03]} p={[w / 2 - 0.02, h / 2 - 0.01, -0.005]} r={0.002} m={inner} />
      <RB s={[w - 0.04, h - 0.06, t]} p={[0, h / 2 - 0.01, -d / 2 + 0.02]} r={0.002} m={inner} />
      {["#d8b25a", "#5a7fb5", "#c2665a"].map((c, i) => (
        <RB key={c} s={[w - 0.1, h * 0.55, 0.012]} p={[0, 0.03 + (h * 0.55) / 2, -d / 2 + 0.08 + i * 0.05]} r={0.002} m={material("paint", c)} />
      ))}
    </group>
  );
}

function Table({ o }: { o: SceneObject }) {
  const [w, h, d] = o.size;
  const top = 0.04;
  const legs: V3[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) legs.push([sx * (w / 2 - 0.06), (h - top) / 2, sz * (d / 2 - 0.06)]);
  return (
    <group>
      <RB s={[w, top, d]} p={[0, h - top / 2, 0]} r={0.008} m={mainMat(o)} />
      {legs.map((p, i) => (
        <RB key={i} s={[0.04, h - top, 0.04]} p={p} r={0.006} m={steel()} />
      ))}
      <RB s={[w - 0.14, 0.05, 0.02]} p={[0, h - top - 0.03, -(d / 2 - 0.06)]} r={0.004} m={steel()} />
    </group>
  );
}

function Chair({ o }: { o: SceneObject }) {
  const [w, h, d] = o.size;
  const m = mainMat(o);
  const seatH = Math.min(0.47, h * 0.53);
  const legs: V3[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) legs.push([sx * (w / 2 - 0.06), (seatH - 0.04) / 2, sz * (d / 2 - 0.06)]);
  return (
    <group>
      <RB s={[w, 0.07, d * 0.94]} p={[0, seatH, 0.01]} r={0.03} m={m} />
      <RB s={[w * 0.94, h - seatH - 0.03, 0.06]} p={[0, seatH + (h - seatH) / 2, -d / 2 + 0.05]} r={0.028} m={m} rot={[-0.1, 0, 0]} />
      {legs.map((p, i) => (
        <Cyl key={i} r={0.014} h={seatH - 0.04} p={p} m={steel()} seg={12} />
      ))}
    </group>
  );
}

function Cabinet({ o }: { o: SceneObject }) {
  const [w, h, d] = o.size;
  const m = mainMat(o);
  // Lower drawer fronts; the top one is usually its own articulated `drawer` object.
  const lower = 2;
  const fh = (h - 0.3) / lower;
  return (
    <group>
      <RB s={[w, h, d]} p={[0, h / 2, 0]} r={0.01} m={m} />
      {Array.from({ length: lower }, (_, i) => {
        const y = 0.05 + fh * i + fh / 2;
        return (
          <group key={i}>
            <RB s={[w - 0.04, fh - 0.02, 0.012]} p={[0, y, d / 2 + 0.006]} r={0.003} m={m} />
            <RB s={[0.2, 0.022, 0.026]} p={[0, y + fh * 0.2, d / 2 + 0.024]} r={0.008} m={brushed()} />
          </group>
        );
      })}
    </group>
  );
}

const BOOK_COLORS = ["#c96f53", "#e3c27a", "#4d6f8f", "#7e9b6e", "#efe7da", "#2f3a48", "#a8564b", "#d9a441", "#6b5b8c"];

function Shelf({ o }: { o: SceneObject }) {
  const [w, h, d] = o.size;
  const m = mainMat(o);
  const t = 0.025;
  const rows = Math.max(2, Math.round(h / 0.38));
  const gap = (h - t) / rows;
  const books = useMemo(() => {
    const rand = mulberry32(hashSeed(o.id));
    const out: { p: V3; s: V3; c: string; r: number }[] = [];
    for (let row = 0; row < rows; row++) {
      let x = -w / 2 + t + 0.01;
      const y0 = t + row * gap;
      while (x < w / 2 - t - 0.05) {
        if (rand() < 0.12) {
          x += 0.06 + rand() * 0.12;
          continue;
        }
        const bw = 0.02 + rand() * 0.035;
        const bh = Math.min(gap - 0.04, 0.17 + rand() * 0.12);
        const bd = d * (0.62 + rand() * 0.25);
        out.push({ p: [x + bw / 2, y0 + bh / 2, (d - bd) / 2 - 0.015], s: [bw, bh, bd], c: BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)], r: 0 });
        x += bw + 0.002;
      }
    }
    return out;
  }, [o.id, w, d, rows, gap]);
  const bookMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.8 }), []);
  return (
    <group>
      <RB s={[t, h, d]} p={[-(w / 2 - t / 2), h / 2, 0]} r={0.004} m={m} />
      <RB s={[t, h, d]} p={[w / 2 - t / 2, h / 2, 0]} r={0.004} m={m} />
      <RB s={[w - 0.004, t, d]} p={[0, h - t / 2, 0]} r={0.004} m={m} />
      <RB s={[w - 0.004, h - 0.01, 0.01]} p={[0, h / 2, -d / 2 + 0.005]} r={0.002} m={m} />
      {Array.from({ length: rows }, (_, i) => (
        <RB key={i} s={[w - 2 * t, t, d - 0.012]} p={[0, t / 2 + i * gap, 0.006]} r={0.003} m={m} />
      ))}
      <Instances limit={books.length || 1} material={bookMat} castShadow receiveShadow>
        <boxGeometry />
        {books.map((b, i) => (
          <Instance key={i} position={b.p} scale={b.s} color={b.c} />
        ))}
      </Instances>
    </group>
  );
}

function Lamp({ o }: { o: SceneObject }) {
  const [w, h] = o.size;
  const value = useJointValue();
  const light = useRef<THREE.PointLight>(null!);
  const spot = useRef<THREE.SpotLight>(null!);
  const bulb = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#fff3dc", emissive: new THREE.Color(o.light?.color ?? "#ffd29a"), emissiveIntensity: 0, toneMapped: false }),
    [o.light?.color],
  );
  const shadeInner = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#f4efe6", side: THREE.BackSide, emissive: new THREE.Color(o.light?.color ?? "#ffd29a"), emissiveIntensity: 0 }),
    [o.light?.color],
  );
  const intensity = o.light?.intensity ?? 3;
  const tilt = 0.35;
  const shadeY = h * 0.78;
  const target = useMemo(() => {
    const t = new THREE.Object3D();
    t.position.set(0, -1, 0.35);
    return t;
  }, []);
  useFrame(() => {
    const v = value.current;
    light.current.intensity = v * intensity * 0.35;
    spot.current.intensity = v * intensity * 2.2;
    bulb.emissiveIntensity = 0.2 + v * 9;
    shadeInner.emissiveIntensity = v * 0.9;
  });
  const m = mainMat(o);
  return (
    <group>
      <Cyl r={w * 0.42} rb={w * 0.46} h={0.022} p={[0, 0.011, 0]} m={m} />
      <Cyl r={0.008} h={shadeY} p={[0, shadeY / 2, -0.01]} m={m} seg={10} />
      <group position={[0, shadeY, 0.02]} rotation={[tilt, 0, 0]}>
        <mesh material={m} castShadow>
          <cylinderGeometry args={[w * 0.16, w * 0.44, h * 0.26, 40, 1, true]} />
        </mesh>
        <mesh material={shadeInner}>
          <cylinderGeometry args={[w * 0.158, w * 0.438, h * 0.26, 40, 1, true]} />
        </mesh>
        <mesh position={[0, -h * 0.05, 0]} material={bulb}>
          <sphereGeometry args={[0.028, 20, 14]} />
        </mesh>
        <pointLight ref={light} position={[0, -h * 0.08, 0]} color={o.light?.color} distance={o.light?.distance ?? 6} decay={2} intensity={0} />
        <primitive object={target} />
        <spotLight
          ref={spot}
          position={[0, -h * 0.06, 0]}
          target={target}
          angle={0.85}
          penumbra={0.9}
          color={o.light?.color}
          distance={o.light?.distance ?? 6}
          decay={2}
          intensity={0}
        />
      </group>
    </group>
  );
}

function Rug({ o }: { o: SceneObject }) {
  const [w, h, d] = o.size;
  const base = new THREE.Color(o.color ?? "#8a5a44");
  const inner = material("fabric", `#${base.clone().offsetHSL(0, -0.05, 0.12).getHexString()}`);
  const core = material("fabric", `#${base.clone().offsetHSL(0, 0, 0.02).getHexString()}`);
  const th = Math.max(h, 0.01);
  return (
    <group>
      <RB s={[w, th, d]} p={[0, th / 2, 0]} r={0.003} m={mainMat(o)} />
      <RB s={[w - 0.14, th + 0.002, d - 0.14]} p={[0, th / 2 + 0.001, 0]} r={0.003} m={inner} />
      <RB s={[w - 0.3, th + 0.004, d - 0.3]} p={[0, th / 2 + 0.002, 0]} r={0.003} m={core} />
    </group>
  );
}

function Plant({ o }: { o: SceneObject }) {
  const [w, h] = o.size;
  const potH = h * 0.32;
  const pot = material("ceramic", "#e8e3da");
  const leaves = useMemo(() => {
    const rand = mulberry32(hashSeed(o.id));
    const base = new THREE.Color(o.color ?? "#4f7a4a");
    return Array.from({ length: 9 }, () => {
      const a = rand() * Math.PI * 2;
      const rr = rand() * w * 0.28;
      const y = potH + (h - potH) * (0.25 + rand() * 0.6);
      return {
        p: [Math.cos(a) * rr, y, Math.sin(a) * rr] as V3,
        r: w * (0.16 + rand() * 0.14),
        m: material("plant", `#${base.clone().offsetHSL((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.12).getHexString()}`),
      };
    });
  }, [o.id, o.color, w, h, potH]);
  return (
    <group>
      <Cyl r={w * 0.3} rb={w * 0.22} h={potH} p={[0, potH / 2, 0]} m={pot} />
      <Cyl r={w * 0.28} h={0.01} p={[0, potH - 0.02, 0]} m={material("paint", "#3b2d22")} />
      <Cyl r={0.012} h={h * 0.45} p={[0, potH + h * 0.2, 0]} m={material("wood", "#6d5a3e")} seg={8} />
      {leaves.map((l, i) => (
        <mesh key={i} position={l.p} material={l.m} castShadow receiveShadow>
          <icosahedronGeometry args={[l.r, 1]} />
        </mesh>
      ))}
    </group>
  );
}

function Monitor({ o }: { o: SceneObject }) {
  const [w, h, d] = o.size;
  const m = mainMat(o);
  const screenH = h * 0.66;
  const screen = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 300;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 512, 300);
    grad.addColorStop(0, "#1b2a3a");
    grad.addColorStop(1, "#3a2f4a");
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 300);
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.fillRect(40, 40, 260, 170);
    g.fillStyle = "rgba(198,243,107,0.9)";
    g.fillRect(40, 40, 260, 14);
    g.fillStyle = "rgba(255,255,255,0.5)";
    g.fillRect(320, 70, 150, 110);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.55, roughness: 0.25 });
  }, []);
  return (
    <group>
      <RB s={[w * 0.34, 0.014, d * 0.75]} p={[0, 0.007, 0]} r={0.005} m={m} />
      <RB s={[0.045, h * 0.42, 0.025]} p={[0, h * 0.21, -d * 0.12]} r={0.006} m={m} />
      <RB s={[w, screenH, 0.025]} p={[0, h - screenH / 2, -d * 0.02]} r={0.006} m={m} />
      <mesh position={[0, h - screenH / 2, -d * 0.02 + 0.0131]} material={screen}>
        <planeGeometry args={[w - 0.025, screenH - 0.025]} />
      </mesh>
    </group>
  );
}

function Sofa({ o }: { o: SceneObject }) {
  const [w, h, d] = o.size;
  const m = mainMat(o);
  const arm = 0.16;
  const foot = 0.07;
  const baseH = 0.2;
  const innerW = w - 2 * arm;
  const cushionH = 0.15;
  return (
    <group>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <Cyl key={`${sx}${sz}`} r={0.02} h={foot} p={[sx * (w / 2 - 0.08), foot / 2, sz * (d / 2 - 0.08)]} m={material("darkwood", "#4a3a2c")} seg={12} />))}
      <RB s={[w, baseH, d]} p={[0, foot + baseH / 2, 0]} r={0.04} m={m} />
      {[-1, 1].map((sx) => (
        <RB key={sx} s={[innerW / 2 - 0.01, cushionH, d - 0.24]} p={[(sx * innerW) / 4, foot + baseH + cushionH / 2 - 0.02, 0.1]} r={0.05} m={m} />
      ))}
      <RB s={[w, h - foot - 0.02, 0.2]} p={[0, foot + (h - foot) / 2, -d / 2 + 0.1]} r={0.06} m={m} />
      {[-1, 1].map((sx) => (
        <RB key={`a${sx}`} s={[innerW / 2 - 0.02, 0.38, 0.14]} p={[(sx * innerW) / 4, foot + baseH + cushionH + 0.15, -d / 2 + 0.25]} r={0.06} m={m} rot={[-0.12, 0, 0]} />
      ))}
      {[-1, 1].map((sx) => (
        <RB key={`r${sx}`} s={[arm, h * 0.72, d]} p={[sx * (w / 2 - arm / 2), foot + (h * 0.72) / 2, 0]} r={0.06} m={m} />
      ))}
    </group>
  );
}

export const asV3 = (v: Vec3) => v as V3;
