// The source-footage <video> element is shared between the DOM overlay and the
// 3D camera rig, which reads currentTime every frame (timeupdate is only ~4 Hz).
export const footage: { el: HTMLVideoElement | null } = { el: null };

export function footageTime(fallback: number) {
  const el = footage.el;
  return el && el.readyState >= 1 ? el.currentTime : fallback;
}
