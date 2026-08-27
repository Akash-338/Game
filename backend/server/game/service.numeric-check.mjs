import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testDataDirectory = path.join(os.tmpdir(), `word-impostor-game-flow-${process.pid}-${Date.now()}`);
fs.rmSync(testDataDirectory, { recursive: true, force: true });
process.env.WORD_IMPOSTOR_DATA_DIRECTORY = testDataDirectory;

const {
  bootstrapPacks,
  continueRound,
  createRoom,
  editHint,
  endRoom,
  getRoomByHostToken,
  joinRoom,
  kickPlayer,
  leaveRoom,
  listPacks,
  recoverHostRoom,
  restartSession,
  revealRoles,
  setPresence,
  setReady,
  snapshot,
  startRound,
  submitHint,
  updateSettings,
} = await import("./service.js");
const { default: db, closeDatabase, purgeUnfinishedRoomSessions } = await import("./db.js");

bootstrapPacks();
let hostToken;

try {
  const creatorRoom = createRoom({ roomCode: `H${Date.now().toString(36).slice(-7)}`.toUpperCase(), password: "creator-pass", hostUserId: "Nova" });
  const creatorRoomRecord = getRoomByHostToken(creatorRoom.hostToken);
  assert.equal(creatorRoomRecord.hostUserId, "Nova", "The room creator retains a named host identity");
  assert.ok(creatorRoom.playerId && creatorRoom.sessionToken, "Creating a room with a name creates a player seat for the host");
  assert.equal(snapshot(creatorRoomRecord.id, { playerId: creatorRoom.playerId }).players.find((player) => player.id === creatorRoom.playerId).userId, "Nova", "The host player seat is visible to normal player snapshots");
  const recoveredCreator = recoverHostRoom({ roomCode: creatorRoom.roomCode, password: "creator-pass" });
  assert.equal(recoveredCreator.playerId, creatorRoom.playerId, "Host recovery preserves the creator player seat");
  endRoom(creatorRoom.hostToken);

  const legacyRoom = createRoom({ roomCode: `M${Date.now().toString(36).slice(-7)}`.toUpperCase(), password: "legacy-pass" });
  const legacyRoomRecord = getRoomByHostToken(legacyRoom.hostToken);
  const legacyRoundId = "legacy-combined-round";
  db.prepare("INSERT INTO word_packs (id,packId,name,version,filePath,uploadedAt,isDefault) VALUES (?,?,?,?,?,?,?)").run("legacy-combined-pack", "warm-party-classic", "Warm Party Classic", 5, "retired-combined-pack.json", Date.now(), 1);
  db.prepare("INSERT INTO room_word_packs (roomId,packId,enabled) VALUES (?,?,1)").run(legacyRoomRecord.id, "warm-party-classic");
  db.prepare("INSERT INTO rounds (id,roomId,roundNumber,wordEntryId,wordPackId,category,actualWord,impostorHint,impostorCount,showCategoryToImpostor,showHintToImpostor,status,startedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(legacyRoundId, legacyRoomRecord.id, 1, "warm-party-classic:13", "warm-party-classic", "Food", "Pizza", "Cheese", 1, 1, 1, "revealed", Date.now());
  db.prepare("INSERT INTO used_word_entries (id,roomId,wordEntryId,roundId,usedAt) VALUES (?,?,?,?,?)").run("legacy-combined-used-word", legacyRoomRecord.id, "warm-party-classic:13", legacyRoundId, Date.now());
  db.prepare("UPDATE rooms SET selectedWordEntryId=? WHERE id=?").run("warm-party-classic:13", legacyRoomRecord.id);
  bootstrapPacks();
  assert.deepEqual(listPacks().filter((pack) => pack.isDefault).map((pack) => pack.packId).sort(), ["warm-party-classic-animal", "warm-party-classic-food", "warm-party-classic-fruits", "warm-party-classic-karnataka-big-cities", "warm-party-classic-object", "warm-party-classic-sports"].sort());
  assert.equal(db.prepare("SELECT packId FROM word_packs WHERE packId=?").get("warm-party-classic"), undefined, "The retired combined pack record must be removed.");
  assert.equal(db.prepare("SELECT wordPackId, wordEntryId FROM rounds WHERE id=?").get(legacyRoundId).wordPackId, "warm-party-classic-food");
  assert.equal(db.prepare("SELECT wordEntryId FROM used_word_entries WHERE id=?").get("legacy-combined-used-word").wordEntryId, "warm-party-classic-food:13");
  assert.equal(db.prepare("SELECT selectedWordEntryId FROM rooms WHERE id=?").get(legacyRoomRecord.id).selectedWordEntryId, "warm-party-classic-food:13");
  assert.equal(db.prepare("SELECT packId FROM room_word_packs WHERE roomId=? AND packId=?").get(legacyRoomRecord.id, "warm-party-classic"), undefined);

  const departureRoomCode = `L${Date.now().toString(36).slice(-7)}`.toUpperCase();
  const departureRoom = createRoom({ roomCode: departureRoomCode, password: "leave-pass" });
  const departurePlayers = ["Leela", "Mohan", "Nisha"].map((userId) => joinRoom({ roomCode: departureRoomCode, password: "leave-pass", userId }));
  departurePlayers.forEach((player) => setPresence(player.sessionToken, true));
  setPresence(departurePlayers[0].sessionToken, false);
  const rejoinedLeela = joinRoom({ roomCode: departureRoomCode, password: "leave-pass", userId: "Leela" });
  assert.equal(rejoinedLeela.playerId, departurePlayers[0].playerId, "A normal disconnect remains reconnectable.");
  leaveRoom(departurePlayers[1].sessionToken);
  const departureRoomRecord = getRoomByHostToken(departureRoom.hostToken);
  const departureSnapshot = snapshot(departureRoomRecord.id, { isHost: true });
  assert.equal(departureSnapshot.players.some((player) => player.id === departurePlayers[1].playerId), false, "An explicit leave must remove the player from the host roster immediately.");
  assert.throws(() => setPresence(departurePlayers[1].sessionToken, true), /Player session is not valid/, "An explicitly left session cannot silently reconnect.");
  assert.ok(departureSnapshot.gameLog.some((event) => event.type === "player_left" && event.meta.playerId === departurePlayers[1].playerId), "The room activity log records an intentional departure.");
  endRoom(departureRoom.hostToken);

  const roomCode = `N${Date.now().toString(36).slice(-7)}`.toUpperCase();
  const created = createRoom({ roomCode, password: "table-pass" });
  hostToken = created.hostToken;
  assert.deepEqual(recoverHostRoom({ roomCode: roomCode.toLowerCase(), password: "table-pass" }), { roomCode, hostToken });
  assert.throws(() => recoverHostRoom({ roomCode, password: "incorrect" }), /Room password is incorrect/);
  const players = ["Asha", "Ben", "Cara"].map((userId) => joinRoom({ roomCode, password: "table-pass", userId }));
  players.forEach((player) => { setPresence(player.sessionToken, true); setReady(player.sessionToken, true); });
  kickPlayer(hostToken, players[1].playerId);
  assert.throws(() => setReady(players[1].sessionToken, true), /Player session is not valid/);
  const rejoinedBen = joinRoom({ roomCode, password: "table-pass", userId: "Ben" });
  assert.equal(rejoinedBen.playerId, players[1].playerId, "A kicked player must reclaim the existing player record rather than create a duplicate.");
  assert.notEqual(rejoinedBen.sessionToken, players[1].sessionToken, "A kicked player must receive a fresh session token.");
  assert.equal(rejoinedBen.isGhost, false);
  setPresence(rejoinedBen.sessionToken, true);
  setReady(rejoinedBen.sessionToken, true);
  players[1] = rejoinedBen;
  setPresence(players[0].sessionToken, false);
  const rejoinedAsha = joinRoom({ roomCode, password: "table-pass", userId: "Asha" });
  assert.deepEqual(rejoinedAsha, { roomCode, sessionToken: players[0].sessionToken, playerId: players[0].playerId, isGhost: false });
  setPresence(rejoinedAsha.sessionToken, true);

  const room = getRoomByHostToken(hostToken);
  const choice = snapshot(room.id, { isHost: true }).wordChoices.find((entry) => entry.entryId === 13);
  assert.deepEqual(choice, { id: "warm-party-classic-food:13", entryId: 13, category: "Food", word: "Pizza", packId: "warm-party-classic-food" });
  updateSettings(hostToken, { selectedWordEntryId: choice.id });
  startRound(hostToken);
  const firstRound = snapshot(room.id, { isHost: true, peek: true });
  assert.equal(firstRound.round.actualWord, undefined, "The host screen must not receive the live secret word");
  assert.equal(firstRound.round.category, undefined, "The host screen must not receive the live category");
  assert.throws(() => joinRoom({ roomCode, password: "table-pass", userId: "Dara" }), /Join as a Ghost/);
  const lateGhost = joinRoom({ roomCode, password: "table-pass", userId: "Dara", isGhost: true });
  assert.equal(lateGhost.isGhost, true);
  setPresence(lateGhost.sessionToken, true);

  const firstHint = submitHint(players[0].sessionToken, "Crust");
  assert.equal(firstHint.player.id, players[1].playerId);
  assert.equal(snapshot(room.id, { isHost: true }).hints[0].content, "Crust");
  assert.equal(snapshot(room.id, { playerId: players[1].playerId }).hints[0].content, "Crust", "Every player sees submitted hints");
  assert.equal(snapshot(room.id, { playerId: lateGhost.playerId, isGhost: true }).hints[0].content, "Crust", "Ghosts see submitted hints");
  assert.throws(() => submitHint(players[1].sessionToken, "  crust  "), /already been used/);
  assert.equal(snapshot(room.id, { isHost: true }).currentTurnPlayerId, players[1].playerId, "A rejected duplicate must not advance the turn");
  submitHint(players[1].sessionToken, "Slice");
  submitHint(players[2].sessionToken, "Oven");
  const crustHint = snapshot(room.id, { isHost: true }).hints.find((hint) => hint.content === "Crust");
  assert.throws(() => editHint(hostToken, crustHint.id, "OVEN"), /already been used/);
  assert.throws(() => submitHint(players[0].sessionToken, "slice"), /already been used/);
  assert.equal(snapshot(room.id, { isHost: true }).currentTurnPlayerId, players[0].playerId, "A second-cycle duplicate must not advance the turn");
  const secondCycle = submitHint(players[0].sessionToken, "Cheese");
  assert.equal(secondCycle.cycleNumber, 2);
  const hintHistory = snapshot(room.id, { isHost: true }).hints.filter((hint) => hint.playerId === players[0].playerId);
  assert.deepEqual(hintHistory.map((hint) => [hint.cycleNumber, hint.content]), [[1, "Crust"], [2, "Cheese"]]);

  db.prepare("UPDATE players SET isGhost=1, isReady=0 WHERE id=?").run(players[2].playerId);
  db.prepare("UPDATE player_scores SET points=7 WHERE roomId=? AND playerId=?").run(room.id, players[0].playerId);
  revealRoles(hostToken);
  assert.equal(snapshot(room.id, { isHost: true }).round.actualWord, "Pizza", "The secret is available after the reveal");
  continueRound(hostToken);
  assert.equal(snapshot(room.id, { isHost: true }).players.find((player) => player.id === players[2].playerId).isGhost, false, "Continue restores eliminated Ghosts to the active player table");
  assert.equal(snapshot(room.id, { isHost: true }).scores.find((score) => score.playerId === players[0].playerId).points, 7, "Continue preserves cumulative player scores until the room ends");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM used_word_entries WHERE roomId=?").get(room.id).count, 0, "Continue resets the reusable word pool for the next round");
  updateSettings(hostToken, { selectedWordEntryId: "warm-party-classic-food:13" });
  players.forEach((player) => setReady(player.sessionToken, true));
  setReady(lateGhost.sessionToken, true);
  startRound(hostToken);
  const secondRound = db.prepare("SELECT actualWord FROM rounds WHERE roomId=? ORDER BY startedAt DESC LIMIT 1").get(room.id);
  assert.equal(secondRound.actualWord, "Pizza", "A reset word pool allows a prior-round word to be chosen again in a new round");

  const roomId = room.id;
  endRoom(hostToken);
  assert.equal(getRoomByHostToken(hostToken), undefined);
  const cleanupChecks = [
    ["rooms", "SELECT COUNT(*) AS count FROM rooms WHERE id=?"],
    ["players", "SELECT COUNT(*) AS count FROM players WHERE roomId=?"],
    ["rounds", "SELECT COUNT(*) AS count FROM rounds WHERE roomId=?"],
    ["hints", "SELECT COUNT(*) AS count FROM hints WHERE roundId IN (SELECT id FROM rounds WHERE roomId=?)"],
    ["hint_entries", "SELECT COUNT(*) AS count FROM hint_entries WHERE roundId IN (SELECT id FROM rounds WHERE roomId=?)"],
    ["used_word_entries", "SELECT COUNT(*) AS count FROM used_word_entries WHERE roomId=?"],
    ["host_alerts", "SELECT COUNT(*) AS count FROM host_alerts WHERE roomId=?"],
  ];
  cleanupChecks.forEach(([table, query]) => {
    assert.equal(db.prepare(query).get(roomId).count, 0, `${table} should be removed when the room ends`);
  });
  const recreated = createRoom({ roomCode, password: "new-table-pass" });
  assert.equal(recreated.roomCode, roomCode);
  endRoom(recreated.hostToken);
  const staleRoomCode = `S${Date.now().toString(36).slice(-7)}`.toUpperCase();
  const stale = createRoom({ roomCode: staleRoomCode, password: "stale-pass" });
  const staleRoom = getRoomByHostToken(stale.hostToken);
  const stalePlayers = ["Davi", "Esha", "Faru"].map((userId) => joinRoom({ roomCode: staleRoomCode, password: "stale-pass", userId }));
  stalePlayers.forEach((player) => { setPresence(player.sessionToken, true); setReady(player.sessionToken, true); });
  startRound(stale.hostToken);
  submitHint(stalePlayers[0].sessionToken, "Fresh");
  const purgedRoomIds = purgeUnfinishedRoomSessions();
  assert.ok(purgedRoomIds.includes(staleRoom.id), "Startup cleanup should find the unfinished session");
  cleanupChecks.forEach(([table, query]) => {
    assert.equal(db.prepare(query).get(staleRoom.id).count, 0, `${table} should be removed by startup cleanup`);
  });
  const reusedAfterCrash = createRoom({ roomCode: staleRoomCode, password: "reused-after-crash" });
  assert.equal(reusedAfterCrash.roomCode, staleRoomCode, "A stale room ID should be immediately reusable");
  endRoom(reusedAfterCrash.hostToken);
  hostToken = undefined;

  console.log("SERVICE_GAME_FLOW_CHECK numericIds=ok hostRecovery=ok playerRejoin=ok voluntaryDeparture=ok sharedHints=ok hostWordPrivacy=ok hostExit=graceful roomPurge=ok roomReuse=ok noRepeat=ok duplicateHints=ok crashCleanup=ok");
} finally {
  if (hostToken) {
    try { restartSession(hostToken); } catch {}
  }
  closeDatabase();
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
}
