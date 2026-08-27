import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const directory = path.dirname(fileURLToPath(import.meta.url));

test("runs private messaging, skip voting, scoring, abstention, and reconnect flow without mass elimination", () => {
  const output = execFileSync(process.execPath, ["voting-flow-check.mjs"], { cwd: directory, encoding: "utf8" });
  expect(output).toContain("VOTING_FLOW_CHECK automaticVote=ok runoff=ok cappedElimination=ok scoreReasons=ok privateMessaging=ok skipVote=ok ghostSafety=ok draw=ok abstention=ok reconnectBallot=ok");
});
