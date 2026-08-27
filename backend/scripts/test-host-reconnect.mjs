import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { io } from "socket.io-client";

const port = 4311;
const baseUrl = `http://127.0.0.1:${port}`;
const roomCode = `H${Date.now().toString(36).slice(-7)}`.toUpperCase();
const secondRoomCode = `J${Date.now().toString(36).slice(-7)}`.toUpperCase();
const testDataDirectory = path.join(os.tmpdir(), `word-impostor-host-reconnect-${process.pid}-${Date.now()}`);
fs.rmSync(testDataDirectory, { recursive: true, force: true });
process.env.NODE_ENV = "production";
process.env.PORT = String(port);
process.env.HOST_RECONNECT_GRACE_MS = "300";
process.env.WORD_IMPOSTOR_DATA_DIRECTORY = testDataDirectory;
await import("../server/index.js");
const { closeDatabase } = await import("../server/game/db.js");
const sockets = [];

function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function onceEvent(socket, event, timeout = 3_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, onEvent); reject(new Error(`Timed out waiting for ${event}`)); }, timeout);
    function onEvent(payload) { clearTimeout(timer); resolve(payload); }
    socket.once(event, onEvent);
  });
}
async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {}
    await wait(100);
  }
  throw new Error("The isolated test server did not start.");
}
function connect() {
  const socket = io(baseUrl, { transports: ["websocket"], timeout: 2_000 });
  sockets.push(socket);
  return onceEvent(socket, "connect").then(() => socket);
}
function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => socket.timeout(2_000).emit(event, payload, (error, response) => error ? reject(error) : resolve(response)));
}

let exitCode = 0;
try {
  await waitForServer();
  const host = await connect();
  const created = await emitAck(host, "createRoom", { roomCode, password: "recover-pass" });
  assert.equal(created.ok, true);

  const player = await connect();
  const joined = await emitAck(player, "joinRoom", { roomCode, password: "recover-pass", userId: "Asha" });
  assert.equal(joined.ok, true);
  const teammateOne = await connect();
  const joinedTeammateOne = await emitAck(teammateOne, "joinRoom", { roomCode, password: "recover-pass", userId: "Beni" });
  const teammateTwo = await connect();
  const joinedTeammateTwo = await emitAck(teammateTwo, "joinRoom", { roomCode, password: "recover-pass", userId: "Cara" });
  for (const teammate of [joined, joinedTeammateOne, joinedTeammateTwo]) {
    const socket = teammate.playerId === joined.playerId ? player : teammate.playerId === joinedTeammateOne.playerId ? teammateOne : teammateTwo;
    assert.equal((await emitAck(socket, "setReady", { sessionToken: teammate.sessionToken, isReady: true })).ok, true);
  }
  assert.equal((await emitAck(host, "startRound", { hostToken: created.hostToken })).ok, true);

  const waiting = onceEvent(player, "hostReconnectWaiting");
  host.disconnect();
  const waitingPayload = await waiting;
  assert.ok(waitingPayload.deadline > Date.now(), "Players should receive a host-return deadline");
  const pausedClue = await emitAck(player, "submitHint", { sessionToken: joined.sessionToken, content: "Paused" });
  assert.equal(pausedClue.ok, false);
  assert.match(pausedClue.error, /Waiting for the host/);

  const recoveredHost = await connect();
  const reconnected = onceEvent(player, "hostReconnected");
  const recovered = await emitAck(recoveredHost, "recoverHost", { roomCode, password: "recover-pass" });
  assert.equal(recovered.ok, true);
  await reconnected;
  assert.equal((await emitAck(player, "submitHint", { sessionToken: joined.sessionToken, content: "Recovered" })).ok, true);
  assert.equal((await emitAck(teammateOne, "submitHint", { sessionToken: joinedTeammateOne.sessionToken, content: "Ballot middle" })).ok, true);
  assert.equal((await emitAck(teammateTwo, "submitHint", { sessionToken: joinedTeammateTwo.sessionToken, content: "Ballot close" })).ok, true);
  assert.equal((await emitAck(player, "submitHint", { sessionToken: joined.sessionToken, content: "Ballot second start" })).ok, true);
  assert.equal((await emitAck(teammateOne, "submitHint", { sessionToken: joinedTeammateOne.sessionToken, content: "Ballot second middle" })).ok, true);
  assert.equal((await emitAck(teammateTwo, "submitHint", { sessionToken: joinedTeammateTwo.sessionToken, content: "Ballot second close" })).ok, true);
  const ballotHostWaiting = onceEvent(player, "hostReconnectWaiting");
  recoveredHost.disconnect();
  await ballotHostWaiting;
  const blockedVote = await emitAck(player, "submitVote", { sessionToken: joined.sessionToken, targetPlayerId: joinedTeammateOne.playerId });
  assert.equal(blockedVote.ok, false, "A ballot must freeze while the host recovery window is active");
  assert.match(blockedVote.error, /Waiting for the host/);
  const ballotRecoveryHost = await connect();
  const ballotReconnected = onceEvent(player, "hostReconnected");
  const ballotRecovered = await emitAck(ballotRecoveryHost, "recoverHost", { roomCode, password: "recover-pass" });
  assert.equal(ballotRecovered.ok, true);
  await ballotReconnected;
  assert.equal((await emitAck(player, "submitVote", { sessionToken: joined.sessionToken, targetPlayerId: joinedTeammateOne.playerId })).ok, true, "A voter can submit their private ballot once the host returns");
  assert.equal((await emitAck(ballotRecoveryHost, "endRoom", { hostToken: ballotRecovered.hostToken })).ok, true);

  const expiringHost = await connect();
  const expiring = await emitAck(expiringHost, "createRoom", { roomCode: secondRoomCode, password: "expire-pass" });
  const expiringPlayer = await connect();
  const expiringJoin = await emitAck(expiringPlayer, "joinRoom", { roomCode: secondRoomCode, password: "expire-pass", userId: "Beni" });
  assert.equal(expiringJoin.ok, true);
  const ended = onceEvent(expiringPlayer, "roomEnded", 2_000);
  expiringHost.disconnect();
  const endedPayload = await ended;
  assert.match(endedPayload.message, /host did not return/i);
  const staleRecovery = await emitAck(await connect(), "recoverHost", { roomCode: secondRoomCode, password: "expire-pass" });
  assert.equal(staleRecovery.ok, false, "A room should be deleted after the host grace period expires");

  console.log("HOST_RECONNECT_CHECK wait=ok reconnect=ok pausedHints=ok pausedBallot=ok timeoutPurge=ok");
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  sockets.forEach((socket) => socket.disconnect());
  closeDatabase();
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
  process.exit(exitCode);
}
