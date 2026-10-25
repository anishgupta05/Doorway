// Shown when there is nothing to load yet (no run on disk, or the files are missing).
import { useEffect, useState } from "react";
import { listRooms, openRoom, type Room } from "../data/api";
import { useApp } from "../store";
import { DoorMark } from "./TopBar";

export function EmptyState() {
  const [rooms, setRooms] = useState<Room[]>([]);
  useEffect(() => void listRooms().then(setRooms).catch(() => {}), []);
  const apiOk = useApp((s) => s.apiOk);
  const ready = rooms.filter((r) => r.status === "done" || r.status === "running");
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-ink">
      <div className="max-w-md text-center">
        <DoorMark className="mx-auto h-14 w-14 text-fg" />
        <div className="mt-6 text-[34px] leading-[1.1] font-semibold tracking-[-0.02em]">Film a room.<br />Walk through it.</div>
        <div className="mt-3 text-[15px] text-muted">Doorway turns a short video of a real room into a 3D room where the doors open, the lights switch and the furniture moves.</div>
        {apiOk ? <button onClick={() => useApp.setState({ uploadOpen: true })} className="mt-7 rounded-full bg-accent px-7 py-3 text-[15px] font-semibold text-ink shadow-[0_0_40px_-8px_rgba(198,243,107,0.6)] hover:brightness-110">
          + Scan a new room
        </button> : <div className="mt-7 text-[13px] text-muted">This room isn't available. Check the link.</div>}
        {ready.length > 0 && (
          <div className="mt-8 text-[13px] text-muted">
            or open one you already have:
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {ready.slice(0, 4).map((r) => (
                <button key={r.id} onClick={() => openRoom(r.id)} className="rounded-full border border-line px-3.5 py-1 text-[13px] text-fg hover:border-accent/60">
                  {r.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
