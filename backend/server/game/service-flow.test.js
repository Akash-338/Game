import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../../..");

describe("authoritative game-service flow", () => {
  it("keeps passive reconnects distinct from voluntary departures", () => {
    const output = execFileSync(process.execPath, ["backend/server/game/service.numeric-check.mjs"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env }
    });
    expect(output).toContain("voluntaryDeparture=ok");
  });
});
