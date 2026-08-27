import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { createSupabaseGameRepository } from "../server/cloud/supabaseGameRepository.js";
import { getWordImpostorRuntimeSecrets } from "../server/runtimeConfig.js";

const { supabaseUrl, supabaseSecretKey } = getWordImpostorRuntimeSecrets();
if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required for the cloud room RPC check.");
}

const repository = createSupabaseGameRepository({ url: supabaseUrl, secretKey: supabaseSecretKey });
const client = createClient(supabaseUrl, supabaseSecretKey, { auth: { autoRefreshToken: false, persistSession: false } });
const timestamp = Date.now();
const room = {
  id: `cloud-check-${nanoid(12)}`,
  roomCode: `T${nanoid(7).toUpperCase()}`,
  passwordHash: "server-only-test-hash",
  hostUserId: "CloudCheckHost",
  hostToken: nanoid(32),
  createdAt: timestamp
};
const creatorPlayer = {
  id: `cloud-check-player-${nanoid(10)}`,
  userId: room.hostUserId,
  sessionToken: nanoid(32),
  avatarId: "Fox",
  avatarColor: "#D86B4C",
  joinedAt: timestamp
};
const operationId = `cloud-check-operation-${nanoid(12)}`;
const eventId = `cloud-check-event-${nanoid(12)}`;

try {
  const created = await repository.createRoomAtomically({ operationId, room, creatorPlayer, eventId });
  assert.equal(created.roomId, room.id);
  assert.equal(created.replayed, false);

  const replayed = await repository.createRoomAtomically({ operationId, room, creatorPlayer, eventId });
  assert.equal(replayed.roomId, room.id);
  assert.equal(replayed.replayed, true);
  const recoverableRoom = await repository.findRoomByCode(room.roomCode);
  assert.equal(recoverableRoom.id, room.id);
  const hostTokenRoom = await repository.findRoomByHostToken(room.hostToken);
  assert.equal(hostTokenRoom.room_code, room.roomCode);
  const recoverableCreator = await repository.findPlayerForRecovery({ roomId: room.id, userId: room.hostUserId });
  assert.equal(recoverableCreator.id, creatorPlayer.id);
  const creatorSession = await repository.findPlayerBySessionToken(creatorPlayer.sessionToken);
  assert.equal(creatorSession.room_id, room.id);

  const joined = await repository.joinOrReclaimPlayerAtomically({
    operationId: `cloud-check-join-${nanoid(12)}`,
    roomId: room.id,
    userId: "CloudCheckPlayer",
    isGhost: false,
    player: { id: `cloud-check-joined-${nanoid(10)}`, sessionToken: nanoid(32), avatarId: "Owl", avatarColor: "#E9AE42", joinedAt: timestamp }
  });
  assert.equal(joined.roomCode, room.roomCode);

  const joinedReplay = await repository.joinOrReclaimPlayerAtomically({
    operationId: `cloud-check-reclaim-${nanoid(12)}`,
    roomId: room.id,
    existingSessionToken: joined.sessionToken,
    userId: "CloudCheckPlayer",
    isGhost: false,
    player: { id: `cloud-check-unused-${nanoid(10)}`, sessionToken: nanoid(32), avatarId: "Owl", avatarColor: "#E9AE42", joinedAt: timestamp }
  });
  assert.equal(joinedReplay.playerId, joined.playerId);

  const thirdPlayer = await repository.joinOrReclaimPlayerAtomically({
    operationId: `cloud-check-third-${nanoid(12)}`,
    roomId: room.id,
    userId: "CloudCheckThird",
    isGhost: false,
    player: { id: `cloud-check-third-player-${nanoid(10)}`, sessionToken: nanoid(32), avatarId: "Panda", avatarColor: "#4C8A70", joinedAt: timestamp }
  });
  assert.equal(thirdPlayer.roomCode, room.roomCode);

  const fourthPlayer = await repository.joinOrReclaimPlayerAtomically({
    operationId: `cloud-check-fourth-${nanoid(12)}`,
    roomId: room.id,
    userId: "CloudCheckFourth",
    isGhost: false,
    player: { id: `cloud-check-fourth-player-${nanoid(10)}`, sessionToken: nanoid(32), avatarId: "Koala", avatarColor: "#7B6AA6", joinedAt: timestamp }
  });
  assert.equal(fourthPlayer.roomCode, room.roomCode);

  const settingsInput = {
    operationId: `cloud-check-settings-${nanoid(10)}`,
    roomId: room.id,
    hostToken: room.hostToken,
    changes: { impostorCount: 1, clueCycleLimit: 2, selectedCategories: ["Animal"], showCategoryToImpostor: true, showHintToImpostor: true, soundMuted: false },
    createdAt: timestamp + 1
  };
  const settings = await repository.updateLobbySettingsAtomically(settingsInput);
  assert.equal(settings.roomId, room.id);
  const settingsReplay = await repository.updateLobbySettingsAtomically(settingsInput);
  assert.equal(settingsReplay.replayed, true);
  const playerOrder = [fourthPlayer.playerId, thirdPlayer.playerId, joined.playerId, creatorPlayer.id];
  const reordered = await repository.reorderPlayersAtomically({ operationId: `cloud-check-reorder-${nanoid(10)}`, roomId: room.id, hostToken: room.hostToken, playerIds: playerOrder, createdAt: timestamp + 2 });
  assert.equal(reordered.roomId, room.id);

  const readyParticipants = [creatorPlayer, joined, thirdPlayer, fourthPlayer];
  for (const [index, player] of readyParticipants.entries()) {
    const presenceInput = {
      operationId: `cloud-check-presence-${index}-${nanoid(10)}`,
      roomId: room.id,
      sessionToken: player.sessionToken,
      connected: true,
      createdAt: timestamp + index
    };
    const presence = await repository.setPresenceAtomically(presenceInput);
    assert.equal(presence.connected, true);
    if (index === 0) {
      const presenceReplay = await repository.setPresenceAtomically(presenceInput);
      assert.equal(presenceReplay.replayed, true);
    }
    const ready = await repository.setReadyAtomically({
      operationId: `cloud-check-ready-${index}-${nanoid(10)}`,
      roomId: room.id,
      sessionToken: player.sessionToken,
      ready: true,
      createdAt: timestamp + index
    });
    assert.equal(ready.ready, true);
  }
  const { data: entries, error: entryError } = await client
    .from("word_pack_entries")
    .select("entry_id,category,word,impostor_hint")
    .eq("pack_id", "warm-party-classic-animal")
    .eq("entry_id", 1)
    .limit(1);
  if (entryError || entries.length !== 1) throw new Error(`Supabase cloud word setup failed: ${entryError?.message || "entry unavailable"}`);
  const entry = entries[0];
  const round = {
    id: `cloud-check-round-${nanoid(10)}`,
    roundNumber: 1,
    wordEntryId: String(entry.entry_id),
    wordPackId: "warm-party-classic-animal",
    category: entry.category,
    actualWord: entry.word,
    impostorHint: entry.impostor_hint,
    impostorCount: 1,
    showCategoryToImpostor: true,
    showHintToImpostor: true,
    startedAt: timestamp,
    usedWordEntryId: `cloud-check-used-${nanoid(10)}`
  };
  const roundOperationId = `cloud-check-round-operation-${nanoid(12)}`;
  const roundStarted = await repository.startRoundAtomically({
    operationId: roundOperationId,
    roomId: room.id,
    round,
    wordChoiceKey: "warm-party-classic-animal:1",
    impostorPlayerIds: [creatorPlayer.id],
    eventId: `cloud-check-round-event-${nanoid(10)}`
  });
  assert.equal(roundStarted.roundId, round.id);
  assert.equal(roundStarted.replayed, false);
  const roundReplay = await repository.startRoundAtomically({
    operationId: roundOperationId,
    roomId: room.id,
    round,
    wordChoiceKey: "warm-party-classic-animal:1",
    impostorPlayerIds: [creatorPlayer.id],
    eventId: `cloud-check-unused-event-${nanoid(10)}`
  });
  assert.equal(roundReplay.roundId, round.id);
  assert.equal(roundReplay.replayed, true);

  const creatorPlayerSnapshot = await repository.getAudienceSnapshot({ roomId: room.id, sessionToken: creatorPlayer.sessionToken });
  assert.equal(creatorPlayerSnapshot.ownRole.role, "impostor");
  assert.equal(creatorPlayerSnapshot.round.actualWord, undefined);
  assert.equal(creatorPlayerSnapshot.roles.length, 0);
  assert.equal(creatorPlayerSnapshot.wordChoices.length, 0);
  const hostControlSnapshot = await repository.getAudienceSnapshot({ roomId: room.id, hostToken: room.hostToken, peek: true });
  assert.equal(hostControlSnapshot.roles.length, 4);
  assert.equal(hostControlSnapshot.wordChoices.some((choice) => choice.id === "warm-party-classic-animal:1"), false);
  const nextTurn = await repository.nextTurnAtomically({ operationId: `cloud-check-next-turn-${nanoid(10)}`, roomId: room.id, hostToken: room.hostToken, createdAt: timestamp + 3 });
  assert.equal(nextTurn.playerId, thirdPlayer.playerId);

  const clueParticipants = [
    { id: thirdPlayer.playerId, sessionToken: thirdPlayer.sessionToken, label: "third" },
    { id: joined.playerId, sessionToken: joined.sessionToken, label: "player" },
    { id: creatorPlayer.id, sessionToken: creatorPlayer.sessionToken, label: "host" },
    { id: fourthPlayer.playerId, sessionToken: fourthPlayer.sessionToken, label: "fourth" }
  ];
  let lastHintResult = null;
  for (const cycleNumber of [1, 2]) {
    for (const [index, participant] of clueParticipants.entries()) {
      const hintOperationId = `cloud-check-hint-${cycleNumber}-${participant.label}-${nanoid(10)}`;
      const input = {
        operationId: hintOperationId,
        roomId: room.id,
        sessionToken: participant.sessionToken,
        hintId: `cloud-check-hint-row-${cycleNumber}-${index}-${nanoid(8)}`,
        content: `${participant.label}-${cycleNumber}-${index}`,
        createdAt: timestamp + cycleNumber * 10 + index
      };
      lastHintResult = await repository.submitHintAtomically(input);
      assert.equal(lastHintResult.cycleNumber, cycleNumber);
      if (cycleNumber === 1 && index === 0) {
        const hintReplay = await repository.submitHintAtomically(input);
        assert.equal(hintReplay.replayed, true);
      }
    }
  }
  assert.equal(lastHintResult.voteOpened, true);
  assert.equal(lastHintResult.voteNumber, 1);

  const { data: phaseRows, error: phaseError } = await client.from("rooms").select("game_phase,vote_number").eq("id", room.id).limit(1);
  if (phaseError || phaseRows.length !== 1) throw new Error(`Supabase cloud voting transition verification failed: ${phaseError?.message || "room unavailable"}`);
  assert.equal(phaseRows[0].game_phase, "voting");
  assert.equal(phaseRows[0].vote_number, 1);
  const discussionInput = {
    operationId: `cloud-check-discussion-${nanoid(10)}`,
    roomId: room.id,
    sessionToken: joined.sessionToken,
    messageId: `cloud-check-discussion-row-${nanoid(8)}`,
    content: "Public cloud discussion",
    createdAt: timestamp + 20_000
  };
  const locked = await repository.setDiscussionLockedAtomically({ operationId: `cloud-check-lock-${nanoid(10)}`, roomId: room.id, hostToken: room.hostToken, locked: true, createdAt: timestamp + 19_000 });
  assert.equal(locked.locked, true);
  await assert.rejects(() => repository.postDiscussionMessageAtomically(discussionInput), /(locked|unavailable)/);
  const unlocked = await repository.setDiscussionLockedAtomically({ operationId: `cloud-check-unlock-${nanoid(10)}`, roomId: room.id, hostToken: room.hostToken, locked: false, createdAt: timestamp + 19_500 });
  assert.equal(unlocked.locked, false);
  const discussion = await repository.postDiscussionMessageAtomically(discussionInput);
  assert.equal(discussion.playerId, joined.playerId);
  assert.equal(discussion.content, "Public cloud discussion");
  const discussionReplay = await repository.postDiscussionMessageAtomically(discussionInput);
  assert.equal(discussionReplay.replayed, true);

  const voteInputs = [
    { sessionToken: creatorPlayer.sessionToken, targetPlayerId: joined.playerId, skipped: false },
    { sessionToken: joined.sessionToken, targetPlayerId: creatorPlayer.id, skipped: false },
    { sessionToken: thirdPlayer.sessionToken, targetPlayerId: null, skipped: true },
    { sessionToken: fourthPlayer.sessionToken, targetPlayerId: creatorPlayer.id, skipped: false }
  ];
  let lastVoteResult = null;
  for (const [index, vote] of voteInputs.entries()) {
    const input = {
      operationId: `cloud-check-vote-${index}-${nanoid(10)}`,
      roomId: room.id,
      sessionToken: vote.sessionToken,
      voteId: `cloud-check-vote-row-${index}-${nanoid(8)}`,
      targetPlayerId: vote.targetPlayerId,
      skipped: vote.skipped,
      createdAt: timestamp + 100 + index
    };
    lastVoteResult = await repository.castVoteAtomically(input);
    if (index === 0) {
      const replay = await repository.castVoteAtomically(input);
      assert.equal(replay.replayed, true);
    }
  }
  assert.equal(lastVoteResult.allVoted, true);
  assert.equal(lastVoteResult.votesCast, 4);
  assert.equal(lastVoteResult.eligibleVoters, 4);
  const tally = await repository.resolveVoteTallyAtomically({
    operationId: `cloud-check-tally-${nanoid(10)}`,
    roomId: room.id,
    createdAt: timestamp + 200
  });
  assert.equal(tally.result, "finished");
  assert.equal(tally.winner, "civilians");
  assert.equal(tally.eliminated.length, 1);
  assert.equal(tally.eliminated[0].playerId, creatorPlayer.id);
  const continued = await repository.continueRoundAtomically({
    operationId: `cloud-check-continue-${nanoid(10)}`,
    roomId: room.id,
    createdAt: timestamp + 300
  });
  assert.equal(continued.status, "lobby");
  const privateMessageInput = {
    operationId: `cloud-check-direct-message-${nanoid(10)}`,
    roomId: room.id,
    sessionToken: creatorPlayer.sessionToken,
    messageId: `cloud-check-direct-message-row-${nanoid(8)}`,
    recipientPlayerId: joined.playerId,
    content: "Private cloud clue",
    createdAt: timestamp + 4_000
  };
  const privateMessage = await repository.sendDirectMessageAtomically(privateMessageInput);
  assert.equal(privateMessage.senderPlayerId, creatorPlayer.id);
  assert.equal(privateMessage.recipientPlayerId, joined.playerId);
  const privateMessageReplay = await repository.sendDirectMessageAtomically(privateMessageInput);
  assert.equal(privateMessageReplay.replayed, true);
  const senderMessages = await repository.getAudienceSnapshot({ roomId: room.id, sessionToken: creatorPlayer.sessionToken });
  const recipientMessages = await repository.getAudienceSnapshot({ roomId: room.id, sessionToken: joined.sessionToken });
  const uninvolvedMessages = await repository.getAudienceSnapshot({ roomId: room.id, sessionToken: thirdPlayer.sessionToken });
  assert.equal(senderMessages.directMessages.length, 1);
  assert.equal(recipientMessages.directMessages.length, 1);
  assert.equal(uninvolvedMessages.directMessages.length, 0);
  const { data: storedMessages, error: storedMessagesError } = await client.from("direct_messages").select("sender_player_id,recipient_player_id,content").eq("room_id", room.id);
  if (storedMessagesError) throw new Error(`Supabase direct message verification failed: ${storedMessagesError.message}`);
  assert.deepEqual(storedMessages, [{ sender_player_id: creatorPlayer.id, recipient_player_id: joined.playerId, content: "Private cloud clue" }]);
  const { data: storedDiscussion, error: storedDiscussionError } = await client.from("discussion_messages").select("player_id,content").eq("room_id", room.id);
  if (storedDiscussionError) throw new Error(`Supabase discussion verification failed: ${storedDiscussionError.message}`);
  assert.deepEqual(storedDiscussion, [{ player_id: joined.playerId, content: "Public cloud discussion" }]);
  const { data: resetPlayers, error: resetPlayersError } = await client.from("players").select("is_ghost,is_ready").eq("room_id", room.id);
  if (resetPlayersError) throw new Error(`Supabase continuation player verification failed: ${resetPlayersError.message}`);
  assert.equal(resetPlayers.every((player) => !player.is_ghost && !player.is_ready), true);
  const { count: usedWordCount, error: usedWordError } = await client.from("used_word_entries").select("id", { count: "exact", head: true }).eq("room_id", room.id);
  if (usedWordError) throw new Error(`Supabase continuation word verification failed: ${usedWordError.message}`);
  assert.equal(usedWordCount, 0);

  for (const [index, player] of readyParticipants.entries()) {
    const readyAgain = await repository.setReadyAtomically({ operationId: `cloud-check-ready-again-${index}-${nanoid(10)}`, roomId: room.id, sessionToken: player.sessionToken, ready: true, createdAt: timestamp + 31_000 + index });
    assert.equal(readyAgain.ready, true);
  }
  const revealedRound = { ...round, id: `cloud-check-round-reveal-${nanoid(10)}`, roundNumber: 2, startedAt: timestamp + 32_000, usedWordEntryId: `cloud-check-used-reveal-${nanoid(10)}` };
  const revealedStart = await repository.startRoundAtomically({ operationId: `cloud-check-round-reveal-operation-${nanoid(10)}`, roomId: room.id, round: revealedRound, wordChoiceKey: "warm-party-classic-animal:1", impostorPlayerIds: [creatorPlayer.id], eventId: `cloud-check-round-reveal-event-${nanoid(10)}` });
  assert.equal(revealedStart.roundId, revealedRound.id);
  const manuallyRevealed = await repository.revealRolesAtomically({ operationId: `cloud-check-manual-reveal-${nanoid(10)}`, roomId: room.id, hostToken: room.hostToken, eventId: `cloud-check-manual-reveal-event-${nanoid(10)}`, createdAt: timestamp + 33_000 });
  assert.equal(manuallyRevealed.roundId, revealedRound.id);
  const revealedSnapshot = await repository.getAudienceSnapshot({ roomId: room.id, sessionToken: joined.sessionToken });
  assert.equal(revealedSnapshot.round.actualWord, entry.word);
  assert.equal(revealedSnapshot.roles.length, 4);

  const kickInput = {
    operationId: `cloud-check-kick-${nanoid(10)}`,
    roomId: room.id,
    hostToken: room.hostToken,
    playerId: fourthPlayer.playerId,
    createdAt: timestamp + 30_000
  };
  const kicked = await repository.kickPlayerAtomically(kickInput);
  assert.equal(kicked.playerId, fourthPlayer.playerId);
  const kickedReplay = await repository.kickPlayerAtomically(kickInput);
  assert.equal(kickedReplay.replayed, true);
  const { data: kickedRows, error: kickedRowsError } = await client.from("players").select("is_kicked,is_connected").eq("id", fourthPlayer.playerId).limit(1);
  if (kickedRowsError || kickedRows.length !== 1) throw new Error(`Supabase host-kick verification failed: ${kickedRowsError?.message || "player unavailable"}`);
  assert.deepEqual(kickedRows[0], { is_kicked: true, is_connected: false });

  const { data: roomRows, error: readError } = await client.from("rooms").select("id").eq("id", room.id).limit(1);
  if (readError) throw new Error(`Supabase cloud room verification failed: ${readError.message}`);
  assert.equal(roomRows.length, 1);
} finally {
  const cleanup = await repository.purgeRoomSession(room.id);
  assert.equal(cleanup.deleted, true);
}

console.log("CLOUD_ROOM_RPC_CHECK create=ok replay=ok join=ok reclaim=ok recovery=ok presence=ok readiness=ok settings=ok reorder=ok nextTurn=ok round=ok hints=ok voting=ok ballots=ok discussionLock=ok tally=ok continue=ok directMessages=ok manualReveal=ok kick=ok cleanup=ok secrets=redacted");
