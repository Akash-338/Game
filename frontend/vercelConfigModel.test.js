import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const directory = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
const vercelConfig = JSON.parse(fs.readFileSync(path.join(directory, "vercel.json"), "utf8"));

describe("Vercel frontend boundary", () => {
  test("declares the browser dependencies needed when frontend is the Vercel root directory", () => {
    expect(manifest.dependencies).toMatchObject({
      react: "^19.2.1",
      "react-dom": "^19.2.1",
      "socket.io-client": "^4.8.3"
    });
    expect(manifest.devDependencies.vite).toBe("^7.1.7");
  });

  test("uses Vite with a single-page-app fallback", () => {
    expect(vercelConfig.framework).toBe("vite");
    expect(vercelConfig.rewrites).toContainEqual({ source: "/(.*)", destination: "/index.html" });
  });
});
