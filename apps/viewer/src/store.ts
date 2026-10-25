import { create } from "zustand";
import type { RunManifest } from "@doorway/schema";

export type Mode = "overview" | "compare" | "convergence" | "walk";
/** Which scene the stage shows: the one-pass v0, the latest iteration of the live run, or the frozen demo backup. */
export type Version = "v0" | "latest" | "backup";
export type RunIndex = { live: string; backup: string };

type State = {
  mode: Mode;
  version: Version;
  index: RunIndex | null;
  manifests: Record<string, RunManifest>;
  /** Overrides which iteration of the current run is shown (compare / convergence scrubbing). */
  iter: number | null;
  /** Articulation targets: 0 = closed/off, 1 = open/on. */
  joints: Record<string, number>;
  /** Accumulated pushes for free objects, world-space [dx, dz]. */
  pushes: Record<string, [number, number]>;
  hovered: string | null;
  /** Bumped on reset so components can snap back. */
  resetNonce: number;
  /** Seconds into the source video; drives the camera in compare mode. */
  videoTime: number;
  night: boolean;
  /** Interaction-test visualization (swing arcs, slide arrows, checks). */
  tests: boolean;
  /** A specific branch scene to preview instead of the selected one (e.g. a rejected branch). */
  preview: { k: number; i: number } | null;
  /** Build-in intro: when it started (performance.now) and how many objects have appeared so far. */
  buildStart: number | null;
  buildCount: number | null;
  muted: boolean;
  exportOpen: boolean;
  /** Overview: v0 and the final room side by side. */
  split: boolean;
  /** Headless render mode (no UI); `shake` adds handheld camera motion for stand-in footage. */
  renderMode: boolean;
  shake: boolean;
  /** Compare mode: wipe position (0..1 of the screen width) and playback. */
  wipe: number;
  comparePlaying: boolean;
  /** Set to a timestamp to (re)start the convergence playback. */
  convergencePlay: number | null;
  /** No input for a while in overview: attract mode. */
  idle: boolean;
  /** Switchable lights in the current scene (set by the stage). */
  lampIds: string[];

  setMode: (m: Mode) => void;
  setVersion: (v: Version) => void;
  setIndex: (i: RunIndex) => void;
  setManifest: (id: string, m: RunManifest) => void;
  setIter: (k: number | null) => void;
  toggleJoint: (id: string, initial?: number) => void;
  push: (id: string, dx: number, dz: number) => void;
  setHovered: (id: string | null) => void;
  setVideoTime: (t: number) => void;
  reset: () => void;
  toggleNight: () => void;
  toggleTests: () => void;
  setPreview: (p: { k: number; i: number } | null) => void;
  replayBuild: () => void;
  setBuildCount: (n: number | null) => void;
  toggleMuted: () => void;
};

export const useApp = create<State>((set) => ({
  mode: "overview",
  version: "latest",
  index: null,
  manifests: {},
  iter: null,
  joints: {},
  pushes: {},
  hovered: null,
  resetNonce: 0,
  videoTime: 0,
  night: false,
  tests: false,
  preview: null,
  buildStart: null,
  buildCount: null,
  muted: false,
  exportOpen: false,
  split: false,
  renderMode: false,
  shake: false,
  wipe: 0.5,
  comparePlaying: true,
  convergencePlay: null,
  idle: false,
  lampIds: [],

  setMode: (mode) => set({ mode, hovered: null, split: false }),
  setVersion: (version) => set({ version, iter: null, preview: null }),
  setIndex: (index) => set({ index }),
  setManifest: (id, m) => set((s) => ({ manifests: { ...s.manifests, [id]: m } })),
  setIter: (iter) => set({ iter, preview: null }),
  toggleJoint: (id, initial = 0) => set((s) => ({ joints: { ...s.joints, [id]: (s.joints[id] ?? initial) ? 0 : 1 } })),
  push: (id, dx, dz) =>
    set((s) => {
      const [x, z] = s.pushes[id] ?? [0, 0];
      return { pushes: { ...s.pushes, [id]: [x + dx, z + dz] } };
    }),
  setHovered: (hovered) => set({ hovered }),
  setVideoTime: (videoTime) => set({ videoTime }),
  reset: () => set((s) => ({ joints: {}, pushes: {}, resetNonce: s.resetNonce + 1 })),
  // Going dark also switches lamps on, so night mode lands with a moment.
  toggleNight: () => set((s) => ({ night: !s.night, joints: !s.night ? { ...s.joints, ...Object.fromEntries(s.lampIds.map((id) => [id, 1])) } : s.joints })),
  toggleTests: () => set((s) => ({ tests: !s.tests })),
  setPreview: (preview) => set({ preview }),
  replayBuild: () => set({ buildStart: performance.now(), buildCount: 0, joints: {}, pushes: {} }),
  setBuildCount: (buildCount) => set(buildCount === null ? { buildCount, buildStart: null } : { buildCount }),
  toggleMuted: () => set((s) => ({ muted: !s.muted })),
}));

export const runIdFor = (version: Version, index: RunIndex | null) =>
  index ? (version === "backup" ? index.backup : index.live) : null;

/** Iteration index shown for a version, honoring the scrub override. */
export function iterFor(version: Version, manifest: RunManifest | undefined, override: number | null) {
  if (!manifest || manifest.iterations.length === 0) return null;
  if (override !== null) return Math.min(override, manifest.iterations.length - 1);
  return version === "v0" ? 0 : manifest.iterations.length - 1;
}
