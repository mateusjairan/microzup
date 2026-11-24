import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Dev usa o MESMO contrato de produção: o SPA fala com `/auth`, `/messages`…
 * na própria origem e o Vite faz proxy para o backend (8666). Assim não há
 * CORS nem diferença de caminho entre `npm run dev` e o build servido pelo
 * FastAPI — `getServerUrl()` simplesmente não existe mais no cliente.
 */
const BACKEND = "http://127.0.0.1:8666";

const API_PATHS = [
  "/auth",
  "/me",
  "/users",
  "/admin",
  "/sectors",
  "/conversations",
  "/messages",
  "/files",
  "/search",
  "/health",
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/",
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      ...Object.fromEntries(API_PATHS.map((path) => [path, { target: BACKEND, changeOrigin: false }])),
      "/ws": { target: BACKEND.replace(/^http/, "ws"), ws: true },
    },
  },
  preview: { port: 4173, strictPort: true },
});
