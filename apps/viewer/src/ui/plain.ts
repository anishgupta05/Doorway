// Plain-language helpers: turn loop jargon (object ids, guard prefixes, 0..1 scores) into words a visitor reads naturally.
const ID = /\b([a-z]+)_\d+\b/g;

/** "Hook: deleted chair_2" -> "deleted chair". Model/guard text is still rendered as plain text. */
export const plain = (t: string | null | undefined) =>
  (t ?? "")
    .replace(/^(Hook|Interaction test):\s*/i, "")
    .replace(ID, (_, w: string) => (w === "other" ? "another object" : w))
    .replace(/\s*\(range[^)]*\)?/i, "")
    .replace(/^./, (c) => c.toLowerCase());

const COLORS: [string, number, number, number][] = [
  ["white", 240, 240, 240], ["light grey", 190, 190, 190], ["warm grey", 140, 143, 134], ["dark grey", 70, 70, 70], ["black", 20, 20, 20],
  ["red", 200, 60, 60], ["orange", 230, 140, 60], ["tan", 200, 170, 130], ["brown", 130, 90, 60], ["yellow", 230, 210, 90],
  ["green", 90, 160, 90], ["blue", 70, 110, 190], ["purple", 130, 90, 170],
];
/** "#8c8f86" -> "warm grey": nearest of a few everyday colour names. */
const colorName = (hex: string) => {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  let best = Infinity, name = "";
  for (const [label, cr, cg, cb] of COLORS) {
    const d = (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2;
    if (d < best) [best, name] = [d, label];
  }
  return name;
};
/** Uppercase the first letter only: model labels like "grey upholstered armchair" read as names. */
export const cap = (t: string) => t.replace(/^./, (c) => c.toUpperCase());

/** One fix idea in everyday words. Extra ";"-separated changes collapse to "+ N more". */
export const hypothesis = (t: string | null | undefined) => {
  if (/^one-pass/i.test(t ?? "")) return "Doorway's first attempt, straight from your video";
  if (/^no branch beat/i.test(t ?? "")) return "Nothing beat the current room, so it stayed as it was";
  const parts = (t ?? "").split(/;\s*/).filter(Boolean);
  const main = plain(parts[0])
    .replace(/#[0-9a-f]{6}\b/gi, (h) => colorName(h))
    .replace(/\bretint\b/i, "recolor")
    .replace(/\bjamb\b/i, "side")
    .replace(/\bhinge\b/i, "hinges")
    .replace(/\bre-fit\b/i, "resize")
    .replace(/\s*\u2026$/, "");
  const more = parts.length - 1;
  return cap(main) + (more > 0 ? ` (+${more} more ${more === 1 ? "change" : "changes"})` : "");
};

/** An issue message for the Compare list: no ids, no "fix its hinge…" instructions meant for the model. */
export const issueText = (msg: string, nameOf: (id: string) => string | undefined) =>
  cap(
    (msg ?? "")
      .replace(/^Interaction test fails:\s*/i, "")
      .replace(/\s*Fix its [^.]*\.?\s*$/i, "")
      .replace(/\b([a-z]+_\d+)\b/g, (id) => (nameOf(id) ?? id.replace(/_\d+$/, "")).toLowerCase())
      .trim(),
  );

/** Why a guard threw an idea out, as a consequence a visitor understands. */
export const reason = (t: string | null | undefined) => {
  const r = plain(t);
  const m =
    r.match(/^(\w+) no longer opens/) && `The ${r.match(/^(\w+)/)![1]} would stop opening`;
  if (m) return m;
  const del = r.match(/^deleted (\w+)/);
  if (del) return `It would have removed the ${del[1]}`;
  const hit = r.match(/^(\w+) intersects (\w+)/);
  if (hit) return `The ${hit[1]} would clip into the ${hit[2]}`;
  return cap(r);
};

export const pct = (s: number) => `${Math.round(s * 100)}%`;
const ord = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;
/** k=0 is the model's first attempt; each later iteration is another render. */
export const roundName = (k: number) => `${ord(k + 1)} render`;
