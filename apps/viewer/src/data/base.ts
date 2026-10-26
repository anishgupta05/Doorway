// Where the room server lives. Same origin by default; a static copy of the site (Vercel) can be pointed at a
// running server with ?api=https://<name>.trycloudflare.com. Remembered for the tab, restricted to tunnels.
const TUNNEL = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

function pick(): string {
  try {
    const q = new URLSearchParams(location.search).get("api")?.replace(/\/+$/, "");
    if (q && TUNNEL.test(q)) {
      sessionStorage.setItem("doorway-api", q);
      return q;
    }
    const saved = sessionStorage.getItem("doorway-api");
    if (saved && TUNNEL.test(saved)) return saved;
  } catch {
    /* storage can be blocked */
  }
  return "";
}

export const BASE = pick();

/** A link that opens the same room (and the same server) for someone else. */
export const shareUrl = (runId: string) => `${location.origin}/?run=${runId}${BASE ? `&api=${encodeURIComponent(BASE)}` : ""}`;
