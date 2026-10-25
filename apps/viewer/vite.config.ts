import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { serveRuns } from "./serve-runs.ts";
import { apiRuns } from "./api-runs.ts";
import { serveModels } from "./serve-models.ts";

export default defineConfig({
  plugins: [react(), tailwindcss(), serveRuns("../../runs"), apiRuns("../../runs"), serveModels()],
  server: { port: 5173 },
  // `vite preview` is the production server on Railway; accept whatever hostname it is given.
  preview: { host: true, allowedHosts: true },
  build: { chunkSizeWarningLimit: 2000 },
});
