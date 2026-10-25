// When you step to a new iteration, say what it fixed and how much closer it got.
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Issue } from "@doorway/schema";

export function FixToast({ k, fixed, score, prevScore }: { k: number | null; fixed: Issue[]; score?: number; prevScore?: number }) {
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (k === null || k === 0) return setShown(null);
    setShown(k);
    const t = setTimeout(() => setShown(null), 3800);
    return () => clearTimeout(t);
  }, [k]);
  const ids = [...new Set(fixed.map((f) => f.objectId))];
  return (
    <div className="pointer-events-none absolute top-[150px] left-1/2 z-30 -translate-x-1/2">
      <AnimatePresence>
        {shown !== null && shown === k && (
          <motion.div
            key={k}
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            className="flex items-center gap-3 rounded-full border border-accent/50 bg-ink/90 py-2 pr-4 pl-2 shadow-[0_8px_40px_-8px_rgba(198,243,107,0.35)] backdrop-blur"
          >
            <span className="rounded-full bg-accent px-2.5 py-0.5 font-mono text-[11px] font-bold text-ink">iteration {k}</span>
            <span className="text-[13px]">
              fixed <span className="font-mono text-accent">{ids.length ? ids.join(", ") : "small details"}</span>
            </span>
            {score !== undefined && prevScore !== undefined && (
              <span className="font-mono text-[12px] text-muted tabular">
                {prevScore.toFixed(2)} → <span className="text-accent">{score.toFixed(2)}</span>
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
