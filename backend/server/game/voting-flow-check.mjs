import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testDataDirectory = path.join(os.tmpdir(), `word-impostor-voting-${process.pid}-${Date.now()}`);
fs.rmSync(testDataDirectory, { recursive: true, force: true });
process.env.WORD_IMPOSTOR_DATA_DIRECTORY = testDataDirectory;

const {
  abstainDisconnectedVoter, bootstrapPacks, createRoom, endRoom, joinRoom, postDirectMessage, setPresence, setReady, snapshot, startRound, submitHint, submitSkipVote, submitVote, winnerForActiveCounts
} = await import("./service.js");
const { default: db, closeDatabase } = await import("./db.js");

try {
  bootstrapPacks();
  const created = createRoom({ roomCode: "VOTE99", password: "table-pass" });
  const players = ["Asha", "Ben", "Cara", "Davi", "Esha", "Faru"].map((userId) => joinRoom({ roomCode: "VOTE99", password: "table-pass", userId }));
  players.forEach((player) => { setPresence(player.sessionToken, true); setReady(player.sessionToken, true); });
  startRound(created.hostToken);
  const room = db.prepare("SELECT * FROM rooms WHERE roomCode=?").get("VOTE99");
  db.prepare("UPDATE players SET role='civilian' WHERE roomId=?").run(room.id);
  db.prepare("UPDATE players SET role='impostor' WHERE id IN (?,?)").run(players[0].playerId, players[1].playerId);
  postDirectMessage(players[2].sessionToken, "@Davi Ben's clue is not relevant.");
  let view = snapshot(room.id, { playerId: players[3].playerId });
  assert.equal(view.directMessages.length, 1, "The tagged recipient receives the private message");
  assert.equal(view.directMessages[0].senderUserId, "Cara");
  assert.equal(view.directMessages[0].recipientUserId, "Davi");
  assert.equal(snapshot(room.id, { playerId: players[4].playerId }).directMessages.length, 0, "Other players never receive private-message content");
  assert.throws(() => postDirectMessage(players[2].sessionToken, "@Davi This second message is spam."), /3 seconds/, "Each sender has a server-authoritative private-message cooldown");

  assert.equal(view.room.clueCycleLimit, 2, "Two complete clue cycles are the default before the first vote");
  players.forEach((player, index) => submitHint(player.sessionToken, `cycle1-${index}`));
  view = snapshot(room.id, { isHost: true });
  assert.equal(view.room.gamePhase, "clues", "The first complete clue cycle does not open the first vote");
  assert.equal(view.ballot.open, false, "No ballot appears until every active player completes clue cycle two");
  players.forEach((player, index) => submitHint(player.sessionToken, `cycle2-${index}`));
  view = snapshot(room.id, { isHost: true });
  assert.equal(view.ballot.open, true);
  assert.equal(view.ballot.isRunoff, false);
  assert.equal(view.ballot.eligibleCount, 6);
  assert.throws(() => submitVote(players[0].sessionToken, players[0].playerId), /cannot vote for yourself/);
  submitVote(players[0].sessionToken, players[1].playerId);
  view = snapshot(room.id, { playerId: players[2].playerId });
  assert.equal(view.ballot.liveVotes.length, 1, "Every viewer receives the first committed live vote immediately");
  assert.equal(view.ballot.liveVotes[0].voter.userId, "Asha");
  assert.equal(view.ballot.liveVotes[0].target.userId, "Ben");
  assert.ok(view.gameLog.some((event) => event.type === "live_vote_cast" && event.message === "Asha voted for Ben."), "The room log records the public voter-to-target event");
  players.slice(1).forEach((player, index) => submitVote(player.sessionToken, players[(index + 2) % players.length].playerId));
  view = snapshot(room.id, { isHost: true });
  assert.equal(view.ballot.isRunoff, true, "A six-way highest-vote tie starts a live public re-vote");
  assert.equal(view.ballot.candidates.length, 6);
  players.forEach((player, index) => submitVote(player.sessionToken, players[(index + 1) % players.length].playerId));
  view = snapshot(room.id, { isHost: true });
  assert.equal(view.room.gamePhase, "clues", "A repeated three-or-more-way tie is a stalemate, not mass elimination");
  assert.equal(view.players.filter((player) => player.isGhost).length, 0);

  players.forEach((player, index) => submitHint(player.sessionToken, `after-${index}`));
  const finalTargets = [players[1], players[0], players[0], players[0], players[1], players[1]];
  let completedVote;
  players.forEach((player, index) => { const outcome = submitVote(player.sessionToken, finalTargets[index].playerId); if (outcome.result !== "waiting") completedVote = outcome; });
  view = snapshot(room.id, { isHost: true });
  assert.equal(view.room.winner, "civilians");
  assert.equal(view.players.filter((player) => player.isGhost).length, 2, "The capped vote eliminates exactly the two highest tied players");
  assert.deepEqual(view.players.filter((player) => player.isGhost).map((player) => player.id).sort(), [players[0].playerId, players[1].playerId].sort());
  assert.equal(completedVote.result, "finished", "The completed ballot resolves to an authoritative game result");
  assert.deepEqual(completedVote.eliminated.map((player) => player.playerId).sort(), [players[0].playerId, players[1].playerId].sort(), "The completed ballot returns the public identities of eliminated players");
  assert.deepEqual(view.voteResult.eliminated.map((player) => player.role).sort(), ["impostor", "impostor"], "Every snapshot includes the public role reveal for the most recent eliminated players");
  const playerResultView = snapshot(room.id, { playerId: players[2].playerId });
  assert.deepEqual(playerResultView.roles.filter((role) => role.role === "impostor").map((role) => role.userId).sort(), ["Asha", "Ben"], "Every player final-result snapshot names impostors even after they were eliminated");
  const civilianScore = view.scores.find((score) => score.playerId === players[2].playerId);
  assert.equal(civilianScore.points, 6, "A civilian gains two correct-vote points and four winning-side points");
  assert.ok(view.scoreEvents.some((entry) => entry.playerId === players[2].playerId && entry.delta === 2 && /correctly voted for an impostor/i.test(entry.reason)), "Public score events explain correct-deduction points");
  assert.ok(view.scoreEvents.some((entry) => entry.playerId === players[2].playerId && entry.delta === 4 && /won the game as a civilian/i.test(entry.reason)), "Public score events explain winning-side points");
  const eliminatedView = snapshot(room.id, { playerId: players[0].playerId, isGhost: false });
  assert.equal(eliminatedView.ownRole, null, "An eliminated player receives a Ghost-safe snapshot even when their socket flag was active");
  assert.throws(() => postDirectMessage(players[0].sessionToken, "@Cara I should not be able to speak."), /Ghosts cannot send/);
  endRoom(created.hostToken);

  assert.equal(winnerForActiveCounts({ impostors: 0, civilians: 0 }), "draw", "An empty active table is always a draw before parity is considered");

  const abstainRoom = createRoom({ roomCode: "ABS99", password: "table-pass" });
  const abstainers = ["Gita", "Hari", "Ira"].map((userId) => joinRoom({ roomCode: "ABS99", password: "table-pass", userId }));
  abstainers.forEach((player) => { setPresence(player.sessionToken, true); setReady(player.sessionToken, true); });
  startRound(abstainRoom.hostToken);
  for (let cycle = 1; cycle <= 2; cycle += 1) abstainers.forEach((player, index) => submitHint(player.sessionToken, `abstain-${cycle}-${index}`));
  setPresence(abstainers[2].sessionToken, false);
  const abstainRoomRecord = db.prepare("SELECT id FROM rooms WHERE roomCode=?").get("ABS99");
  let abstainView = snapshot(abstainRoomRecord.id, { isHost: true });
  assert.equal(abstainView.ballot.open, true, "An offline player remains eligible until the host records an abstention");
  assert.equal(abstainDisconnectedVoter(abstainRoom.hostToken, abstainers[2].playerId).result, "waiting");
  submitVote(abstainers[0].sessionToken, abstainers[1].playerId);
  submitVote(abstainers[1].sessionToken, abstainers[0].playerId);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM votes WHERE roomId=? AND abstained=1").get(abstainRoomRecord.id).count, 1, "The offline player receives exactly one host-recorded abstention");
  endRoom(abstainRoom.hostToken);

  const skipRoom = createRoom({ roomCode: "SKIP99", password: "table-pass" });
  const skippers = ["Mira", "Nila", "Omar"].map((userId) => joinRoom({ roomCode: "SKIP99", password: "table-pass", userId }));
  skippers.forEach((player) => { setPresence(player.sessionToken, true); setReady(player.sessionToken, true); });
  startRound(skipRoom.hostToken);
  for (let cycle = 1; cycle <= 2; cycle += 1) skippers.forEach((player, index) => submitHint(player.sessionToken, `skip-${cycle}-${index}`));
  const skipRoomRecord = db.prepare("SELECT id FROM rooms WHERE roomCode=?").get("SKIP99");
  assert.equal(submitSkipVote(skippers[0].sessionToken).result, "waiting");
  const skipView = snapshot(skipRoomRecord.id, { playerId: skippers[1].playerId });
  assert.equal(skipView.ballot.liveVotes[0].skipped, true, "A skip ballot is visible as a public skip rather than a target vote");
  assert.equal(skipView.ballot.liveVotes[0].target, null);
  submitSkipVote(skippers[1].sessionToken);
  const skipOutcome = submitSkipVote(skippers[2].sessionToken);
  assert.equal(skipOutcome.result, "stalemate", "All skips resolve the ballot without eliminating a player");
  assert.equal(snapshot(skipRoomRecord.id, { isHost: true }).room.gamePhase, "clues", "A no-elimination skip ballot returns the game to clue play");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM votes WHERE roomId=? AND skipped=1").get(skipRoomRecord.id).count, 3, "Every explicit skip is persisted distinctly from an offline abstention");
  endRoom(skipRoom.hostToken);

  const reconnectRoom = createRoom({ roomCode: "REC99", password: "table-pass" });
  const reconnectors = ["Jaya", "Kiran", "Lina"].map((userId) => joinRoom({ roomCode: "REC99", password: "table-pass", userId }));
  reconnectors.forEach((player) => { setPresence(player.sessionToken, true); setReady(player.sessionToken, true); });
  startRound(reconnectRoom.hostToken);
  for (let cycle = 1; cycle <= 2; cycle += 1) reconnectors.forEach((player, index) => submitHint(player.sessionToken, `reconnect-${cycle}-${index}`));
  setPresence(reconnectors[2].sessionToken, false);
  setPresence(reconnectors[2].sessionToken, true);
  const reconnectRoomRecord = db.prepare("SELECT id FROM rooms WHERE roomCode=?").get("REC99");
  const reconnectView = snapshot(reconnectRoomRecord.id, { playerId: reconnectors[2].playerId });
  assert.ok(reconnectView.gameLog.some((event) => event.type === "player_reconnected"), "A returning voter creates a room-wide reconnect notice");
  submitVote(reconnectors[0].sessionToken, reconnectors[1].playerId);
  submitVote(reconnectors[1].sessionToken, reconnectors[0].playerId);
  submitVote(reconnectors[2].sessionToken, reconnectors[0].playerId);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM votes WHERE roomId=?").get(reconnectRoomRecord.id).count, 3, "A reconnected player can submit their still-unlocked ballot");
  endRoom(reconnectRoom.hostToken);

  console.log("VOTING_FLOW_CHECK automaticVote=ok runoff=ok cappedElimination=ok scoreReasons=ok privateMessaging=ok skipVote=ok ghostSafety=ok draw=ok abstention=ok reconnectBallot=ok");
} finally {
  closeDatabase();
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
}
