// Argon's findings pinned onto the objects themselves: a pulsing red ring and
// label on every open mismatch, and a green "fixed" ring that blooms and fades
// on whatever the current iteration just corrected.
// Every object keeps one mounted marker whose state changes: unmounting drei
// <Html> roots mid-render races React 19 and throws, so markers never unmount.
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { motion } from "framer-motion";
import * as THREE from "three";
import type { Issue, Scene, SceneObject } from "@doorway/schema";
import { ACCENT } from "./materials";
import { cap } from "../ui/plain";

const RED = "#ef6b6b";
/** Past this many, extra problems keep their ring but lose the name tag so labels never pile up. */
const MAX_LABELS = 4;
const RANK = { high: 0, medium: 1, low: 2 } as const;

export function IssueMarkers({ scene, issues, fixed, k }: { scene: Scene; issues: Issue[]; fixed: Issue[]; k: number | null }) {
  const byId = useMemo(() => new Map(scene.objects.map((o) => [o.id, o])), [scene]);
  // One marker per object, even if Argon raised several issues on it.
  const open = useMemo(() => dedupe(issues).filter((i) => byId.has(i.objectId)).sort((a, b) => RANK[a.severity] - RANK[b.severity]), [issues, byId]);
  const done = useMemo(() => dedupe(fixed).filter((i) => byId.has(i.objectId) && !open.some((o) => o.objectId === i.objectId)), [fixed, open, byId]);
  const openById = new Map(open.map((i, n) => [i.objectId, { i, n }]));
  const doneById = new Map(done.map((i, n) => [i.objectId, { i, n: n + open.length }]));
  // Name tags: most severe first, skipping any whose object sits close to one already tagged.
  const tagged = new Map<string, number>();
  for (const i of [...open, ...done]) {
    const o = byId.get(i.objectId)!;
    const clash = [...tagged.keys()].some((id) => {
      const t = byId.get(id)!;
      return Math.hypot(t.position[0] - o.position[0], t.position[2] - o.position[2]) < 1.1;
    });
    if (!clash && tagged.size < MAX_LABELS) tagged.set(i.objectId, tagged.size);
  }
  // A fixed pool of marker slots that only ever grows: switching rooms swaps every object,
  // and unmounting that many drei <Html> roots at once throws under React 19.
  const pool = useRef(MIN_SLOTS);
  pool.current = Math.max(pool.current, scene.objects.length);
  return (
    <group>
      {Array.from({ length: pool.current }, (_, slot) => {
        const o = scene.objects[slot];
        if (!o) return <Marker key={slot} o={PARKED} lift={0} labeled={false} state="none" nonce={0} />;
        const hit = openById.get(o.id) ?? doneById.get(o.id);
        const state = openById.has(o.id) ? "open" : doneById.has(o.id) ? "fixed" : "none";
        return <Marker key={slot} o={o} issue={hit?.i} lift={(tagged.get(o.id) ?? 0) * 0.3} labeled={tagged.has(o.id)} state={state} nonce={k ?? 0} />;
      })}
    </group>
  );
}

const MIN_SLOTS = 48;
/** Stand-in for an empty slot: hidden, far below the floor. */
const PARKED = { id: "parked", type: "box", position: [0, -50, 0], rotationY: 0, size: [0.1, 0.1, 0.1], decor: false } as unknown as SceneObject;

function dedupe(list: Issue[]) {
  const seen = new Map<string, Issue>();
  for (const i of list) if (!seen.has(i.objectId)) seen.set(i.objectId, i);
  return [...seen.values()];
}

function Marker({ o, lift, labeled, state, nonce }: { o: SceneObject; issue?: Issue; lift: number; labeled: boolean; state: "open" | "fixed" | "none"; nonce: number }) {
  const ring = useRef<THREE.Mesh>(null!);
  const mat = useRef<THREE.MeshBasicMaterial>(null!);
  const born = useRef(performance.now());
  // Restart the "fixed" bloom whenever the iteration changes.
  useEffect(() => void (born.current = performance.now()), [nonce, state]);
  const color = state === "open" ? RED : ACCENT;
  const r = Math.max(o.size[0], o.size[2]) * 0.62 + 0.08;

  useFrame(() => {
    const t = (performance.now() - born.current) / 1000;
    ring.current.visible = state !== "none";
    if (state === "open") {
      const pulse = 1 + Math.sin(t * 4) * 0.05;
      ring.current.scale.setScalar(pulse);
      mat.current.opacity = 0.55 + Math.sin(t * 4) * 0.2;
    } else {
      // Bloom outward, then fade away over ~3.5 s.
      ring.current.scale.setScalar(1 + Math.min(t, 1) * 0.35);
      mat.current.opacity = Math.max(0, 0.9 - Math.max(0, t - 1.2) / 2.3);
    }
  });

  return (
    <group position={[o.position[0], o.position[1], o.position[2]]}>
      <mesh ref={ring} position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
        <ringGeometry args={[r, r + 0.035, 64]} />
        <meshBasicMaterial ref={mat} color={color} transparent toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <Html position={[0, o.size[1] + 0.3 + lift, 0]} center zIndexRange={[25, 0]}>
        {state !== "none" && labeled && (
        <motion.div
          key={`${state}-${nonce}`}
          initial={{ opacity: 0, y: 8, scale: 0.9 }}
          animate={state === "open" ? { opacity: 1, y: 0, scale: 1 } : { opacity: [0, 1, 1, 0], y: [8, 0, 0, -10], scale: [0.9, 1.08, 1, 1] }}
          transition={state === "open" ? { duration: 0.35 } : { duration: 3.4, times: [0, 0.12, 0.7, 1] }}
          className={`pointer-events-none flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] whitespace-nowrap shadow-lg backdrop-blur ${
            state === "open" ? "border-bad/60 bg-ink/85 text-fg" : "border-accent/70 bg-ink/85 text-fg"
          }`}
        >
          {state === "open" ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-bad" />
              <span className="font-medium">{cap(o.label ?? o.type)}</span>
            </>
          ) : (
            <>
              <span className="text-accent">✓</span>
              <span className="font-medium">{cap(o.label ?? o.type)} fixed</span>
            </>
          )}
        </motion.div>
        )}
      </Html>
    </group>
  );
}
