import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  // `npm run dev:web` gives hot reload on :5173 while `wrangler dev` serves the API on :8787.
  server: { proxy: { "/api": "http://localhost:8787" } },
});
