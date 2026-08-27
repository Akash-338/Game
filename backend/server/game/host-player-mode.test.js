import { test, expect } from "vitest";
import { runHostPlayerSocketCheck } from "../../scripts/test-host-player-mode.mjs";

const hostPlayerSocketTest = process.platform === "win32" ? test.skip : test;

hostPlayerSocketTest("a creator can switch between private host and player views through Socket.IO", async () => {
  await expect(runHostPlayerSocketCheck()).resolves.toContain("HOST_PLAYER_SOCKET_CHECK create=ok switch=ok playable=ok reconnect=ok privacy=ok");
}, 20_000);
