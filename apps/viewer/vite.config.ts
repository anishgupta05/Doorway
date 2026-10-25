import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { serveRuns } from "./serve-runs.ts";
import { apiRuns } from "./api-runs.ts";

export default defineConfig({
  plugins: [react(), tailwindcss(), serveRuns("../../runs"), apiRuns("../../runs")],
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 2000 },
});
