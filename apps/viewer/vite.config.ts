import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { serveRuns } from "./serve-runs.ts";

export default defineConfig({
  plugins: [react(), tailwindcss(), serveRuns(fileURLToPath(new URL("../../runs", import.meta.url)))],
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 2000 },
});
