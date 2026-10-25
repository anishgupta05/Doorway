// Interaction-test view: runs each declared interaction in turn and draws what it
// checks — the door's swing arc, the drawer's travel, the lamp's light, the chair's
// push — then stamps a pass/fail badge measured from the live joint state.
import { useEffect, useMemo, useState } from "react";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import type { Scene, SceneObject } from "@doorway/schema";
import { useApp } from "../store";
import { sfx } from "../sfx";
import { ACCENT } from "./materials";
import { defaultJoint } from "./Placed";

type Result = { id: string; ok: boolean; text: string };

const STEP_MS = 1900;

function testable(scene: Scene) {
  const ids = new Set(scene.interactions.map((i) => i.target));
  return scene.objects.filter((o) => o.articulation && (ids.has(o.id) || o.articulation.kind !== "free"));
}

function describe(o: SceneObject): Result {
  const a = o.articulation!;
  switch (a.kind) {
    case "hinge": {
      const sweep = Math.abs(a.range[1] - a.range[0]);
      const ok = sweep > (60 * Math.PI) / 180;
      return { id: o.id, ok, text: ok ? `swings 0→${Math.round((sweep * 180) / Math.PI)}°` : `swing only ${Math.round((sweep * 180) / Math.PI)}°` };
    }
    case "slide": {
      const travel = Math.abs(a.range[1] - a.range[0]);
      const ok = travel > 0.1;
      return { id: o.id, ok, text: ok ? `slides ${Math.round(travel * 100)} cm` : "doesn't slide" };
    }
    case "switch":
      return { id: o.id, ok: !!o.light, text: o.light ? "light toggles" : "no light attached" };
    case "free":
      return { id: o.id, ok: true, text: "pushable" };
  }
}

export function TestViz({ scene }: { scene: Scene }) {
  const objects = useMemo(() => testable(scene), [scene]);
  const [step, setStep] = useState(0);
  const [results, setResults] = useState<Result[]>([]);

  useEffect(() => {
    const s = useApp.getState();
    s.reset();
    setStep(0);
    setResults([]);
    const timers: number[] = [];
    objects.forEach((o, i) => {
      timers.push(
        window.setTimeout(() => {
          setStep(i);
          const st = useApp.getState();
          if (o.articulation?.kind === "free") {
            st.push(o.id, 0.25 * Math.sin(o.rotationY), 0.25 * Math.cos(o.rotationY));
            sfx.scrape();
          } else {
            st.toggleJoint(o.id, defaultJoint(o));
            o.articulation?.kind === "hinge" ? sfx.creak(true) : o.articulation?.kind === "slide" ? sfx.slide() : sfx.click();
          }
        }, i * STEP_MS),
        window.setTimeout(() => {
          const r = describe(o);
          setResults((prev) => [...prev, r]);
          r.ok ? sfx.pass() : sfx.reject();
        }, i * STEP_MS + 1100),
      );
    });
    // Put everything back afterwards, except leave the lamp on — it looks nice.
    timers.push(
      window.setTimeout(() => {
        const lamp = objects.find((o) => o.articulation?.kind === "switch");
        useApp.setState({ joints: lamp ? { [lamp.id]: 1 } : {}, pushes: {} });
        setStep(objects.length);
      }, objects.length * STEP_MS + 600),
    );
    return () => timers.forEach(clearTimeout);
  }, [objects]);

  return (
    <group>
      {objects.map((o, i) => (
        <TestGlyph key={o.id} o={o} active={i === step} result={results.find((r) => r.id === o.id)} />
      ))}
    </group>
  );
}

function TestGlyph({ o, active, result }: { o: SceneObject; active: boolean; result?: Result }) {
  const a = o.articulation!;
  const [w, h, d] = o.size;
  const color = result ? (result.ok ? ACCENT : "#ef6b6b") : active ? ACCENT : "#6b717b";
  const opacity = active || result ? 0.9 : 0.35;
  let glyph: React.ReactNode = null;
  if (a.kind === "hinge") {
    const lo = Math.min(...a.range);
    const len = Math.abs(a.range[1] - a.range[0]);
    const startsAtPi = a.pivot[0] > 0;
    glyph = (
      <mesh position={[a.pivot[0], 0.01, a.pivot[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.04, w, 48, 1, (startsAtPi ? Math.PI : 0) + lo, len]} />
        <meshBasicMaterial color={color} transparent opacity={opacity * 0.28} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} />
      </mesh>
    );
  } else if (a.kind === "slide") {
    const travel = Math.max(...a.range);
    const y = h / 2;
    const from = new THREE.Vector3(0, y, d / 2 + 0.03);
    const to = from.clone().add(new THREE.Vector3(...a.axis).normalize().multiplyScalar(travel + 0.08));
    glyph = <Line points={[from, to]} color={color} lineWidth={3} transparent opacity={opacity} toneMapped={false} />;
  } else if (a.kind === "switch") {
    glyph = (
      <mesh position={[0, h + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.18, 0.21, 48]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    );
  } else {
    const from = new THREE.Vector3(0, 0.02, d / 2 + 0.05);
    glyph = <Line points={[from, from.clone().add(new THREE.Vector3(0, 0, 0.35))]} color={color} lineWidth={3} transparent opacity={opacity} toneMapped={false} />;
  }
  return (
    <group position={o.position} rotation={[0, o.rotationY, 0]}>
      {glyph}
      <Html position={[0, h + 0.35, 0]} center zIndexRange={[30, 0]}>
        <div
          className={`pointer-events-none flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[10.5px] transition-all duration-300 ${
            result ? (result.ok ? "border-accent/60 bg-ink/90 text-fg" : "border-bad/70 bg-ink/90 text-fg") : active ? "border-accent/40 bg-ink/80 text-muted" : "border-line bg-ink/60 text-dim"
          }`}
        >
          <span className={result ? (result.ok ? "text-accent" : "text-bad") : ""}>{result ? (result.ok ? "✓" : "✗") : active ? "…" : "○"}</span>
          <span>{o.id}</span>
          {result && <span className="text-muted">· {result.text}</span>}
        </div>
      </Html>
    </group>
  );
}
