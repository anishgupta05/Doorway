// Client for the local run API (apps/viewer/api-runs.ts) and the job files it writes.
import { useApp } from "../store";

export type Room = { id: string; name: string; status: string; when: number };
export type Job = { stage: "watching" | "drawing" | "checking" | "done" | "error"; message?: string; step?: number; startedAt?: number };
export type LoopProgress = { stage: string; k: number; detail: string };

const j = async (url: string) => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
};

export const listRooms = (): Promise<Room[]> => j("/api/runs");
export const getJob = (id: string): Promise<Job> => j(`/runs/${id}/job.json`);
export const getProgress = (id: string): Promise<LoopProgress | null> => j(`/runs/${id}/progress.json`).catch(() => null);

/** Uploads the raw video file; reports 0..1 as it goes. */
export function uploadVideo(file: File, name: string, onProgress: (p: number) => void): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/runs");
    x.setRequestHeader("x-filename", file.name);
    x.setRequestHeader("x-name", encodeURIComponent(name));
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      let body: { id?: string; error?: string } = {};
      try {
        body = JSON.parse(x.responseText);
      } catch {}
      x.status === 200 && body.id ? resolve({ id: body.id }) : reject(new Error(body.error ?? "Upload failed."));
    };
    x.onerror = () => reject(new Error("Couldn't reach the room builder. Is the viewer running?"));
    x.send(file);
  });
}

export async function renameRoom(id: string, name: string) {
  const r = await fetch(`/api/runs/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
  if (!r.ok) throw new Error("rename failed");
  useApp.setState((s) => ({ names: { ...s.names, [id]: name } }));
}

/** Switch the stage to another room. */
export function openRoom(id: string) {
  const s = useApp.getState();
  useApp.setState({
    index: { live: id, backup: s.index?.backup ?? id },
    version: "latest",
    iter: null,
    preview: null,
    mode: "overview",
    building: null,
    roomsOpen: false,
    uploadOpen: false,
    loadError: false,
    joints: {},
    pushes: {},
  });
  try {
    history.replaceState(null, "", `?run=${id}`);
  } catch {}
}
