import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";
import { createSupabaseGameRepository } from "../server/cloud/supabaseGameRepository.js";
import { getWordImpostorRuntimeSecrets } from "../server/runtimeConfig.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function request(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} did not acknowledge within 20 seconds.`)), 20_000);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      if (!response?.ok) reject(new Error(response?.error || `${event} was rejected.`));
      else resolve(response);
    });
  });
}

function connect(baseUrl) {
  const socket = io(baseUrl, { transports: ["websocket"], reconnection: false, timeout: 20_000 });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.disconnect(); reject(new Error("Cloud Socket.IO connection timed out.")); }, 20_000);
    socket.once("connect", () => { clearTimeout(timer); resolve(socket); });
    socket.once("connect_error", (error) => { clearTimeout(timer); socket.disconnect(); reject(error); });
  });
}

function waitForEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const onEvent = (payload) => { clearTimeout(timer); resolve(payload); };
    const timer = setTimeout(() => { socket.off(event, onEvent); reject(new Error(`${event} was not received within 20 seconds.`)); }, 20_000);
    socket.once(event, onEvent);
  });
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(message);
}

async function waitForHealth(baseUrl, server, { expectRedisAdapter = false } = {}) {
  let output = "";
  server.stdout?.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr?.on("data", (chunk) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        const health = await response.json();
        assert.equal(health.runtime.cloudModeEnabled, true, "The isolated server must start in explicit cloud mode.");
        if (expectRedisAdapter) assert.equal(health.runtime.redisAdapterEnabled, true, "The public staging server must attach its explicitly configured Redis Socket.IO adapter.");
        return;
      }
    } catch {}
    await delay(100);
  }
  throw new Error(`Cloud Socket.IO server did not become healthy. ${output.trim() || "No server output was captured."}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/f"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

const runtimeSecrets = getWordImpostorRuntimeSecrets();
const repository = createSupabaseGameRepository({ url: runtimeSecrets.supabaseUrl, secretKey: runtimeSecrets.supabaseSecretKey });
const deployedBaseUrl = typeof process.env.WORD_IMPOSTOR_TEST_BASE_URL === "string" && process.env.WORD_IMPOSTOR_TEST_BASE_URL.trim()
  ? process.env.WORD_IMPOSTOR_TEST_BASE_URL.trim().replace(/\/$/, "")
  : null;
const port = 4700 + Math.floor(Math.random() * 200);
const baseUrl = deployedBaseUrl || `http://127.0.0.1:${port}`;
const roomCode = `CE${Date.now().toString().slice(-8)}`;
const password = "entry-check";
const server = deployedBaseUrl ? null : spawn(process.execPath, ["backend/server/index.js"], {
  cwd: projectRoot,
  env: { ...process.env, NODE_ENV: "production", PORT: String(port), WORD_IMPOSTOR_CLOUD_MODE: "true", WORD_IMPOSTOR_REDIS_ADAPTER_ENABLED: "false" },
  stdio: ["ignore", "pipe", "pipe"]
});
const sockets = [];
let roomId = null;
let stage = "startup";
let lifecycleError = null;
function setStage(nextStage) { stage = nextStage; console.log(`CLOUD_ENTRY_SOCKET_CHECK stage=${stage} secrets=redacted`); }

try {
  setStage("health");
  await waitForHealth(baseUrl, server || { stdout: null, stderr: null }, { expectRedisAdapter: Boolean(deployedBaseUrl) });
  setStage("room-create");
  const host = await connect(baseUrl); sockets.push(host);
  const created = await request(host, "createRoom", { roomCode, password, hostUserId: "Creator" });
  roomId = (await repository.findRoomByCode(roomCode))?.id || null;
  assert.ok(roomId, "Cloud-created room must be persisted in Supabase.");
  assert.ok(created.snapshot.packs.length > 0, "A host snapshot must expose pack controls.");
  const randomized = await request(host, "randomizeWord", { hostToken: created.hostToken });
  assert.ok(randomized.word?.id, "Cloud random selection must return a host-visible available word.");
  assert.equal((await repository.getAudienceSnapshot({ roomId, hostToken: created.hostToken })).room.selectedWordEntryId, randomized.word.id, "Cloud random selection must persist through the locked lobby-settings transaction.");
  setStage("pack-controls");
  const customPackId = `socket-pack-${roomCode.toLowerCase()}`;
  const customPack = { packId: customPackId, name: "Socket check pack", version: 1, entries: [{ id: 1, category: "Check", word: "Beacon", impostorHint: "Light" }, { id: 2, category: "Check", word: "Anchor", impostorHint: "Harbor" }] };
  const uploaded = await request(host, "uploadWordPack", { hostToken: created.hostToken, pack: customPack });
  assert.equal(uploaded.pack.packId, customPackId, "Cloud upload must return the registered custom pack.");
  let packSnapshot = await repository.getAudienceSnapshot({ roomId, hostToken: created.hostToken });
  assert.equal(packSnapshot.packs.find((pack) => pack.packId === customPackId)?.entryCount, 2, "Host snapshots must include persisted custom pack metadata.");
  await request(host, "setWordPackEnabled", { hostToken: created.hostToken, packId: customPackId, enabled: false });
  packSnapshot = await repository.getAudienceSnapshot({ roomId, hostToken: created.hostToken });
  assert.equal(packSnapshot.packs.find((pack) => pack.packId === customPackId)?.enabled, false, "Host pack controls must persist a disabled state.");
  await request(host, "setWordPackEnabled", { hostToken: created.hostToken, packId: customPackId, enabled: true });

  setStage("player-join");
  const player = await connect(baseUrl); sockets.push(player);
  const joined = await request(player, "joinRoom", { roomCode, password, userId: "Guest" });
  assert.equal(joined.snapshot.packs.length, 0, "A player snapshot must not expose host pack controls.");
  assert.equal(joined.snapshot.wordChoices.length, 0, "A player snapshot must not expose host word choices.");
  assert.equal(joined.snapshot.ownRole, null, "A lobby player must not receive a role.");

  const thirdPlayer = await connect(baseUrl); sockets.push(thirdPlayer);
  const thirdJoined = await request(thirdPlayer, "joinRoom", { roomCode, password, userId: "Third" });
  const activeSeats = [
    { socket: host, sessionToken: created.sessionToken, playerId: created.playerId },
    { socket: player, sessionToken: joined.sessionToken, playerId: joined.playerId },
    { socket: thirdPlayer, sessionToken: thirdJoined.sessionToken, playerId: thirdJoined.playerId }
  ];
  setStage("round-and-direct-message");
  for (const seat of activeSeats) await request(seat.socket, "setReady", { sessionToken: seat.sessionToken, isReady: true });
  await request(host, "startRound", { hostToken: created.hostToken });
  const afterStart = await repository.getAudienceSnapshot({ roomId, hostToken: created.hostToken });
  assert.equal(afterStart.room.gamePhase, "clues", "Cloud start must open the clue phase.");
  assert.equal(afterStart.round.roundNumber, 1, "Cloud start must persist the first round.");
  const directMessage = await request(host, "postDirectMessage", { sessionToken: created.sessionToken, content: "@Guest private signal" });
  assert.ok(directMessage.messageId, "Cloud direct messages must return a persisted message identifier.");
  const guestInbox = await repository.getAudienceSnapshot({ roomId, sessionToken: joined.sessionToken });
  assert.equal(guestInbox.directMessages.length, 1, "The named recipient must receive the private cloud message.");
  assert.equal(guestInbox.directMessages[0].content, "private signal", "The recipient must receive only the message body after the tag.");
  const thirdInbox = await repository.getAudienceSnapshot({ roomId, sessionToken: thirdJoined.sessionToken });
  assert.equal(thirdInbox.directMessages.length, 0, "Unrelated players must not receive private cloud messages.");
  setStage("moderation-alerts-and-clues");
  const nudgeReceived = waitForEvent(player, "nudge");
  await request(host, "nudgePlayer", { hostToken: created.hostToken, playerId: joined.playerId });
  assert.equal((await nudgeReceived).targetPlayerId, joined.playerId, "A nudge must reach only its selected cloud player.");
  const flashReceived = waitForEvent(thirdPlayer, "flashAlert");
  await request(host, "sendFlashAlert", { hostToken: created.hostToken, message: "Cloud check alert" });
  assert.equal((await flashReceived).message, "Cloud check alert", "A persisted flash alert must reach the room.");
  const discussion = await request(player, "postDiscussionMessage", { sessionToken: joined.sessionToken, content: "Review the clues" });
  let moderatedSnapshot = await repository.getAudienceSnapshot({ roomId, hostToken: created.hostToken });
  assert.equal(moderatedSnapshot.discussionMessages.some((message) => message.id === discussion.messageId), true, "Public cloud discussion must appear before moderation.");
  await request(host, "removeDiscussionMessage", { hostToken: created.hostToken, messageId: discussion.messageId });
  moderatedSnapshot = await repository.getAudienceSnapshot({ roomId, hostToken: created.hostToken });
  assert.equal(moderatedSnapshot.discussionMessages.some((message) => message.id === discussion.messageId), false, "Host moderation must remove a public cloud discussion message.");
  const firstHint = await request(host, "submitHint", { sessionToken: created.sessionToken, content: "clue1" });
  assert.equal(firstHint.voteOpened, false, "The first cloud clue must not open voting.");
  const hintToEdit = (await repository.getAudienceSnapshot({ roomId, hostToken: created.hostToken })).hints.find((hint) => hint.playerId === created.playerId);
  assert.ok(hintToEdit, "The first persisted cloud clue must be host-moderatable.");
  await request(host, "editHint", { hostToken: created.hostToken, hintId: hintToEdit.id, content: "edited clue" });
  assert.equal((await repository.getAudienceSnapshot({ roomId, hostToken: created.hostToken })).hints.find((hint) => hint.id === hintToEdit.id)?.content, "edited clue", "A host hint correction must persist in cloud mode.");
  setStage("clues-and-voting");
  for (const [index, seat] of [...activeSeats.slice(1), ...activeSeats].entries()) {
    const hint = await request(seat.socket, "submitHint", { sessionToken: seat.sessionToken, content: `clue${index + 2}` });
    assert.equal(hint.voteOpened, index === 4, "Voting must open only after the second complete clue cycle.");
  }
  const beforeVotes = await repository.getAudienceSnapshot({ roomId, hostToken: created.hostToken });
  assert.equal(beforeVotes.ballot.open, true, "Cloud hints must open voting.");
  await request(host, "setDiscussionLocked", { hostToken: created.hostToken, locked: true });
  await request(host, "submitVote", { sessionToken: created.sessionToken, targetPlayerId: thirdJoined.playerId });
  await request(player, "submitVote", { sessionToken: joined.sessionToken, targetPlayerId: thirdJoined.playerId });
  thirdPlayer.disconnect();
  await waitFor(async () => !(await repository.getAudienceSnapshot({ roomId, hostToken: created.hostToken })).players.find((entry) => entry.id === thirdJoined.playerId)?.isConnected, "The disconnected voter was not recorded offline in cloud mode.");
  const offlineTally = await request(host, "abstainDisconnectedVoter", { hostToken: created.hostToken, playerId: thirdJoined.playerId });
  assert.ok(["eliminated", "finished", "stalemate", "runoff"].includes(offlineTally.result), `A completed offline-voter abstention must resolve through the cloud tally transaction (received ${offlineTally.result}).`);
  let afterTally = await repository.getAudienceSnapshot({ roomId, hostToken: created.hostToken });
  if (afterTally.room.status !== "revealed") {
    await request(host, "revealRoles", { hostToken: created.hostToken });
    afterTally = await repository.getAudienceSnapshot({ roomId, hostToken: created.hostToken });
  }
  const recapHint = afterTally.hints.find((hint) => hint.id === hintToEdit.id);
  assert.ok(recapHint, "The edited clue must remain available during cloud recap.");
  await request(host, "markMemorableClue", { hostToken: created.hostToken, hintId: recapHint.id });
  assert.equal((await repository.getAudienceSnapshot({ roomId, hostToken: created.hostToken })).hints.find((hint) => hint.id === recapHint.id)?.memorable, true, "A memorable clue award must persist during cloud recap.");
  setStage("continuation-and-pack-delete");
  await request(host, "continueRound", { hostToken: created.hostToken });
  const continued = await repository.getAudienceSnapshot({ roomId, hostToken: created.hostToken });
  assert.equal(continued.room.status, "lobby", "Cloud continuation must reset the room to the lobby.");
  await request(host, "deleteWordPack", { hostToken: created.hostToken, packId: customPackId });
  const afterPackDelete = await repository.getAudienceSnapshot({ roomId, hostToken: created.hostToken });
  assert.equal(afterPackDelete.packs.some((pack) => pack.packId === customPackId), false, "Cloud custom pack deletion must remove host-only metadata after the round.");
  setStage("voluntary-leave");
  const rejoinedThirdPlayer = await connect(baseUrl); sockets.push(rejoinedThirdPlayer);
  const rejoinedThird = await request(rejoinedThirdPlayer, "joinRoom", { roomCode, password, userId: "Third", sessionToken: thirdJoined.sessionToken });
  assert.equal(rejoinedThird.playerId, thirdJoined.playerId, "A disconnected cloud player must reclaim the same seat before voluntarily leaving.");
  const voluntaryLeave = await request(rejoinedThirdPlayer, "leaveRoom", { sessionToken: rejoinedThird.sessionToken });
  assert.equal(voluntaryLeave.result, "waiting", "A lobby departure must leave the session open for the remaining table.");
  const afterLeave = await repository.getAudienceSnapshot({ roomId, hostToken: created.hostToken });
  assert.equal(afterLeave.players.find((entry) => entry.id === thirdJoined.playerId)?.isGhost, true, "Voluntary cloud departure must move the player to Ghost status.");

  setStage("host-recovery-and-end");
  host.disconnect();
  await delay(120);
  const recoveredHost = await connect(baseUrl); sockets.push(recoveredHost);
  const recovered = await request(recoveredHost, "recoverHost", { roomCode, password });
  assert.equal(recovered.hostToken, created.hostToken, "Password-verified recovery must retain the original host authority.");
  assert.ok(recovered.snapshot.packs.length > 0, "Recovered hosts must receive host-only controls.");
  assert.equal(recovered.snapshot.directMessages.length, 0, "Host snapshots must not receive private player direct messages.");
  await request(recoveredHost, "endRoom", { hostToken: created.hostToken });
  assert.equal(await repository.findRoomByCode(roomCode), null, "Cloud end-room must purge the complete room session.");
  roomId = null;

  console.log("CLOUD_ENTRY_SOCKET_CHECK create=ok join=ok recovery=ok presence=ok snapshots=ok packs=ok directMessages=ok moderation=ok alerts=ok rounds=ok hints=ok ballots=ok tally=ok leave=ok endRoom=ok cleanup=pending secrets=redacted");
} catch (error) {
  lifecycleError = error;
  console.error(`CLOUD_ENTRY_SOCKET_CHECK failed_stage=${stage} secrets=redacted`);
} finally {
  sockets.forEach((socket) => socket.disconnect());
  if (server) await stopServer(server);
  if (roomId) {
    const cleaned = await Promise.race([
      repository.purgeRoomSession(roomId).then(() => true).catch(() => false),
      delay(20_000).then(() => false)
    ]);
    if (!cleaned && !lifecycleError) lifecycleError = new Error("Cloud lifecycle cleanup did not complete within 20 seconds.");
  }
}

if (lifecycleError) throw lifecycleError;
console.log("CLOUD_ENTRY_SOCKET_CHECK cleanup=ok secrets=redacted");
