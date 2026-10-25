// Material presets by kind, cached by kind+color so the whole scene shares a handful of materials.
// The look is "architectural maquette": soft, matte, warm — not photoreal.
import * as THREE from "three";
import type { MaterialKind } from "@doorway/schema";

type Preset = Partial<THREE.MeshPhysicalMaterialParameters>;

const PRESETS: Record<MaterialKind, Preset> = {
  wood: { roughness: 0.62, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.6 },
  darkwood: { roughness: 0.55, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.5 },
  fabric: { roughness: 0.95, metalness: 0, sheen: 0.6, sheenRoughness: 0.8 },
  leather: { roughness: 0.45, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.4 },
  metal: { roughness: 0.38, metalness: 0.55 },
  plastic: { roughness: 0.42, metalness: 0 },
  glass: { roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18 },
  ceramic: { roughness: 0.3, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.2 },
  paint: { roughness: 0.72, metalness: 0 },
  plant: { roughness: 0.8, metalness: 0, flatShading: true },
};

const cache = new Map<string, THREE.MeshPhysicalMaterial>();

export function material(kind: MaterialKind = "paint", color = "#d8d4cc"): THREE.MeshPhysicalMaterial {
  const key = `${kind}|${color}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color, ...PRESETS[kind] });
    if (kind === "fabric") m.sheenColor = new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.35);
    if (kind === "wood" || kind === "darkwood") {
      m.map = woodGrain();
    }
    cache.set(key, m);
  }
  return m;
}

/** Subtle grayscale grain multiplied into wood colors. */
let grain: THREE.CanvasTexture | null = null;
function woodGrain() {
  if (grain) return grain;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 256, 256);
  const rand = mulberry32(7);
  for (let i = 0; i < 90; i++) {
    const y = rand() * 256;
    g.strokeStyle = `rgba(90,60,30,${0.04 + rand() * 0.06})`;
    g.lineWidth = 0.5 + rand() * 2;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 3 * rand());
    g.stroke();
  }
  grain = new THREE.CanvasTexture(c);
  grain.colorSpace = THREE.SRGBColorSpace;
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  return grain;
}

/** Plank floor: alternating board tones with hairline seams. */
export function floorTexture(base: string, kind: "wood" | "concrete" | "carpet" | "tile", w: number, d: number) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext("2d")!;
  const col = new THREE.Color(base);
  const rand = mulberry32(11);
  const tone = (k: number) => {
    const t = col.clone().offsetHSL(0, 0, (k - 0.5) * 0.07);
    return `#${t.getHexString()}`;
  };
  g.fillStyle = tone(0.5);
  g.fillRect(0, 0, 1024, 1024);
  if (kind === "wood") {
    const rows = 16;
    const h = 1024 / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rand() * 400;
      while (x < 1024) {
        const len = 260 + rand() * 360;
        g.fillStyle = tone(rand());
        g.fillRect(x, r * h, len, h);
        g.fillStyle = "rgba(40,25,10,0.18)";
        g.fillRect(x, r * h, 1.5, h);
        x += len;
      }
      g.fillStyle = "rgba(40,25,10,0.22)";
      g.fillRect(0, r * h, 1024, 1.5);
    }
  } else if (kind === "tile") {
    g.fillStyle = "rgba(0,0,0,0.12)";
    for (let i = 0; i <= 8; i++) {
      g.fillRect(i * 128, 0, 2, 1024);
      g.fillRect(0, i * 128, 1024, 2);
    }
  } else {
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(${rand() > 0.5 ? "255,255,255" : "0,0,0"},${rand() * 0.04})`;
      g.fillRect(rand() * 1024, rand() * 1024, 2, 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // One texture tile ≈ 2.4 m of floor (16 boards of 15 cm).
  tex.repeat.set(w / 2.4, d / 2.4);
  tex.anisotropy = 8;
  return tex;
}

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const ACCENT = "#c6f36b";
