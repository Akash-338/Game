import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(sourceDirectory, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(frontendDirectory, "package.json"), "utf8"));
const vercelConfig = JSON.parse(fs.readFileSync(path.join(frontendDirectory, "vercel.json"), "utf8"));

describe("Vercel frontend boundary", () => {
  test("declares the browser dependencies needed when frontend is the Vercel root directory", () => {
    expect(manifest.dependencies).toMatchObject({
      react: "^19.2.1",
      "react-dom": "^19.2.1",
      "socket.io-client": "^4.8.3"
    });
    expect(manifest.devDependencies.vite).toBe("^7.1.7");
    expect(manifest.scripts.build).toBe("vite build --config vite.vercel.config.js");
    expect(manifest.scripts["build:vercel"]).toBe("vite build --config vite.vercel.config.js");
  });

  test("uses Vite with a single-page-app fallback", () => {
    expect(vercelConfig.framework).toBe("vite");
    expect(vercelConfig.rewrites).toContainEqual({ source: "/(.*)", destination: "/index.html" });
  });

  test("keeps Vercel output inside the isolated frontend deployment root", () => {
    const vercelBuildConfig = fs.readFileSync(path.join(frontendDirectory, "vite.vercel.config.js"), "utf8");
    expect(vercelBuildConfig).toContain('path.join(frontendDirectory, "dist")');
    expect(vercelBuildConfig).not.toContain('"..", "dist", "public"');
  });
});
