import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: path.join(rootDir, "frontend"),
  publicDir: path.join(rootDir, "frontend", "public"),
  build: { outDir: path.join(rootDir, "dist", "public"), emptyOutDir: true },
  server: { host: true, allowedHosts: true }
});
