import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const distDirectory = path.join(projectRoot, "dist");
const entryPath = path.join(distDirectory, "index.js");

fs.mkdirSync(distDirectory, { recursive: true });
fs.writeFileSync(entryPath, 'import "../backend/server/index.js";\n', "utf8");
console.log("Created dist/index.js for the production server.");
