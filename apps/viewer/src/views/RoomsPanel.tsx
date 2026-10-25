// Every room on this computer: open one, rename it, or copy a link to it.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { listRooms, openRoom, renameRoom, type Room } from "../data/api";
import { useApp } from "../store";

const close = () => useApp.setState({ roomsOpen: false });
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const STATUS: Record<string, string> = { watching: "Watching the video", drawing: "Drawing the room", checking: "Checking it", running: "Still improving", error: "Didn't finish" };

export function RoomsPanel() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const names = useApp((s) => s.names);
  const live = useApp((s) => s.index?.live);

  const load = () => listRooms().then(setRooms).catch(() => setRooms([]));
  useEffect(() => void load(), []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-40 grid place-items-center bg-ink/70 backdrop-blur-sm" onClick={close}>
      <motion.div
        initial={{ y: 24, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 24, scale: 0.98 }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-[520px] max-w-[92vw] flex-col rounded-2xl border border-line bg-panel p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold tracking-tight">Your rooms</div>
          <button onClick={close} className="text-muted hover:text-fg" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="mt-4 flex-1 overflow-y-auto">
          {rooms === null && <div className="py-6 text-center text-[13px] text-muted">Loading…</div>}
          {rooms?.length === 0 && <div className="py-6 text-center text-[13px] text-muted">No rooms yet. Scan one with “New video”.</div>}
          {rooms?.map((r) => {
            const name = names[r.id] ?? r.name;
            const busy = STATUS[r.status];
            return (
              <div key={r.id} className={`group flex items-center gap-3 rounded-xl border px-3 py-2.5 ${r.id === live ? "border-accent/50 bg-panel-2" : "border-transparent hover:bg-panel-2"}`}>
                <div className="min-w-0 flex-1">
                  {editing === r.id ? (
                    <input
                      autoFocus
                      defaultValue={name}
                      onBlur={(e) => {
                        const n = e.target.value.trim();
                        setEditing(null);
                        if (n && n !== name) void renameRoom(r.id, n).then(load);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      className="w-full rounded border border-accent/60 bg-panel px-2 py-0.5 text-[14px] outline-none"
                    />
                  ) : (
                    <div className="truncate text-[14px] font-medium">{name}</div>
                  )}
                  <div className="text-[11.5px] text-muted">
                    {busy ?? "Ready"}{r.when ? ` · ${ago(r.when)}` : ""}
                  </div>
                </div>
                <button onClick={() => setEditing(r.id)} className="text-[12px] text-muted opacity-0 transition group-hover:opacity-100 hover:text-fg">
                  Rename
                </button>
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(`${location.origin}/?run=${r.id}`);
                    setCopied(r.id);
                    setTimeout(() => setCopied(null), 1400);
                  }}
                  className="text-[12px] text-muted opacity-0 transition group-hover:opacity-100 hover:text-fg"
                >
                  {copied === r.id ? "Copied" : "Copy link"}
                </button>
                <button
                  disabled={r.status === "error" || (!!busy && r.status !== "running")}
                  onClick={() => openRoom(r.id)}
                  className="rounded-full bg-fg px-3.5 py-1 text-[12px] font-semibold text-ink disabled:opacity-30"
                >
                  Open
                </button>
              </div>
            );
          })}
        </div>
        <button onClick={() => useApp.setState({ roomsOpen: false, uploadOpen: true })} className="mt-4 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-ink hover:brightness-110">
          + Scan a new room
        </button>
      </motion.div>
    </motion.div>
  );
}
