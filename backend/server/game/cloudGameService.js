import crypto from "node:crypto";
import { nanoid } from "nanoid";

const avatarIds = ["Fox", "Owl", "Panda", "Otter", "Rabbit", "Cat", "Koala", "Bee", "Frog", "Tiger", "Whale", "Parrot"];
const avatarColors = ["#D86B4C", "#E9AE42", "#4C8A70", "#8C5E99", "#4D769D", "#C95B6A", "#A56B48", "#5F9B94"];

function ensure(value, message) {
  if (!value) throw new Error(message);
}

function normalizeRoomCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeUserId(value) {
  return String(value || "").trim();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function matchesPassword(password, stored) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function avatarFor(players, random) {
  const used = new Set((players || []).map((player) => player.avatarId));
  const available = avatarIds.filter((avatarId) => !used.has(avatarId));
  const ids = available.length ? available : avatarIds;
  return {
    avatarId: ids[Math.floor(random() * ids.length)],
    avatarColor: avatarColors[Math.floor(random() * avatarColors.length)]
  };
}

function pickDistinctPlayers(players, count, random) {
  const remaining = [...players];
  const selected = [];
  while (selected.length < count && remaining.length) {
    selected.push(remaining.splice(Math.floor(random() * remaining.length), 1)[0]);
  }
  return selected;
}

export function createCloudGameService({ repository, now = () => Date.now(), random = Math.random, idFactory = () => nanoid() }) {
  if (!repository) throw new Error("Cloud game service requires a Supabase repository.");
  const operationId = (label) => `cloud-service-${label}-${idFactory()}`;

  return {
    async createRoom({ roomCode, password, hostUserId = "" }) {
      const normalizedCode = normalizeRoomCode(roomCode);
      const creatorName = normalizeUserId(hostUserId);
      ensure(/^[A-Z0-9]{4,12}$/.test(normalizedCode), "Room ID must be 4–12 letters or numbers.");
      ensure(String(password || "").length >= 4, "Room password needs at least 4 characters.");
      ensure(!creatorName || creatorName.length <= 20, "Host display name must be 1–20 characters.");
      const createdAt = now();
      const room = { id: idFactory(), roomCode: normalizedCode, passwordHash: hashPassword(password), hostUserId: creatorName || "Host1234", hostToken: nanoid(32), createdAt };
      const creatorPlayer = creatorName ? { id: idFactory(), userId: creatorName, sessionToken: nanoid(32), avatarId: avatarIds[0], avatarColor: avatarColors[0], joinedAt: createdAt } : null;
      const result = await repository.createRoomAtomically({ operationId: operationId("create-room"), room, creatorPlayer, eventId: `room-created-${idFactory()}` });
      return { roomCode: result.roomCode, hostToken: result.hostToken, ...(creatorPlayer ? { playerId: creatorPlayer.id, sessionToken: creatorPlayer.sessionToken, userId: creatorPlayer.userId, isGhost: false } : {}) };
    },
    async recoverHostRoom({ roomCode, password }) {
      const room = await repository.findRoomByCode(normalizeRoomCode(roomCode));
      ensure(room, "Room was not found.");
      ensure(matchesPassword(String(password || ""), room.password_hash), "Room password is incorrect.");
      const participant = await repository.findPlayerForRecovery({ roomId: room.id, userId: room.host_user_id });
      return { roomCode: room.room_code, hostToken: room.host_token, ...(participant && !participant.is_kicked ? { playerId: participant.id, sessionToken: participant.session_token, userId: participant.user_id, isGhost: Boolean(participant.is_ghost) } : {}) };
    },
    async joinRoom({ roomCode, password, userId, isGhost = false, sessionToken = "" }) {
      const room = await repository.findRoomByCode(normalizeRoomCode(roomCode));
      ensure(room, "Room was not found.");
      ensure(matchesPassword(String(password || ""), room.password_hash), "Room password is incorrect.");
      const cleanUserId = normalizeUserId(userId);
      ensure(cleanUserId && cleanUserId.toLowerCase() !== "host1234", "Choose a valid player User ID.");
      const currentSnapshot = await repository.getAudienceSnapshot({ roomId: room.id });
      const avatar = avatarFor(currentSnapshot?.players, random);
      const player = { id: idFactory(), sessionToken: nanoid(32), ...avatar, joinedAt: now() };
      const result = await repository.joinOrReclaimPlayerAtomically({ operationId: operationId("join-room"), roomId: room.id, existingSessionToken: sessionToken || null, userId: cleanUserId, isGhost: Boolean(isGhost), player });
      return { roomCode: result.roomCode, sessionToken: result.sessionToken, playerId: result.playerId, isGhost: Boolean(result.isGhost) };
    },
    async hostPlayerForSession(hostToken, sessionToken) {
      const room = await repository.findRoomByHostToken(hostToken);
      ensure(room, "Host session is not valid.");
      const player = await repository.findPlayerBySessionToken(sessionToken);
      ensure(player && player.room_id === room.id && !player.is_kicked, "Host player session is not valid.");
      return { id: player.id, userId: player.user_id, sessionToken: player.session_token, isGhost: Boolean(player.is_ghost) };
    },
    async getRoomByCode(roomCode) {
      return repository.findRoomByCode(normalizeRoomCode(roomCode));
    },
    async getRoomByHostToken(hostToken) {
      return repository.findRoomByHostToken(hostToken);
    },
    async snapshot(roomId, { playerId = null, sessionToken = null, hostToken = null, isHost = false, isGhost = false, peek = false } = {}) {
      return repository.getAudienceSnapshot({ roomId, sessionToken, hostToken: isHost ? hostToken : null, peek: Boolean(isHost && peek), playerId, isGhost });
    },
    async randomizeWord(hostToken) {
      const room = await repository.findRoomByHostToken(hostToken);
      ensure(room, "Host session is not valid.");
      const hostSnapshot = await repository.getAudienceSnapshot({ roomId: room.id, hostToken });
      ensure(hostSnapshot?.room?.status === "lobby", "Change round settings before the game starts.");
      const wordChoices = hostSnapshot.wordChoices || [];
      ensure(wordChoices.length, "No unused words are available. Change categories or restart the session.");
      const word = wordChoices[Math.floor(random() * wordChoices.length)];
      const result = await repository.updateLobbySettingsAtomically({
        operationId: operationId("randomize-word"),
        roomId: room.id,
        hostToken,
        changes: { selectedWordEntryId: word.id },
        createdAt: now()
      });
      return { ...result, word };
    },
    async startRound(hostToken) {
      const room = await repository.findRoomByHostToken(hostToken);
      ensure(room, "Host session is not valid.");
      const hostSnapshot = await repository.getAudienceSnapshot({ roomId: room.id, hostToken });
      ensure(hostSnapshot?.canStart, "At least three connected ready players are needed.");
      const wordChoices = hostSnapshot.wordChoices || [];
      const selectedChoice = hostSnapshot.room.selectedWordEntryId
        ? wordChoices.find((choice) => choice.id === hostSnapshot.room.selectedWordEntryId)
        : wordChoices[Math.floor(random() * wordChoices.length)];
      ensure(selectedChoice, "Choose an unused word before starting.");
      const entry = await repository.findWordPackEntryByChoice(selectedChoice.id);
      ensure(entry, "Selected word entry was not found.");
      const activePlayers = (hostSnapshot.players || []).filter((player) => !player.isGhost && !player.isKicked && player.isConnected && player.isReady);
      const impostors = pickDistinctPlayers(activePlayers, Number(hostSnapshot.room.impostorCount), random);
      ensure(impostors.length === Number(hostSnapshot.room.impostorCount), "Impostor selection could not be completed.");
      const startedAt = now();
      const round = {
        id: idFactory(),
        roundNumber: Number(hostSnapshot.round?.roundNumber || 0) + 1,
        wordEntryId: selectedChoice.id,
        wordPackId: entry.pack_id,
        category: entry.category,
        actualWord: entry.word,
        impostorHint: entry.impostor_hint,
        impostorCount: Number(hostSnapshot.room.impostorCount),
        showCategoryToImpostor: Boolean(hostSnapshot.room.showCategoryToImpostor),
        showHintToImpostor: Boolean(hostSnapshot.room.showHintToImpostor),
        startedAt,
        usedWordEntryId: idFactory()
      };
      return repository.startRoundAtomically({ operationId: operationId("start-round"), roomId: room.id, round, wordChoiceKey: selectedChoice.id, impostorPlayerIds: impostors.map((player) => player.id), eventId: `round-started-${idFactory()}` });
    },
    async submitHint(sessionToken, content) {
      const player = await repository.findPlayerBySessionToken(sessionToken);
      ensure(player && !player.is_kicked, "Player session is not valid.");
      return repository.submitHintAtomically({ operationId: operationId("submit-hint"), roomId: player.room_id, sessionToken, hintId: idFactory(), content: String(content || "").trim(), createdAt: now() });
    },
    async submitVote(sessionToken, targetPlayerId = null, skipped = false) {
      const player = await repository.findPlayerBySessionToken(sessionToken);
      ensure(player && !player.is_kicked, "Player session is not valid.");
      const cast = await repository.castVoteAtomically({ operationId: operationId("cast-vote"), roomId: player.room_id, sessionToken, voteId: idFactory(), targetPlayerId, skipped: Boolean(skipped), createdAt: now() });
      if (!cast.allVoted) return { ...cast, tally: null };
      const tally = await repository.resolveVoteTallyAtomically({ operationId: operationId("resolve-vote"), roomId: player.room_id, createdAt: now() });
      return { ...cast, tally };
    },
    async continueRound(hostToken) {
      const room = await repository.findRoomByHostToken(hostToken);
      ensure(room, "Host session is not valid.");
      return repository.continueRoundAtomically({ operationId: operationId("continue-round"), roomId: room.id, createdAt: now() });
    },
    async postDirectMessage(sessionToken, rawContent) {
      const player = await repository.findPlayerBySessionToken(sessionToken);
      ensure(player && !player.is_kicked, "Player session is not valid.");
      const match = String(rawContent || "").trim().match(/^@([^\s]+)\s+(.+)$/);
      ensure(match, "Start a private message with @recipient followed by your message.");
      const snapshot = await repository.getAudienceSnapshot({ roomId: player.room_id, sessionToken });
      const recipient = (snapshot?.players || []).find((candidate) => candidate.userId.toLowerCase() === match[1].toLowerCase());
      ensure(recipient && !recipient.isGhost && !recipient.isKicked, "Recipient is not eligible for a private message.");
      ensure(recipient.id !== player.id, "Choose another player for a private message.");
      return repository.sendDirectMessageAtomically({ operationId: operationId("direct-message"), roomId: player.room_id, sessionToken, messageId: idFactory(), recipientPlayerId: recipient.id, content: match[2].trim(), createdAt: now() });
    },
    async endRoom(hostToken) {
      const room = await repository.findRoomByHostToken(hostToken);
      ensure(room, "Host session is not valid.");
      await repository.purgeRoomSession(room.id);
      return { roomId: room.id };
    },
    async restartSession(hostToken) {
      const room = await repository.findRoomByHostToken(hostToken);
      ensure(room, "Host session is not valid.");
      await repository.purgeRoomSession(room.id);
      return { roomId: room.id };
    },
    async postDiscussionMessage(sessionToken, content) {
      const player = await repository.findPlayerBySessionToken(sessionToken);
      ensure(player && !player.is_kicked, "Player session is not valid.");
      return repository.postDiscussionMessageAtomically({ operationId: operationId("discussion-message"), roomId: player.room_id, sessionToken, messageId: idFactory(), content: String(content || "").trim(), createdAt: now() });
    },
    async leaveRoom(sessionToken) {
      const player = await repository.findPlayerBySessionToken(sessionToken);
      ensure(player && !player.is_kicked, "Player session is not valid.");
      const result = await repository.leavePlayerAtomically({ operationId: operationId("leave-room"), roomId: player.room_id, sessionToken, createdAt: now() });
      if (!result.allVoted) return { ...result, tally: null, result: result.winner ? "finished" : "waiting" };
      const tally = await repository.resolveVoteTallyAtomically({ operationId: operationId("leave-tally"), roomId: player.room_id, createdAt: now() });
      return { ...result, tally, result: tally.result };
    },
    async uploadPack(hostToken, pack) {
      const room = await repository.findRoomByHostToken(hostToken);
      ensure(room, "Host session is not valid.");
      ensure(pack && typeof pack === "object" && Array.isArray(pack.entries), "Word pack is not valid.");
      return repository.uploadWordPackAtomically({ operationId: operationId("upload-word-pack"), roomId: room.id, hostToken, pack: { ...pack, id: pack.id || idFactory() }, createdAt: now() });
    },
    async setPackEnabled(hostToken, packId, enabled) {
      const room = await repository.findRoomByHostToken(hostToken);
      ensure(room, "Host session is not valid.");
      return repository.setWordPackEnabledAtomically({ operationId: operationId("set-word-pack-enabled"), roomId: room.id, hostToken, packId: String(packId || ""), enabled, createdAt: now() });
    },
    async deletePack(hostToken, packId) {
      const room = await repository.findRoomByHostToken(hostToken);
      ensure(room, "Host session is not valid.");
      return repository.deleteWordPackAtomically({ operationId: operationId("delete-word-pack"), roomId: room.id, hostToken, packId: String(packId || ""), createdAt: now() });
    },
    async hostControl(hostToken, action, payload = {}) {
      const room = await repository.findRoomByHostToken(hostToken); ensure(room, "Host session is not valid."); const createdAt = now();
      if (action === "abstain") { const abstention = await repository.abstainDisconnectedVoterAtomically({ operationId: operationId("abstain"), roomId: room.id, hostToken, playerId: payload.playerId, voteId: idFactory(), createdAt }); const tally = abstention.allVoted ? await repository.resolveVoteTallyAtomically({ operationId: operationId("abstain-tally"), roomId: room.id, createdAt: now() }) : null; return { ...abstention, tally, result: tally?.result || "waiting" }; }
      if (action === "editHint") return repository.editHintAtomically({ operationId: operationId("edit-hint"), roomId: room.id, hostToken, hintId: payload.hintId, content: String(payload.content || "").trim(), createdAt });
      if (action === "removeDiscussion") return repository.removeDiscussionMessageAtomically({ operationId: operationId("remove-discussion"), roomId: room.id, hostToken, messageId: payload.messageId, createdAt });
      if (action === "memorable") return repository.markMemorableClueAtomically({ operationId: operationId("memorable"), roomId: room.id, hostToken, hintId: payload.hintId, createdAt });
      if (action === "alert") return repository.createAlertAtomically({ operationId: operationId("alert"), roomId: room.id, hostToken, alertId: idFactory(), message: String(payload.message || "").trim(), targetPlayerId: payload.targetPlayerId || null, type: payload.type, createdAt });
      throw new Error("Cloud host control is not valid.");
    }
  };
}
