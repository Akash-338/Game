import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const required = [
  "frontend/package.json",
  "frontend/vite.config.js",
  "frontend/vercel.json",
  "frontend/deployment-config.md",
  "backend/package.json",
  "backend/deployment-config.md",
  "docs/scalable-deployment-setup.md"
];

required.forEach((relativePath) => assert.ok(fs.existsSync(path.join(root, relativePath)), `${relativePath} must exist for provider-ready deployment.`));
const frontendConfig = fs.readFileSync(path.join(root, "frontend/vite.config.js"), "utf8");
const frontendPackage = JSON.parse(fs.readFileSync(path.join(root, "frontend/package.json"), "utf8"));
const vercelConfig = fs.readFileSync(path.join(root, "frontend/vercel.json"), "utf8");
const socketClient = fs.readFileSync(path.join(root, "frontend/src/lib/gameSocket.js"), "utf8");
const backendServer = fs.readFileSync(path.join(root, "backend/server/index.js"), "utf8");
assert.match(frontendConfig, /root: frontendDirectory/, "Frontend must own the active client source.");
assert.deepEqual(Object.keys(frontendPackage.dependencies).sort(), ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities", "framer-motion", "lucide-react", "react", "react-dom", "socket.io-client"].sort());
assert.match(vercelConfig, /"framework": "vite"/, "Frontend must explicitly target Vite on Vercel.");
assert.match(vercelConfig, /"destination": "\/index.html"/, "Frontend must preserve the SPA fallback on Vercel.");
assert.match(socketClient, /VITE_REALTIME_URL/, "Client must accept an external realtime endpoint.");
assert.match(backendServer, /CORS_ORIGIN/, "Backend must accept explicit deployed frontend origins.");
console.log("DEPLOYMENT_BOUNDARY_CHECK frontend=ok backend=ok configurableRealtime=ok docs=ok");
