// Chrome-less render mode for headless capture (Person 3's renderer, thumbnails,
// and the mock run's stand-in footage). Same renderer judges see, nothing else.
//
//   /?render=1&scene=/runs/mock/iter_0/branch_0/scene.json   camera on the video path
//     &view=overview        dollhouse view instead
//     &t=12                 start at this many seconds into the camera path
//     &play=1               advance time in real time (for recording)
//     &phone=1              handheld shake + grain, to stand in for real footage
//     &record=1             record the canvas along the whole path (MediaRecorder → webm);
//                           await window.doorway.recording for a base64 data URL
//
// Driving it from Playwright:
//   await page.waitForFunction(() => window.doorway?.ready)
//   await page.evaluate((t) => window.doorway.setTime(t), 4.0)   // then screenshot
import { useEffect, useState } from "react";
import { Scene } from "@doorway/schema";
import { Stage } from "./Stage";
import { useApp } from "./store";
import { pathDuration } from "./scene/cameraPath";
import { modelsIdle } from "./scene/models";

declare global {
  interface Window {
    doorway?: {
      ready: boolean;
      duration: number;
      setTime: (t: number) => void;
      open: (id: string, v?: number) => void;
      recording?: Promise<string>;
    };
  }
}

export function RenderApp() {
  const params = new URLSearchParams(location.search);
  const [scene, setScene] = useState<Scene | null>(null);
  const phone = params.get("phone") === "1";

  useEffect(() => {
    useApp.setState({ mode: params.get("view") === "overview" ? "overview" : "compare", renderMode: true, shake: phone });
    fetch(params.get("scene") ?? "/runs/mock/iter_0/branch_0/scene.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setScene(Scene.parse(j)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!scene) return;
    const duration = pathDuration(scene.camera_path);
    useApp.getState().setVideoTime(Number(params.get("t") ?? 0));
    window.doorway = {
      ready: false,
      duration,
      setTime: (t) => useApp.getState().setVideoTime(t),
      open: (id, v = 1) => useApp.setState((s) => ({ joints: { ...s.joints, [id]: v } })),
    };
    // Give shaders, shadows and AO a moment to settle before declaring ready.
    const t = setTimeout(() => void modelsIdle().then(() => window.doorway && (window.doorway.ready = true)), 2500);
    let raf = 0;
    if (params.get("record") === "1") {
      window.doorway.recording = new Promise<string>((resolve) => {
        setTimeout(() => {
          const canvas = document.querySelector("canvas")!;
          const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 8_000_000 });
          const chunks: Blob[] = [];
          rec.ondataavailable = (e) => chunks.push(e.data);
          rec.onstop = () => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(new Blob(chunks, { type: "video/webm" }));
          };
          const start = performance.now();
          const tick = (now: number) => {
            const t = (now - start) / 1000;
            useApp.getState().setVideoTime(Math.min(duration, t));
            if (t >= duration + 0.2) rec.stop();
            else raf = requestAnimationFrame(tick);
          };
          rec.start(250);
          raf = requestAnimationFrame(tick);
        }, 2500);
      });
    } else if (params.get("play") === "1") {
      const start = performance.now() + 2500;
      const tick = (now: number) => {
        useApp.getState().setVideoTime(Math.max(0, Math.min(duration, (now - start) / 1000)));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  return (
    <div className="relative h-full w-full">
      <Stage scene={scene} prevScene={null} />
      {phone && <div className="pointer-events-none absolute inset-0 opacity-[0.07] mix-blend-overlay [background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%22160%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22/></filter><rect width=%22160%22 height=%22160%22 filter=%22url(%23n)%22/></svg>')]" />}
    </div>
  );
}
