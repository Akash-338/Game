import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const gameDirectory = path.dirname(fileURLToPath(import.meta.url));

test("restores a host session with the correct room password and rejects a wrong one", () => {
  const output = execFileSync(process.execPath, ["service.numeric-check.mjs"], {
    cwd: gameDirectory,
    encoding: "utf8",
  });

  expect(output).toContain("hostRecovery=ok");
  expect(output).toContain("roomPurge=ok");
});
