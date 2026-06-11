import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy /api & /socket.io ke orchestrator (Fastify, default :8787) supaya web
// memakai URL relatif (same-origin) di dev → tidak perlu pusing CORS.
const SERVER = process.env["VC_SERVER_URL"] ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: SERVER, changeOrigin: true },
      "/socket.io": { target: SERVER, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
