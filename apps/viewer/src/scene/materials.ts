// Material presets by kind, cached by kind+color so the whole scene shares a handful of materials.
// The look is "architectural maquette": soft, matte, warm — not photoreal.
import * as THREE from "three";
import type { Look, MaterialKind } from "@doorway/schema";

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

export function material(kind: MaterialKind = "paint", color = "#d8d4cc", look?: Look): THREE.MeshPhysicalMaterial {
  const key = `${kind}|${color}|${look ?? ""}`;
  let m = cache.get(key);
  if (!m) {
    const c = new THREE.Color(color);
    const peak = Math.max(c.r, c.g, c.b);
    if (peak > 0.9) c.multiplyScalar(0.9 / peak); // pure white blooms like a lamp; keep surfaces below that
    m = new THREE.MeshPhysicalMaterial({ color: c, ...PRESETS[kind] });
    if (look && look !== "wood") {
      const t = lookTexture(look).clone();
      t.repeat.set(look === "paper" ? 1 : 4, look === "paper" ? 1 : 4);
      t.needsUpdate = true;
      m.map = t;
      m.bumpMap = t;
      m.bumpScale = look === "brick" || look === "plush" ? 1.5 : 0.6;
    }
    if (kind === "fabric") m.sheenColor = new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.35);
    if (kind === "wood" || kind === "darkwood") {
      m.map = woodGrain();
    }
    cache.set(key, m);
  }
  return m;
}

/** Wall surface sized in metres so bricks and plaster keep their real scale on any wall. */
const wallCache = new Map<string, THREE.MeshPhysicalMaterial>();
export function wallMaterial(look: Look | undefined, color: string, along: number, h: number): THREE.MeshPhysicalMaterial {
  if (!look || look === "wood") return material("paint", color);
  const key = `${look}|${color}|${along.toFixed(2)}|${h.toFixed(2)}`;
  let m = wallCache.get(key);
  if (!m) {
    const t = lookTexture(look).clone();
    const [tw, th] = LOOK_TILE_M[look];
    t.repeat.set(along / tw, h / th);
    t.needsUpdate = true;
    m = new THREE.MeshPhysicalMaterial({ color: look === "brick" ? "#ffffff" : color, map: t, bumpMap: t, bumpScale: look === "brick" ? 2 : 0.5, roughness: look === "brick" ? 0.9 : 0.8 });
    wallCache.set(key, m);
  }
  return m;
}

/** Size in metres of one texture tile when used on a wall. */
const LOOK_TILE_M: Record<Look, [number, number]> = {
  brick: [1.72, 0.54], plaster: [1.5, 1.5], concrete: [2, 2], carpet: [1, 1], weave: [0.5, 0.5], plush: [0.5, 0.5], paper: [1, 1], wood: [1, 1], tile: [1.2, 1.2],
};

const looks = new Map<Look, THREE.CanvasTexture>();
/** Grayscale-ish procedural patterns, multiplied by the object's colour (brick carries its own colours). */
export function lookTexture(look: Look): THREE.CanvasTexture {
  let tex = looks.get(look);
  if (tex) return tex;
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const rand = mulberry32(hashSeed(look));
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, S, S);
  const speckle = (n: number, size: number, a: number) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = `rgba(${rand() > 0.5 ? "255,255,255" : "0,0,0"},${rand() * a})`;
      g.fillRect(rand() * S, rand() * S, size, size);
    }
  };
  if (look === "brick") {
    g.fillStyle = "#b9aea0"; // mortar
    g.fillRect(0, 0, S, S);
    const rows = 8, cols = 4, bh = S / rows, bw = S / cols;
    for (let r = 0; r < rows; r++) {
      for (let k = -1; k <= cols; k++) {
        const x = k * bw + (r % 2 ? bw / 2 : 0);
        const hue = 8 + rand() * 10, l = 30 + rand() * 14;
        g.fillStyle = `hsl(${hue} ${48 + rand() * 14}% ${l}%)`;
        g.fillRect(x + 3, r * bh + 3, bw - 6, bh - 6);
      }
    }
    speckle(5000, 2, 0.18);
  } else if (look === "plaster") {
    speckle(9000, 2, 0.05);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(0,0,0,${rand() * 0.025})`;
      g.beginPath();
      g.arc(rand() * S, rand() * S, 8 + rand() * 40, 0, 7);
      g.fill();
    }
  } else if (look === "concrete") {
    speckle(6000, 3, 0.07);
    for (let i = 0; i < 80; i++) {
      g.fillStyle = `rgba(0,0,0,${rand() * 0.05})`;
      g.beginPath();
      g.arc(rand() * S, rand() * S, 12 + rand() * 60, 0, 7);
      g.fill();
    }
  } else if (look === "carpet" || look === "plush") {
    speckle(look === "plush" ? 26000 : 16000, look === "plush" ? 3 : 2, look === "plush" ? 0.22 : 0.12);
  } else if (look === "weave") {
    g.strokeStyle = "rgba(0,0,0,0.09)";
    g.lineWidth = 1;
    for (let i = 0; i <= S; i += 8) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke();
    }
    speckle(3000, 2, 0.06);
  } else if (look === "paper") {
    g.strokeStyle = "rgba(60,90,160,0.22)";
    for (let y = 40; y < S; y += 28) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
    }
  } else if (look === "tile") {
    g.strokeStyle = "rgba(0,0,0,0.25)";
    g.lineWidth = 3;
    for (let i = 0; i <= S; i += S / 2) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke();
    }
    speckle(2000, 2, 0.05);
  }
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  looks.set(look, tex);
  return tex;
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
