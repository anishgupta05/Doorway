import { useEffect } from "react";
import { useApp, type Mode } from "./store";
import { setMuted, sfx } from "./sfx";

export const KEYS: { key: string; label: string }[] = [
  { key: "1", label: "Compare" },
  { key: "2", label: "How it improved" },
  { key: "3", label: "Saved room" },
  { key: "4", label: "Explore" },
  { key: "F", label: "Before / after" },
  { key: "B", label: "How it's built" },
  { key: "T", label: "Try everything" },
  { key: "N", label: "Night" },
  { key: "X", label: "Export for robots" },
  { key: "U", label: "New video" },
  { key: "R", label: "Reset" },
];

/** Global demo hotkeys. One key per demo beat, so the presenter never hunts with the mouse. */
export function useHotkeys(opts: { stepIter: (d: number) => void; togglePlay: () => void }) {
  useEffect(() => {
    const go = (mode: Mode) => {
      const s = useApp.getState();
      if (s.mode !== mode) sfx.whoosh();
      s.setMode(mode);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const s = useApp.getState();
      const walking = s.mode === "walk" && !!document.pointerLockElement;
      switch (e.code) {
        case "Digit1":
          s.setVersion("v0");
          useApp.setState({ tests: false, exportOpen: false });
          go("compare");
          break;
        case "Digit2":
          s.setVersion("latest");
          useApp.setState({ tests: false, exportOpen: false, convergencePlay: Date.now() });
          go("convergence");
          break;
        case "Digit3":
          s.setVersion("backup");
          useApp.setState({ tests: false });
          go("overview");
          break;
        case "Digit4":
          useApp.setState({ tests: false, exportOpen: false });
          go("walk");
          break;
        case "Digit0":
        case "Escape":
          if (s.exportOpen) useApp.setState({ exportOpen: false });
          else if (!walking) {
            s.setPreview(null);
            useApp.setState({ tests: false });
            go("overview");
          }
          break;
        case "KeyR":
          s.reset();
          sfx.thunk();
          break;
        case "KeyN":
          s.toggleNight();
          sfx.click();
          break;
        case "KeyT":
          if (s.mode !== "overview") go("overview");
          s.toggleTests();
          break;
        case "KeyB":
          if (s.mode !== "overview") go("overview");
          useApp.setState({ tests: false });
          s.replayBuild();
          break;
        case "KeyF":
          if (s.mode !== "overview") go("overview");
          useApp.setState({ split: !s.split, tests: false });
          sfx.whoosh();
          break;
        case "KeyU":
          useApp.setState({ uploadOpen: !s.uploadOpen });
          sfx.tick();
          break;
        case "KeyX":
          useApp.setState({ exportOpen: !s.exportOpen });
          sfx.tick();
          break;
        case "KeyM":
          s.toggleMuted();
          setMuted(!s.muted);
          break;
        case "KeyV": {
          const order = ["v0", "latest", "backup"] as const;
          s.setVersion(order[(order.indexOf(s.version) + 1) % order.length]);
          sfx.tick();
          break;
        }
        case "ArrowLeft":
          if (!walking) opts.stepIter(-1);
          break;
        case "ArrowRight":
          if (!walking) opts.stepIter(1);
          break;
        case "Space":
          if (!walking) {
            e.preventDefault();
            opts.togglePlay();
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opts]);
}
