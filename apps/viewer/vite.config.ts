import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { serveRuns } from "./serve-runs.ts";
import { apiRuns } from "./api-runs.ts";
import { apiTasks } from "./api-tasks.ts";
import { serveModels } from "./serve-models.ts";

export default defineConfig({
  plugins: [react(), tailwindcss(), serveRuns("../../runs"), apiRuns("../../runs"), apiTasks("../../runs"), serveModels()],
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 2000 },
});
