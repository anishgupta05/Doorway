// One key from the reconstructed room to a MuJoCo model a robotics team can load.
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { Scene } from "@doorway/schema";
import { toMJCF } from "@doorway/export";
import { useApp } from "../store";

export function ExportPanel({ scene }: { scene: Scene }) {
  const xml = useMemo(() => toMJCF(scene), [scene]);
  const [copied, setCopied] = useState(false);
  const joints = scene.objects.filter((o) => o.articulation?.kind === "hinge" || o.articulation?.kind === "slide").length;
  const free = scene.objects.filter((o) => o.articulation?.kind === "free" || o.physics?.body === "dynamic").length;
  const lights = scene.objects.filter((o) => o.light).length;

  const download = () => {
    const url = URL.createObjectURL(new Blob([xml], { type: "application/xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scene.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mjcf.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 40, opacity: 0 }}
      transition={{ type: "spring", stiffness: 240, damping: 28 }}
      className="absolute top-20 right-5 bottom-24 z-20 flex w-[520px] flex-col overflow-hidden rounded-2xl border border-line bg-ink/90 shadow-2xl backdrop-blur-md"
    >
      <div className="border-b border-line px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Export to MuJoCo</div>
            <div className="mt-0.5 font-mono text-[11px] text-muted">MJCF · z-up · meters, kg, radians</div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(xml);
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:text-fg"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button onClick={download} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-ink">
              Download .xml
            </button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {[
            [scene.objects.length, "bodies"],
            [joints, "joints"],
            [free, "free bodies"],
            [lights, "lights"],
          ].map(([n, label]) => (
            <div key={label as string} className="rounded-lg border border-line bg-panel px-3 py-2">
              <div className="font-mono text-lg leading-none text-fg tabular">{n}</div>
              <div className="mt-1 font-mono text-[9.5px] tracking-wider text-muted uppercase">{label}</div>
            </div>
          ))}
        </div>
      </div>
      <pre className="flex-1 overflow-auto px-5 py-3 font-mono text-[11px] leading-[16px] select-text">
        {xml.split("\n").map((l, i) => (
          <div key={i}>
            <Xml line={l} />
          </div>
        ))}
      </pre>
      <div className="border-t border-line px-5 py-2 font-mono text-[10.5px] text-dim">Press X to close · Isaac (USD) export next</div>
    </motion.div>
  );
}

function Xml({ line }: { line: string }) {
  if (line.trim().startsWith("<!--")) return <span className="text-dim">{line}</span>;
  const parts = line.split(/(<\/?[\w]+|\/?>|[\w:-]+="[^"]*")/g);
  return (
    <>
      {parts.map((p, i) =>
        /^<\/?\w+$/.test(p) || /^\/?>$/.test(p) ? (
          <span key={i} className="text-accent/90">{p}</span>
        ) : /^[\w:-]+="/.test(p) ? (
          <span key={i}>
            <span className="text-[#9db4d0]">{p.slice(0, p.indexOf("="))}</span>
            <span className="text-dim">=</span>
            <span className="text-[#d8c38e]">{p.slice(p.indexOf("=") + 1)}</span>
          </span>
        ) : (
          <span key={i} className="text-muted">{p}</span>
        ),
      )}
    </>
  );
}

export const closeExport = () => useApp.setState({ exportOpen: false });
