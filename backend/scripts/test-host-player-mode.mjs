import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { io } from "socket.io-client";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function request(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} did not acknowledge within 4 seconds.`)), 4_000);
    socket.emit(event, payload, (response) => {
      clearTimeout(timeout);
      if (!response?.ok) reject(new Error(response?.error || `${event} was rejected.`));
      else resolve(response);
    });
  });
}

function waitForSnapshot(socket, predicate, label) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("roomSnapshot", listener);
      reject(new Error(`Timed out waiting for ${label}.`));
    }, 4_000);
    const listener = (snapshot) => {
      if (!predicate(snapshot)) return;
      clearTimeout(timeout);
      socket.off("roomSnapshot", listener);
      resolve(snapshot);
    };
    socket.on("roomSnapshot", listener);
  });
}

function connect(baseUrl) {
  const socket = io(baseUrl, { transports: ["websocket"], reconnection: false, timeout: 4_000 });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.disconnect(); reject(new Error("Socket connection timed out.")); }, 4_000);
    socket.once("connect", () => { clearTimeout(timeout); resolve(socket); });
    socket.once("connect_error", (error) => { clearTimeout(timeout); socket.disconnect(); reject(error); });
  });
}

async function waitForHealth(baseUrl, server) {
  let lastError;
  let serverOutput = "";
  server.stdout?.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server.stderr?.on("data", (chunk) => { serverOutput += chunk.toString(); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`Temporary Socket.IO server did not become healthy. ${serverOutput.trim() || lastError?.message || "No server output was captured."}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/f"], { stdio: "ignore" });
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2_000)]);
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(2_000)
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2_000)]);
  }
}

export async function runHostPlayerSocketCheck() {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "word-impostor-host-player-"));
  const port = 4600 + Math.floor(Math.random() * 300);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["backend/server/index.js"], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), WORD_IMPOSTOR_DATA_DIRECTORY: dataDirectory },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const sockets = [];
  try {
    await waitForHealth(baseUrl, server);
    const host = await connect(baseUrl); sockets.push(host);
    const roomCode = `HP${Date.now().toString().slice(-7)}`;
    const created = await request(host, "createRoom", { roomCode, password: "table-pass", hostUserId: "Creator" });
    assert.ok(created.hostToken && created.playerId && created.sessionToken, "Creating as a named host returns both host and player credentials.");
    assert.equal(created.snapshot.packs.length > 0, true, "Host mode receives host-only word-pack controls.");

    const playerView = waitForSnapshot(host, (snapshot) => snapshot.room.roomCode === roomCode && snapshot.packs.length === 0 && snapshot.wordChoices.length === 0, "creator player-safe snapshot");
    assert.equal((await request(host, "setHostViewMode", { hostToken: created.hostToken, mode: "player" })).mode, "player");
    const creatorPlayerSnapshot = await playerView;
    assert.equal(creatorPlayerSnapshot.ownRole, null, "Player view does not receive a role before a round starts.");
    assert.equal(creatorPlayerSnapshot.players.some((player) => player.id === created.playerId), true, "Creator remains present as a player.");
    await request(host, "setReady", { sessionToken: created.sessionToken, isReady: true });

    const second = await connect(baseUrl); sockets.push(second);
    const third = await connect(baseUrl); sockets.push(third);
    const secondJoin = await request(second, "joinRoom", { roomCode, password: "table-pass", userId: "Second" });
    const thirdJoin = await request(third, "joinRoom", { roomCode, password: "table-pass", userId: "Third" });
    await request(second, "setReady", { sessionToken: secondJoin.sessionToken, isReady: true });
    await request(third, "setReady", { sessionToken: thirdJoin.sessionToken, isReady: true });

    const hostView = waitForSnapshot(host, (snapshot) => snapshot.packs.length > 0 && snapshot.room.status === "lobby", "restored creator host view");
    await request(host, "setHostViewMode", { hostToken: created.hostToken, mode: "host" });
    await hostView;
    await request(host, "startRound", { hostToken: created.hostToken });

    const activePlayerView = waitForSnapshot(host, (snapshot) => snapshot.room.status === "playing" && snapshot.ownRole && snapshot.currentTurnPlayerId === created.playerId && snapshot.packs.length === 0, "creator playable round snapshot");
    await request(host, "setHostViewMode", { hostToken: created.hostToken, mode: "player" });
    const roundSnapshot = await activePlayerView;
    assert.ok(roundSnapshot.ownRole.role === "civilian" || roundSnapshot.ownRole.role === "impostor", "Creator receives only their own role in player view.");
    assert.deepEqual(roundSnapshot.roles, [], "Creator player view cannot access the complete hidden role list.");
    await request(host, "submitHint", { sessionToken: created.sessionToken, content: "creator-clue" });

    host.disconnect();
    const resumed = await connect(baseUrl); sockets.push(resumed);
    const resumedHost = await request(resumed, "resumeHost", { hostToken: created.hostToken, sessionToken: created.sessionToken });
    assert.equal(resumedHost.playerId, created.playerId, "Host recovery retains the creator's player seat.");
    assert.equal(resumedHost.snapshot.packs.length > 0, true, "Recovered creator defaults to the private host dashboard.");
    const resumedPlayerView = waitForSnapshot(resumed, (snapshot) => snapshot.room.status === "playing" && snapshot.ownRole && snapshot.packs.length === 0, "recovered creator player-safe snapshot");
    await request(resumed, "setHostViewMode", { hostToken: created.hostToken, mode: "player" });
    await resumedPlayerView;
    await request(resumed, "setHostViewMode", { hostToken: created.hostToken, mode: "host" });
    await request(resumed, "endRoom", { hostToken: created.hostToken });
    return "HOST_PLAYER_SOCKET_CHECK create=ok switch=ok playable=ok reconnect=ok privacy=ok";
  } finally {
    sockets.forEach((socket) => socket.disconnect());
    await stopServer(server);
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHostPlayerSocketCheck().then((message) => console.log(message)).catch((error) => { console.error(error); process.exitCode = 1; });
}
