import fs from "node:fs";
import path from "node:path";

export function configureProductionStaticRouting(app, {
  projectRoot,
  staticMiddleware,
  fileExists = fs.existsSync
}) {
  const publicDir = path.join(projectRoot, "dist", "public");
  const indexFile = path.join(publicDir, "index.html");
  const frontendAvailable = fileExists(indexFile);

  if (frontendAvailable) {
    app.use(staticMiddleware(publicDir));
    app.get("*", (_req, res) => res.sendFile(indexFile));
  } else {
    app.get("*", (_req, res) => res.status(404).json({
      ok: false,
      error: "This is a realtime backend endpoint. Configure the frontend to use its public Socket.IO origin."
    }));
  }

  return { publicDir, indexFile, frontendAvailable };
}
