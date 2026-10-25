// Top-down map of the room with the phone's recovered path. The cone is where the camera is
// looking at the footage's current time, so a wrong path is visible next to the wrong frame.
import { useMemo } from "react";
import type { Scene } from "@doorway/schema";
import { useApp } from "../store";
import { cameraAt, pathPoints } from "../scene/cameraPath";

const FOV = (55 * Math.PI) / 180;

export function CameraMinimap({ scene }: { scene: Scene }) {
  const t = useApp((s) => s.videoTime);
  const { width: W, depth: D } = scene.room;
  const keys = scene.camera_path;
  const line = useMemo(() => pathPoints(keys).map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`).join(" "), [keys]);
  const { pos, look } = cameraAt(keys, t);
  const heading = Math.atan2(look.z - pos.z, look.x - pos.x);
  const reach = 0.9;
  const edge = (a: number) => `${(pos.x + Math.cos(a) * reach).toFixed(3)},${(pos.z + Math.sin(a) * reach).toFixed(3)}`;
  const pad = 0.4;
  return (
    <div className="pointer-events-none absolute top-24 left-5 z-10 w-52 rounded-lg border border-line bg-ink/80 p-2 backdrop-blur">
      <div className="mb-1 flex justify-between text-[10px] tracking-wide text-muted uppercase">
        <span>Camera path</span>
        <span className="tabular">{t.toFixed(1)}s</span>
      </div>
      <svg viewBox={`${-W / 2 - pad} ${-D / 2 - pad} ${W + 2 * pad} ${D + 2 * pad}`} className="w-full">
        <rect x={-W / 2} y={-D / 2} width={W} height={D} fill="none" stroke="#8a8f98" strokeWidth={0.03} />
        {scene.objects.map((o) => (
          <rect
            key={o.id}
            x={-o.size[0] / 2}
            y={-o.size[2] / 2}
            width={o.size[0]}
            height={o.size[2]}
            transform={`translate(${o.position[0]} ${o.position[2]}) rotate(${(-o.rotationY * 180) / Math.PI})`}
            fill={o.type === "door" || o.type === "rug" ? "none" : "#5b616b"}
            stroke="#8a8f98"
            strokeWidth={0.015}
          />
        ))}
        <polyline points={line} fill="none" stroke="var(--color-accent, #7cf0c8)" strokeWidth={0.035} opacity={0.8} />
        {keys.map((k, i) => (
          <circle key={i} cx={k.position[0]} cy={k.position[2]} r={0.035} fill="var(--color-accent, #7cf0c8)" />
        ))}
        <polygon points={`${pos.x},${pos.z} ${edge(heading - FOV / 2)} ${edge(heading + FOV / 2)}`} fill="#ffffff" opacity={0.35} />
        <circle cx={pos.x} cy={pos.z} r={0.07} fill="#fff" />
      </svg>
    </div>
  );
}
