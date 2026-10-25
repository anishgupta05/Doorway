// Start a new room: pick or drop a video. Capture is the front door of the product; processing is wired up by the loop.
import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "../store";

const close = () => useApp.setState({ uploadOpen: false });

export function UploadPanel() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const pick = (f: File | undefined) => {
    if (!f || !f.type.startsWith("video/")) return;
    if (url) URL.revokeObjectURL(url);
    setFile(f);
    setUrl(URL.createObjectURL(f));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 grid place-items-center bg-ink/70 backdrop-blur-sm"
      onClick={close}
    >
      <motion.div
        initial={{ y: 24, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 24, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] max-w-[92vw] rounded-2xl border border-line bg-panel p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-lg font-semibold tracking-tight">Scan a new room</div>
            <div className="mt-1 text-[13px] text-muted">Walk slowly around the room for about a minute and film it. We turn it into a 3D room you can explore.</div>
          </div>
          <button onClick={close} className="text-muted hover:text-fg" aria-label="Close">
            ✕
          </button>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            pick(e.dataTransfer.files[0]);
          }}
          onClick={() => input.current?.click()}
          className={`mt-5 grid cursor-pointer place-items-center overflow-hidden rounded-xl border border-dashed transition ${over ? "border-accent bg-accent/10" : "border-line bg-panel-2"} ${url ? "" : "h-44"}`}
        >
          {url ? (
            <video src={url} className="max-h-64 w-full bg-black object-contain" controls muted onClick={(e) => e.stopPropagation()} />
          ) : (
            <div className="text-center">
              <div className="text-[15px] font-medium">Drop a video here</div>
              <div className="mt-1 text-[12px] text-muted">or click to choose one from your device</div>
            </div>
          )}
        </div>
        <input ref={input} type="file" accept="video/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />

        <div className="mt-5 flex items-center justify-between">
          <div className="min-w-0 truncate text-[12px] text-muted">{file ? `${file.name} · ${(file.size / 1e6).toFixed(1)} MB` : "MP4 or MOV, about 60 seconds"}</div>
          <button
            disabled={!file}
            onClick={close}
            className="rounded-full bg-accent px-5 py-2 text-[13px] font-semibold text-ink transition enabled:hover:brightness-110 disabled:opacity-40"
          >
            Build my room
          </button>
        </div>
        <div className="mt-3 text-[11px] text-dim">Preview only: uploads aren't connected to the builder yet.</div>
      </motion.div>
    </motion.div>
  );
}
