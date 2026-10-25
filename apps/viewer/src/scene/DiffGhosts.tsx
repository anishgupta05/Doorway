// Before/after between iterations: a ghost box where each changed object used to
// be, a dashed line to where it is now, and a label saying what the loop fixed.
import { useMemo } from "react";
import { Edges, Html, Line } from "@react-three/drei";
import * as THREE from "three";
import type { Scene, SceneObject } from "@doorway/schema";
import { ACCENT } from "./materials";

type Change = { id: string; label: string; from?: SceneObject; to?: SceneObject; notes: string[] };

const deg = (r: number) => Math.round((r * 180) / Math.PI);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function diffScenes(prev: Scene, next: Scene): Change[] {
  const before = new Map(prev.objects.map((o) => [o.id, o]));
  const after = new Map(next.objects.map((o) => [o.id, o]));
  const out: Change[] = [];
  for (const [id, to] of after) {
    const from = before.get(id);
    const label = to.label ?? id;
    if (!from) {
      out.push({ id, label, to, notes: ["added"] });
      continue;
    }
    const notes: string[] = [];
    const moved = Math.hypot(to.position[0] - from.position[0], to.position[1] - from.position[1], to.position[2] - from.position[2]);
    if (moved > 0.04) notes.push(`moved ${moved.toFixed(2)} m`);
    const turned = Math.abs(wrap(to.rotationY - from.rotationY));
    if (turned > 0.08) notes.push(`turned ${deg(turned)}°`);
    const resized = to.size.some((s, i) => Math.abs(s - from.size[i]) > 0.03);
    if (resized) notes.push(`resized to ${to.size.map((s) => s.toFixed(2)).join("×")}`);
    if ((to.color ?? "") !== (from.color ?? "")) notes.push("recolored");
    if (JSON.stringify(to.articulation) !== JSON.stringify(from.articulation)) {
      notes.push(to.articulation?.kind === "hinge" ? "hinge fixed" : `${to.articulation?.kind ?? "joint"} fixed`);
    }
    if (notes.length) out.push({ id, label, from, to, notes });
  }
  for (const [id, from] of before) if (!after.has(id)) out.push({ id, label: from.label ?? id, from, notes: ["removed"] });
  return out;
}

const center = (o: SceneObject) => new THREE.Vector3(o.position[0], o.position[1] + o.size[1] / 2, o.position[2]);

export function DiffGhosts({ prev, scene }: { prev: Scene; scene: Scene }) {
  const changes = useMemo(() => diffScenes(prev, scene), [prev, scene]);
  return (
    <group>
      {changes.map((c, idx) => {
        const a = c.from && center(c.from);
        const b = c.to && center(c.to);
        const anchor = (b ?? a)!.clone().setY((c.to ?? c.from)!.position[1] + (c.to ?? c.from)!.size[1] + 0.25 + (idx % 3) * 0.24);
        return (
          <group key={c.id}>
            {c.from && (
              <mesh position={a} rotation={[0, c.from.rotationY, 0]}>
                <boxGeometry args={c.from.size} />
                <meshBasicMaterial color={ACCENT} transparent opacity={0.06} depthWrite={false} toneMapped={false} />
                <Edges color={c.to ? ACCENT : "#ef6b6b"} />
              </mesh>
            )}
            {a && b && a.distanceTo(b) > 0.04 && <Line points={[a, b]} color={ACCENT} lineWidth={1.5} dashed dashSize={0.06} gapSize={0.04} toneMapped={false} />}
            <Html position={anchor} center zIndexRange={[20, 0]}>
              <div className="pointer-events-none whitespace-nowrap rounded-md border border-accent/40 bg-ink/85 px-2 py-1 font-mono text-[10.5px] leading-tight text-fg shadow-lg backdrop-blur">
                <span className="text-accent">{c.id}</span>
                <span className="text-muted"> · {c.notes.join(" · ")}</span>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}
