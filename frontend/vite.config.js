import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(frontendDirectory, "..");

export default defineConfig({
  plugins: [react()],
  root: frontendDirectory,
  envDir: frontendDirectory,
  publicDir: path.join(frontendDirectory, "public"),
  build: { outDir: path.join(projectRoot, "dist", "public"), emptyOutDir: true },
  server: { host: true, allowedHosts: true, fs: { allow: [projectRoot] } }
});
