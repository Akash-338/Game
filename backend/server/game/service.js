import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { entryKey, findWordEntry, wordChoiceKey } from "../../shared/wordEntryId.js";
import { wordPackDirectory } from "./db.js";
import { loadDefaultCategoryPacks } from "./defaultPack.js";
import { parseTaggedDirectMessage } from "./directMessageModel.js";
import { selectImpostorIds } from "./impostorSelection.js";
import db from "./repositories/sqliteGameRepositoryRuntime.js";

const avatarIds = ["Fox", "Owl", "Panda", "Otter", "Rabbit", "Cat", "Koala", "Bee", "Frog", "Tiger", "Whale", "Parrot"];
const avatarColors = ["#D86B4C", "#E9AE42", "#4C8A70", "#8C5E99", "#4D769D", "#C95B6A", "#A56B48", "#5F9B94"];
const DEFAULT_OPENING_CLUE_CYCLES = 2;
const RECURRING_CLUE_CYCLES = 1;

function now() { return Date.now(); }
function publicPlayer(row) {
  return {
    id: row.id, userId: row.userId, avatarId: row.avatarId, avatarColor: row.avatarColor,
    isGhost: Boolean(row.isGhost), isReady: Boolean(row.isReady), isConnected: Boolean(row.isConnected),
    isKicked: Boolean(row.isKicked), turnPosition: row.turnPosition
  };
}
function parseList(value) { try { return JSON.parse(value || "[]"); } catch { return []; } }
function parseJson(value) { try { return JSON.parse(value || "{}"); } catch { return {}; } }
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function matchesPassword(password, stored) {
  const [salt, expected] = stored.split(":");
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
function ensure(value, message) { if (!value) throw new Error(message); }
function code(value) { return String(value || "").trim().toUpperCase(); }
function token(value) { return String(value || "").trim(); }
function normalizeHint(value) { return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase(); }

export function validatePack(pack) {
  ensure(pack && typeof pack === "object", "Upload a JSON word pack object.");
  ensure(typeof pack.packId === "string" && pack.packId.trim(), "Word pack needs a packId.");
  ensure(typeof pack.name === "string" && pack.name.trim(), "Word pack needs a name.");
  ensure(Number.isInteger(pack.version), "Word pack version must be a number.");
  ensure(Array.isArray(pack.entries) && pack.entries.length, "Word pack needs at least one entry.");
  const ids = new Set();
  pack.entries.forEach((entry, index) => {
    ensure(entry && typeof entry === "object", `Entry ${index + 1} is invalid.`);
    ensure(Number.isInteger(entry.id) && entry.id > 0, `Entry ${index + 1} needs a positive numeric id.`);
    ["category", "word", "impostorHint"].forEach((field) => ensure(typeof entry[field] === "string" && entry[field].trim(), `Entry ${index + 1} needs ${field}.`));
    ensure(!ids.has(entry.id), `Duplicate entry id: ${entry.id}.`);
    ids.add(entry.id);
  });
  return true;
}

export function registerPack(pack, { isDefault = false, filePath: providedFilePath } = {}) {
  validatePack(pack);
  const filePath = providedFilePath || path.join(wordPackDirectory, `${pack.packId}.json`);
  if (!isDefault) fs.writeFileSync(filePath, JSON.stringify(pack, null, 2));
  const existing = db.prepare("SELECT id FROM word_packs WHERE packId = ?").get(pack.packId);
  const record = { id: existing?.id || nanoid(), packId: pack.packId, name: pack.name, version: pack.version, filePath, uploadedAt: now(), isDefault: isDefault ? 1 : 0 };
  if (existing) db.prepare("UPDATE word_packs SET name=?, version=?, filePath=?, uploadedAt=?, isDefault=? WHERE packId=?").run(record.name, record.version, record.filePath, record.uploadedAt, record.isDefault, record.packId);
  else db.prepare("INSERT INTO word_packs (id, packId, name, version, filePath, uploadedAt, isDefault) VALUES (@id,@packId,@name,@version,@filePath,@uploadedAt,@isDefault)").run(record);
  return record;
}

function readRegisteredPack(filePath) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
function categoryEntryMap(categoryPacks) {
  return new Map(categoryPacks.flatMap(({ pack }) => pack.entries.map((entry) => [String(entry.id), { packId: pack.packId, wordEntryId: wordChoiceKey({ packId: pack.packId, id: entry.id }) }])));
}
function migrateLegacyCombinedPacks(categoryPacks) {
  const legacyPackIds = ["warm-party-classic", "default-word-pack"];
  const entryMap = categoryEntryMap(categoryPacks);
  const legacyRows = db.prepare(`SELECT packId FROM word_packs WHERE packId IN (${legacyPackIds.map(() => "?").join(",")})`).all(...legacyPackIds);
  legacyRows.forEach(({ packId }) => {
    db.prepare("SELECT id, wordEntryId FROM rounds WHERE wordPackId=?").all(packId).forEach((round) => {
      const mapped = entryMap.get(String(round.wordEntryId).split(":").at(-1));
      if (mapped) db.prepare("UPDATE rounds SET wordPackId=?, wordEntryId=? WHERE id=?").run(mapped.packId, mapped.wordEntryId, round.id);
    });
    db.prepare("SELECT id, wordEntryId FROM used_word_entries WHERE wordEntryId LIKE ?").all(`${packId}:%`).forEach((used) => {
      const mapped = entryMap.get(String(used.wordEntryId).split(":").at(-1));
      if (mapped) db.prepare("UPDATE used_word_entries SET wordEntryId=? WHERE id=?").run(mapped.wordEntryId, used.id);
    });
    db.prepare("SELECT id, selectedWordEntryId FROM rooms WHERE selectedWordEntryId LIKE ?").all(`${packId}:%`).forEach((room) => {
      const mapped = entryMap.get(String(room.selectedWordEntryId).split(":").at(-1));
      db.prepare("UPDATE rooms SET selectedWordEntryId=? WHERE id=?").run(mapped?.wordEntryId || null, room.id);
    });
    db.prepare("DELETE FROM room_word_packs WHERE packId=?").run(packId);
    db.prepare("DELETE FROM word_packs WHERE packId=?").run(packId);
  });
}
export function bootstrapPacks() {
  const categoryPacks = loadDefaultCategoryPacks();
  db.transaction(() => {
    categoryPacks.forEach(({ pack, filePath }) => registerPack(pack, { isDefault: true, filePath }));
    migrateLegacyCombinedPacks(categoryPacks);
  })();
}
export function listPacks(roomId = null) {
  return db.prepare("SELECT packId, name, version, isDefault, filePath FROM word_packs ORDER BY isDefault DESC, name").all().map((row) => {
    let parsed = { entries: [] }; try { parsed = readRegisteredPack(row.filePath); } catch {}
    const enabled = roomId ? Boolean(db.prepare("SELECT enabled FROM room_word_packs WHERE roomId=? AND packId=?").get(roomId, row.packId)?.enabled) : true;
    return { packId: row.packId, name: row.name, version: row.version, isDefault: Boolean(row.isDefault), enabled, entryCount: parsed.entries?.length || 0, categories: [...new Set((parsed.entries || []).map((entry) => entry.category))] };
  });
}
export function entriesForPacks(roomId = null) {
  const packRows = roomId
    ? db.prepare("SELECT w.* FROM word_packs w JOIN room_word_packs r ON r.packId=w.packId WHERE r.roomId=? AND r.enabled=1 ORDER BY w.isDefault DESC, w.name").all(roomId)
    : db.prepare("SELECT * FROM word_packs ORDER BY isDefault DESC, name").all();
  return packRows.flatMap((row) => {
    try { return readRegisteredPack(row.filePath).entries.map((entry) => ({ ...entry, packId: row.packId, packName: row.name })); }
    catch { return []; }
  });
}

export function createRoom({ roomCode, password, hostUserId = "" }) {
  const normalizedCode = code(roomCode);
  ensure(/^[A-Z0-9]{4,12}$/.test(normalizedCode), "Room ID must be 4–12 letters or numbers.");
  ensure(String(password || "").length >= 4, "Room password needs at least 4 characters.");
  if (db.prepare("SELECT id FROM rooms WHERE roomCode = ?").get(normalizedCode)) throw new Error("That Room ID already exists.");
  const creatorName = String(hostUserId || "").trim();
  ensure(!creatorName || creatorName.length <= 20, "Host display name must be 1–20 characters.");
  const record = { id: nanoid(), roomCode: normalizedCode, passwordHash: hashPassword(password), hostUserId: creatorName || "Host1234", hostToken: nanoid(32), createdAt: now(), updatedAt: now() };
  const creatorPlayer = creatorName ? { id: nanoid(), roomId: record.id, userId: creatorName, sessionToken: nanoid(32), avatarId: avatarIds[0], avatarColor: avatarColors[0], isGhost: 0, turnPosition: 0, joinedAt: now() } : null;
  const transaction = db.transaction(() => {
    db.prepare("INSERT INTO rooms (id,roomCode,passwordHash,hostUserId,hostToken,createdAt,updatedAt) VALUES (@id,@roomCode,@passwordHash,@hostUserId,@hostToken,@createdAt,@updatedAt)").run(record);
    if (creatorPlayer) db.prepare("INSERT INTO players (id,roomId,userId,sessionToken,avatarId,avatarColor,isGhost,turnPosition,joinedAt) VALUES (@id,@roomId,@userId,@sessionToken,@avatarId,@avatarColor,@isGhost,@turnPosition,@joinedAt)").run(creatorPlayer);
    db.prepare("SELECT packId FROM word_packs").all().forEach((pack) => db.prepare("INSERT INTO room_word_packs (roomId,packId,enabled) VALUES (?,?,1)").run(record.id, pack.packId));
    addEvent(record.id, null, "room_created", creatorPlayer ? `${creatorPlayer.userId} opened the table as host and player.` : "The host opened the table.");
  });
  transaction();
  return { roomCode: record.roomCode, hostToken: record.hostToken, ...(creatorPlayer ? { playerId: creatorPlayer.id, sessionToken: creatorPlayer.sessionToken, userId: creatorPlayer.userId, isGhost: false } : {}) };
}
export function recoverHostRoom({ roomCode, password }) {
  const room = getRoomByCode(roomCode);
  ensure(room, "Room was not found.");
  ensure(matchesPassword(String(password || ""), room.passwordHash), "Room password is incorrect.");
  const creator = db.prepare("SELECT * FROM players WHERE roomId=? AND userId=? AND isKicked=0").get(room.id, room.hostUserId);
  return { roomCode: room.roomCode, hostToken: room.hostToken, ...(creator ? { playerId: creator.id, sessionToken: creator.sessionToken, userId: creator.userId, isGhost: Boolean(creator.isGhost) } : {}) };
}
export function getRoomByHostToken(hostToken) { return db.prepare("SELECT * FROM rooms WHERE hostToken = ?").get(token(hostToken)); }
export function getRoomByCode(roomCode) { return db.prepare("SELECT * FROM rooms WHERE roomCode = ?").get(code(roomCode)); }
function roomById(id) { return db.prepare("SELECT * FROM rooms WHERE id = ?").get(id); }
export function requireHost(hostToken) { const room = getRoomByHostToken(hostToken); ensure(room, "Host session is not valid."); return room; }
export function hostPlayerForSession(hostToken, sessionToken) {
  const room = requireHost(hostToken);
  if (!token(sessionToken)) return null;
  const player = db.prepare("SELECT * FROM players WHERE roomId=? AND sessionToken=? AND isKicked=0").get(room.id, token(sessionToken));
  ensure(player, "Host player session is not valid.");
  return player;
}
function requirePlayer(sessionToken) { const player = db.prepare("SELECT * FROM players WHERE sessionToken = ?").get(token(sessionToken)); ensure(player && !player.isKicked, "Player session is not valid."); return player; }
export function joinRoom({ roomCode, password, userId, isGhost = false, sessionToken = "" }) {
  const room = getRoomByCode(roomCode);
  ensure(room, "Room was not found.");
  ensure(matchesPassword(String(password || ""), room.passwordHash), "Room password is incorrect.");
  const cleanUserId = String(userId || "").trim();
  ensure(cleanUserId && cleanUserId.toLowerCase() !== "host1234", "Choose a valid player User ID.");
  const existing = token(sessionToken) ? db.prepare("SELECT * FROM players WHERE roomId=? AND sessionToken=?").get(room.id, token(sessionToken)) : null;
  if (existing && !existing.isKicked) return { roomCode: room.roomCode, sessionToken: existing.sessionToken, playerId: existing.id, isGhost: Boolean(existing.isGhost) };
  const returningPlayer = db.prepare("SELECT * FROM players WHERE roomId=? AND userId=? AND isKicked=0").get(room.id, cleanUserId);
  if (returningPlayer) return { roomCode: room.roomCode, sessionToken: returningPlayer.sessionToken, playerId: returningPlayer.id, isGhost: Boolean(returningPlayer.isGhost) };
  const kickedPlayer = db.prepare("SELECT * FROM players WHERE roomId=? AND userId=? AND isKicked=1").get(room.id, cleanUserId);
  if (kickedPlayer) {
    const nextSessionToken = nanoid(32);
    db.transaction(() => {
      db.prepare("UPDATE players SET isKicked=0, isConnected=0, isReady=0, sessionToken=? WHERE id=?").run(nextSessionToken, kickedPlayer.id);
      db.prepare("UPDATE rooms SET updatedAt=? WHERE id=?").run(now(), room.id);
    })();
    return { roomCode: room.roomCode, sessionToken: nextSessionToken, playerId: kickedPlayer.id, isGhost: Boolean(kickedPlayer.isGhost) };
  }
  ensure(room.status !== "playing" || Boolean(isGhost), "This round is already in progress. Turn on ‘Join as a Ghost’ to watch without joining the active player list.");
  const count = db.prepare("SELECT COUNT(*) AS count FROM players WHERE roomId=?").get(room.id).count;
  const usedAvatarIds = new Set(db.prepare("SELECT avatarId FROM players WHERE roomId=?").all(room.id).map((player) => player.avatarId));
  const avatarChoices = avatarIds.filter((avatarId) => !usedAvatarIds.has(avatarId));
  const avatarId = (avatarChoices.length ? avatarChoices : avatarIds)[Math.floor(Math.random() * (avatarChoices.length || avatarIds.length))];
  const avatarColor = avatarColors[Math.floor(Math.random() * avatarColors.length)];
  const player = { id: nanoid(), roomId: room.id, userId: cleanUserId, sessionToken: nanoid(32), avatarId, avatarColor, isGhost: isGhost ? 1 : 0, turnPosition: count, joinedAt: now() };
  db.prepare("INSERT INTO players (id,roomId,userId,sessionToken,avatarId,avatarColor,isGhost,turnPosition,joinedAt) VALUES (@id,@roomId,@userId,@sessionToken,@avatarId,@avatarColor,@isGhost,@turnPosition,@joinedAt)").run(player);
  return { roomCode: room.roomCode, sessionToken: player.sessionToken, playerId: player.id, isGhost: Boolean(player.isGhost) };
}

function activePlayers(roomId) { return db.prepare("SELECT * FROM players WHERE roomId=? AND isGhost=0 AND isKicked=0 ORDER BY turnPosition, joinedAt").all(roomId); }
function allPlayers(roomId) { return db.prepare("SELECT * FROM players WHERE roomId=? AND isKicked=0 ORDER BY isGhost, turnPosition, joinedAt").all(roomId); }
function latestRound(roomId) { return db.prepare("SELECT * FROM rounds WHERE roomId=? ORDER BY roundNumber DESC LIMIT 1").get(roomId); }
function roundHints(roundId) { return db.prepare("SELECT h.*, p.userId, p.avatarId, p.avatarColor, p.isConnected FROM hint_entries h JOIN players p ON p.id=h.playerId WHERE h.roundId=? ORDER BY h.cycleNumber, h.createdAt").all(roundId); }
function currentHintCycle(roundId, playerCount) {
  const latest = db.prepare("SELECT MAX(cycleNumber) AS cycleNumber FROM hint_entries WHERE roundId=?").get(roundId)?.cycleNumber;
  if (!latest) return 1;
  const submitted = db.prepare("SELECT COUNT(*) AS count FROM hint_entries WHERE roundId=? AND cycleNumber=?").get(roundId, latest).count;
  return submitted >= playerCount ? Number(latest) + 1 : Number(latest);
}
function roleRows(roomId) { return allPlayers(roomId).filter((player) => !player.isKicked).map((player) => ({ playerId: player.id, userId: player.userId, avatarId: player.avatarId, avatarColor: player.avatarColor, role: player.role })); }
function recentImpostorIds(roomId) {
  const event = db.prepare("SELECT meta FROM game_events WHERE roomId=? AND type='round_started' ORDER BY createdAt DESC LIMIT 1").get(roomId);
  const ids = parseJson(event?.meta).impostorPlayerIds;
  return Array.isArray(ids) ? ids : [];
}
function voteStage(room) { return Number(room.voteNumber || 0) * 10 + (room.gamePhase === "runoff" ? 1 : 0); }
function eventRows(roomId) { return db.prepare("SELECT * FROM game_events WHERE roomId=? ORDER BY createdAt ASC LIMIT 120").all(roomId).map((entry) => ({ ...entry, meta: parseJson(entry.meta) })); }
function latestVoteResult(gameLog) {
  for (let index = gameLog.length - 1; index >= 0; index -= 1) {
    const event = gameLog[index];
    if (event.type !== "players_eliminated") continue;
    const eliminated = Array.isArray(event.meta?.eliminated) ? event.meta.eliminated : [];
    return { eliminated, createdAt: event.createdAt, message: event.message };
  }
  return null;
}
function discussionRows(roomId) { return db.prepare("SELECT d.id, d.playerId, p.userId, p.avatarId, p.avatarColor, d.content, d.createdAt FROM discussion_messages d JOIN players p ON p.id=d.playerId WHERE d.roomId=? AND d.deletedAt IS NULL ORDER BY d.createdAt ASC LIMIT 160").all(roomId); }
function directMessageRows(roomId, playerId) {
  if (!playerId) return [];
  return db.prepare(`SELECT d.id, d.senderPlayerId, d.recipientPlayerId, d.content, d.createdAt,
    sender.userId AS senderUserId, sender.avatarId AS senderAvatarId, sender.avatarColor AS senderAvatarColor,
    recipient.userId AS recipientUserId, recipient.avatarId AS recipientAvatarId, recipient.avatarColor AS recipientAvatarColor
    FROM direct_messages d
    JOIN players sender ON sender.id=d.senderPlayerId
    JOIN players recipient ON recipient.id=d.recipientPlayerId
    WHERE d.roomId=? AND d.deletedAt IS NULL AND (d.senderPlayerId=? OR d.recipientPlayerId=?)
    ORDER BY d.createdAt ASC LIMIT 160`).all(roomId, playerId, playerId);
}
function scoreRows(roomId) { return db.prepare("SELECT s.*, p.userId, p.avatarId, p.avatarColor, p.isGhost FROM player_scores s JOIN players p ON p.id=s.playerId WHERE s.roomId=? ORDER BY s.points DESC, p.userId COLLATE NOCASE").all(roomId).map((entry) => ({ ...entry, isGhost: Boolean(entry.isGhost) })); }
function scoreEventRows(roomId) { return db.prepare("SELECT e.*, p.userId, p.avatarId, p.avatarColor FROM score_events e JOIN players p ON p.id=e.playerId WHERE e.roomId=? ORDER BY e.createdAt DESC LIMIT 120").all(roomId); }
function addEvent(roomId, roundId, type, message, meta = {}) { const event = { id: nanoid(), roomId, roundId: roundId || null, type, message, meta: JSON.stringify(meta), createdAt: now() }; db.prepare("INSERT INTO game_events (id,roomId,roundId,type,message,meta,createdAt) VALUES (@id,@roomId,@roundId,@type,@message,@meta,@createdAt)").run(event); return event; }
function ensureScores(roomId) { allPlayers(roomId).forEach((player) => db.prepare("INSERT OR IGNORE INTO player_scores (id,roomId,playerId) VALUES (?,?,?)").run(nanoid(), roomId, player.id)); }
function recordScoreChange(roomId, roundId, playerId, delta, reason) {
  if (!delta) return;
  const player = db.prepare("SELECT userId FROM players WHERE id=?").get(playerId);
  db.prepare("INSERT INTO score_events (id,roomId,roundId,playerId,delta,reason,createdAt) VALUES (?,?,?,?,?,?,?)").run(nanoid(), roomId, roundId || null, playerId, delta, reason, now());
  addEvent(roomId, roundId, "score_changed", `${player?.userId || "A player"} ${delta > 0 ? `+${delta}` : delta} points — ${reason}`, { playerId, delta, reason });
}
function ballotState(room, players, viewer = {}) {
  const open = ["voting", "runoff"].includes(room.gamePhase);
  const stage = voteStage(room);
  const candidates = parseList(room.voteCandidates).map((id) => players.find((player) => player.id === id)).filter(Boolean).map(publicPlayer);
  const eligible = players.filter((player) => !player.isGhost && !player.isKicked);
  const liveVotes = open ? db.prepare("SELECT * FROM votes WHERE roomId=? AND roundId=? AND voteStage=? ORDER BY createdAt ASC").all(room.id, latestRound(room.id)?.id || "", stage).map((vote) => ({
    id: vote.id,
    voter: publicPlayer(players.find((player) => player.id === vote.voterPlayerId)),
    target: vote.targetPlayerId ? publicPlayer(players.find((player) => player.id === vote.targetPlayerId)) : null,
    abstained: Boolean(vote.abstained),
    skipped: Boolean(vote.skipped),
    createdAt: vote.createdAt
  })) : [];
  const submitted = open ? db.prepare("SELECT COUNT(*) AS count FROM votes WHERE roomId=? AND roundId=? AND voteStage=?").get(room.id, latestRound(room.id)?.id || "", stage).count : 0;
  const ownVote = viewer.playerId && open ? db.prepare("SELECT id FROM votes WHERE roomId=? AND roundId=? AND voteStage=? AND voterPlayerId=?").get(room.id, latestRound(room.id)?.id || "", stage, viewer.playerId) : null;
  return { open, phase: room.gamePhase, voteNumber: Number(room.voteNumber || 0), isRunoff: room.gamePhase === "runoff", candidates, liveVotes, submittedCount: Number(submitted), eligibleCount: eligible.length, hasSubmitted: Boolean(ownVote) };
}
export function canStart(room) { const players = activePlayers(room.id); return players.length >= 3 && players.length > room.impostorCount && players.every((player) => player.isReady && player.isConnected); }

export function snapshot(roomId, viewer = {}) {
  const room = roomById(roomId);
  if (!room) return null;
  const round = latestRound(roomId);
  const players = allPlayers(roomId);
  const active = players.filter((p) => !p.isGhost);
  const viewerPlayer = viewer.playerId ? players.find((entry) => entry.id === viewer.playerId) : null;
  const spectator = Boolean(viewer.isGhost || viewerPlayer?.isGhost);
  const revealed = room.status === "revealed" && round;
  const gameLog = eventRows(room.id);
  const result = {
    room: { roomCode: room.roomCode, status: room.status, gamePhase: room.gamePhase || "lobby", winner: room.winner || null, impostorCount: room.impostorCount, showCategoryToImpostor: Boolean(room.showCategoryToImpostor), showHintToImpostor: Boolean(room.showHintToImpostor), selectedCategories: parseList(room.selectedCategories), selectedWordEntryId: room.selectedWordEntryId, currentTurnPosition: room.currentTurnPosition, soundMuted: Boolean(room.soundMuted), clueCycleLimit: Number(room.clueCycleLimit || DEFAULT_OPENING_CLUE_CYCLES), voteNumber: Number(room.voteNumber || 0), discussionLocked: Boolean(room.discussionLocked), discussionCooldownMs: 15000 },
    players: players.map(publicPlayer),
    canStart: canStart(room),
    currentTurnPlayerId: active[room.currentTurnPosition]?.id || null,
    packs: viewer.isHost ? listPacks(room.id) : [],
    categories: viewer.isHost ? [...new Set(entriesForPacks(room.id).map((entry) => entry.category))] : [],
    wordChoices: viewer.isHost ? availableWords(room).map(({ id, category, word, packId }) => ({ id: wordChoiceKey({ id, packId }), entryId: id, category, word, packId })) : [],
    hints: round ? roundHints(round.id).map((hint) => ({ id: hint.id, playerId: hint.playerId, userId: hint.userId, avatarId: hint.avatarId, avatarColor: hint.avatarColor, isConnected: Boolean(hint.isConnected), cycleNumber: hint.cycleNumber, content: hint.content, memorable: Boolean(hint.memorable), createdAt: hint.createdAt, editedAt: hint.editedAt, editedByHost: Boolean(hint.editedByHost) })) : [],
    round: round ? { id: round.id, roundNumber: round.roundNumber, status: round.status, currentHintCycle: currentHintCycle(round.id, active.length), category: revealed ? round.category : undefined, actualWord: revealed ? round.actualWord : undefined, startedAt: round.startedAt, revealedAt: round.revealedAt, finishedAt: round.finishedAt || null } : null,
    ballot: ballotState(room, players, viewer),
    voteResult: latestVoteResult(gameLog),
    directMessages: directMessageRows(room.id, viewerPlayer?.id),
    gameLog,
    scores: scoreRows(room.id),
    scoreEvents: scoreEventRows(room.id),
    ownRole: null,
    roles: revealed || viewer.isGhost || viewer.isHost && viewer.peek ? roleRows(roomId) : []
  };
  if (viewer.playerId && round && !spectator) {
    const player = viewerPlayer;
    if (player) result.ownRole = player.role === "impostor"
      ? { role: "impostor", category: room.showCategoryToImpostor ? round.category : null, impostorHint: room.showHintToImpostor ? round.impostorHint : null }
      : { role: "civilian", category: round.category, actualWord: round.actualWord };
  }
  return result;
}

export function availableWords(room) {
  const used = new Set(db.prepare("SELECT u.wordEntryId, r.wordPackId FROM used_word_entries u JOIN rounds r ON r.id=u.roundId WHERE u.roomId=?").all(room.id).flatMap((row) => {
    const stored = entryKey(row.wordEntryId);
    return [stored, wordChoiceKey({ id: stored, packId: row.wordPackId })];
  }));
  const selected = parseList(room.selectedCategories);
  return entriesForPacks(room.id).filter((entry) => !used.has(entryKey(entry.id)) && !used.has(wordChoiceKey(entry)) && (!selected.length || selected.includes(entry.category)));
}
export function updateSettings(hostToken, changes) {
  const room = requireHost(hostToken);
  ensure(room.status !== "playing", "Change round settings before the game starts.");
  const impostorCount = Number.isInteger(changes.impostorCount) ? changes.impostorCount : room.impostorCount;
  const clueCycleLimit = Number.isInteger(changes.clueCycleLimit) ? changes.clueCycleLimit : Number(room.clueCycleLimit || DEFAULT_OPENING_CLUE_CYCLES);
  ensure(clueCycleLimit >= 1 && clueCycleLimit <= 5, "Set between 1 and 5 clue cycles before the first vote.");
  const activeCount = activePlayers(room.id).length;
  ensure(impostorCount >= 1 && impostorCount < Math.max(activeCount, 2), "Impostor count must leave at least one civilian.");
  const categories = Array.isArray(changes.selectedCategories) ? changes.selectedCategories.filter((item) => typeof item === "string") : parseList(room.selectedCategories);
  db.prepare("UPDATE rooms SET impostorCount=?, clueCycleLimit=?, showCategoryToImpostor=?, showHintToImpostor=?, selectedCategories=?, selectedWordEntryId=?, soundMuted=?, updatedAt=? WHERE id=?").run(impostorCount, clueCycleLimit, changes.showCategoryToImpostor === undefined ? room.showCategoryToImpostor : Number(Boolean(changes.showCategoryToImpostor)), changes.showHintToImpostor === undefined ? room.showHintToImpostor : Number(Boolean(changes.showHintToImpostor)), JSON.stringify(categories), changes.selectedWordEntryId === undefined ? room.selectedWordEntryId : entryKey(changes.selectedWordEntryId) || null, changes.soundMuted === undefined ? room.soundMuted : Number(Boolean(changes.soundMuted)), now(), room.id);
  return roomById(room.id);
}
export function chooseRandomWord(hostToken) {
  const room = requireHost(hostToken); const choices = availableWords(room); ensure(choices.length, "No unused words are available. Change categories or restart the session.");
  const selected = choices[Math.floor(Math.random() * choices.length)];
  db.prepare("UPDATE rooms SET selectedWordEntryId=?, updatedAt=? WHERE id=?").run(wordChoiceKey(selected), now(), room.id);
  return selected;
}
export function startRound(hostToken) {
  const room = requireHost(hostToken); ensure(room.status === "lobby", "Finish or continue the current round first."); ensure(canStart(room), "At least three connected, ready players are needed.");
  let choices = availableWords(room); ensure(choices.length, "No unused word remains for these categories.");
  const chosen = room.selectedWordEntryId ? findWordEntry(choices, room.selectedWordEntryId) : choices[Math.floor(Math.random() * choices.length)];
  ensure(chosen, "Choose an unused word from the selected categories.");
  const players = activePlayers(room.id); const impostors = selectImpostorIds(players, room.impostorCount, recentImpostorIds(room.id));
  const roundNumber = (latestRound(room.id)?.roundNumber || 0) + 1; const round = { id: nanoid(), roomId: room.id, roundNumber, wordEntryId: entryKey(chosen.id), wordPackId: chosen.packId, category: chosen.category, actualWord: chosen.word, impostorHint: chosen.impostorHint, impostorCount: room.impostorCount, showCategoryToImpostor: room.showCategoryToImpostor, showHintToImpostor: room.showHintToImpostor, startedAt: now() };
  const transaction = db.transaction(() => {
    db.prepare("INSERT INTO rounds (id,roomId,roundNumber,wordEntryId,wordPackId,category,actualWord,impostorHint,impostorCount,showCategoryToImpostor,showHintToImpostor,startedAt) VALUES (@id,@roomId,@roundNumber,@wordEntryId,@wordPackId,@category,@actualWord,@impostorHint,@impostorCount,@showCategoryToImpostor,@showHintToImpostor,@startedAt)").run(round);
    db.prepare("INSERT INTO used_word_entries (id,roomId,wordEntryId,roundId,usedAt) VALUES (?,?,?,?,?)").run(nanoid(), room.id, wordChoiceKey(chosen), round.id, now());
    db.prepare("UPDATE players SET role=? WHERE roomId=? AND isGhost=0 AND isKicked=0").run("civilian", room.id);
    impostors.forEach((id) => db.prepare("UPDATE players SET role='impostor' WHERE id=?").run(id));
    db.prepare("UPDATE rooms SET status='playing', gamePhase='clues', voteNumber=0, runoffUsed=0, voteCandidates='[]', voteOpenedAt=NULL, winner=NULL, discussionLocked=0, currentTurnPosition=0, selectedWordEntryId=NULL, updatedAt=? WHERE id=?").run(now(), room.id);
    ensureScores(room.id);
    addEvent(room.id, round.id, "round_started", `A new secret word round has started with ${players.length} active players.`, { impostorPlayerIds: impostors });
  }); transaction(); return roomById(room.id);
}
export function setReady(sessionToken, isReady) { const player = requirePlayer(sessionToken); ensure(!player.isGhost, "Ghosts do not join the ready check."); const room = roomById(player.roomId); ensure(room.status === "lobby", "Ready status is locked after the round begins."); db.prepare("UPDATE players SET isReady=? WHERE id=?").run(Number(Boolean(isReady)), player.id); return player.roomId; }
export function setPresence(sessionToken, isConnected) {
  const player = requirePlayer(sessionToken); const reconnecting = Boolean(isConnected) && !player.isConnected && Boolean(player.leftAt);
  db.prepare("UPDATE players SET isConnected=?, leftAt=? WHERE id=?").run(Number(Boolean(isConnected)), isConnected ? player.leftAt : now(), player.id);
  if (reconnecting) addEvent(player.roomId, latestRound(player.roomId)?.id, "player_reconnected", `${player.userId} is back at the table.`, { playerId: player.id });
  return player.roomId;
}
function reconcileVoluntaryDeparture(roomId) {
  const room = roomById(roomId);
  if (!room || room.status !== "playing") return { roomId, result: "left" };

  const winner = evaluateWinner(roomId);
  if (winner) {
    finishGame(roomId, winner);
    return { roomId, result: "finished", winner };
  }

  const active = activePlayers(roomId);
  const round = latestRound(roomId);
  if (room.gamePhase === "clues" && round) {
    const completedCycles = Math.max(0, currentHintCycle(round.id, active.length) - 1);
    const requiredCycles = Number(room.voteNumber || 0) === 0
      ? Number(room.clueCycleLimit || DEFAULT_OPENING_CLUE_CYCLES)
      : RECURRING_CLUE_CYCLES;
    if (completedCycles >= requiredCycles) return { ...openVoteStage(roomId), result: "voting_opened" };
    const nextTurnPosition = Math.min(Math.max(0, Number(room.currentTurnPosition || 0)), active.length - 1);
    db.prepare("UPDATE rooms SET currentTurnPosition=?, updatedAt=? WHERE id=?").run(nextTurnPosition, now(), roomId);
    return { roomId, result: "left", nextPlayer: active[nextTurnPosition] };
  }

  if (["voting", "runoff"].includes(room.gamePhase) && round) {
    const candidateIds = parseList(room.voteCandidates).filter((playerId) => active.some((player) => player.id === playerId));
    if (candidateIds.length < 2) return { roomId, result: "stalemate", nextPlayer: resumeClues(roomId, "A player left the table, so this vote has no remaining choice.") };
    db.prepare("UPDATE rooms SET voteCandidates=?, updatedAt=? WHERE id=?").run(JSON.stringify(candidateIds), now(), roomId);
    const submitted = db.prepare("SELECT COUNT(*) AS count FROM votes WHERE roomId=? AND roundId=? AND voteStage=?").get(roomId, round.id, voteStage(room)).count;
    return submitted >= active.length ? applyVoteTally(roomId) : { roomId, result: "waiting" };
  }
  return { roomId, result: "left" };
}
export function leaveRoom(sessionToken) {
  const player = requirePlayer(sessionToken);
  const room = roomById(player.roomId);
  const round = latestRound(player.roomId);
  db.transaction(() => {
    db.prepare("UPDATE players SET isKicked=1, isConnected=0, isReady=0, leftAt=? WHERE id=?").run(now(), player.id);
    if (round) db.prepare("DELETE FROM votes WHERE roomId=? AND roundId=? AND voteStage=? AND voterPlayerId=?").run(room.id, round.id, voteStage(room), player.id);
    addEvent(player.roomId, round?.id, "player_left", `${player.userId} left the table.`, { playerId: player.id });
  })();
  return { ...reconcileVoluntaryDeparture(player.roomId), playerId: player.id };
}
export function reorderPlayers(hostToken, playerIds) { const room = requireHost(hostToken); ensure(room.status === "lobby", "Turn order can only be changed in the lobby."); const active = activePlayers(room.id); ensure(Array.isArray(playerIds) && playerIds.length === active.length && new Set(playerIds).size === active.length && playerIds.every((id) => active.some((player) => player.id === id)), "Invalid player order."); const tx = db.transaction(() => playerIds.forEach((id, index) => db.prepare("UPDATE players SET turnPosition=? WHERE id=?").run(index, id))); tx(); return room.id; }
export function kickPlayer(hostToken, playerId) { const room = requireHost(hostToken); const player = db.prepare("SELECT * FROM players WHERE id=? AND roomId=?").get(playerId, room.id); ensure(player, "Player was not found."); db.prepare("UPDATE players SET isKicked=1, isConnected=0, isReady=0, leftAt=? WHERE id=?").run(now(), player.id); return { roomId: room.id, sessionToken: player.sessionToken }; }
export function nextTurn(hostToken) { const room = requireHost(hostToken); ensure(room.status === "playing" && room.gamePhase === "clues", "Turns can only be advanced during clue time."); const count = activePlayers(room.id).length; const next = (room.currentTurnPosition + 1) % count; db.prepare("UPDATE rooms SET currentTurnPosition=?, updatedAt=? WHERE id=?").run(next, now(), room.id); return { roomId: room.id, player: activePlayers(room.id)[next] }; }
function ensureRoomHintIsUnique(roomId, content, ignoredHintId = null) {
  const normalized = normalizeHint(content);
  const priorHints = db.prepare("SELECT h.id, h.content FROM hint_entries h JOIN rounds r ON r.id=h.roundId WHERE r.roomId=?").all(roomId);
  const duplicate = priorHints.some((hint) => hint.id !== ignoredHintId && normalizeHint(hint.content) === normalized);
  ensure(!duplicate, "That hint has already been used. Choose a different clue.");
}
function resumeClues(roomId, message) {
  const room = roomById(roomId); const players = activePlayers(roomId);
  ensure(players.length, "No active players remain.");
  db.prepare("UPDATE rooms SET gamePhase='clues', discussionLocked=0, currentTurnPosition=0, voteCandidates='[]', runoffUsed=0, voteOpenedAt=NULL, updatedAt=? WHERE id=?").run(now(), roomId);
  if (message) addEvent(roomId, latestRound(roomId)?.id, "clues_resumed", message);
  return players[0];
}
function finishGame(roomId, winner) {
  const room = roomById(roomId); const round = latestRound(roomId); const winnerLabel = winner === "civilians" ? "Civilians" : winner === "impostors" ? "Impostors" : "Nobody";
  const transaction = db.transaction(() => {
    if (winner !== "draw") {
      const winningRole = winner === "civilians" ? "civilian" : "impostor";
      db.prepare("SELECT id FROM players WHERE roomId=? AND role=? AND isKicked=0").all(roomId, winningRole).forEach((player) => {
        db.prepare("UPDATE player_scores SET points=points+4 WHERE roomId=? AND playerId=?").run(roomId, player.id);
        recordScoreChange(roomId, round.id, player.id, 4, `Won the game as a ${winningRole}.`);
      });
    }
    db.prepare("UPDATE rooms SET status='revealed', gamePhase='finished', winner=?, voteCandidates='[]', updatedAt=? WHERE id=?").run(winner, now(), roomId);
    db.prepare("UPDATE rounds SET status='revealed', revealedAt=?, finishedAt=? WHERE id=?").run(now(), now(), round.id);
    addEvent(roomId, round.id, "game_finished", winner === "draw" ? "The table is empty. This game ends in a draw." : `${winnerLabel} win the game.` , { winner });
  });
  transaction();
}
export function winnerForActiveCounts({ impostors = 0, civilians = 0 } = {}) {
  const impostorCount = Number(impostors); const civilianCount = Number(civilians);
  if (impostorCount + civilianCount === 0) return "draw";
  if (impostorCount === 0) return "civilians";
  if (impostorCount >= civilianCount) return "impostors";
  return null;
}
function evaluateWinner(roomId) {
  const active = activePlayers(roomId); const impostors = active.filter((player) => player.role === "impostor"); const civilians = active.filter((player) => player.role !== "impostor");
  return winnerForActiveCounts({ impostors: impostors.length, civilians: civilians.length });
}
function openVoteStage(roomId, candidateIds = null, isRunoff = false) {
  const room = roomById(roomId); const round = latestRound(roomId); const active = activePlayers(roomId);
  ensure(room.status === "playing" && round, "There is no active game to vote in.");
  const candidates = (candidateIds || active.map((player) => player.id)).filter((id) => active.some((player) => player.id === id));
  ensure(candidates.length >= 2, "There are not enough active players for a vote.");
  const nextVoteNumber = isRunoff ? Number(room.voteNumber) : Number(room.voteNumber) + 1;
  const phase = isRunoff ? "runoff" : "voting";
  db.prepare("UPDATE rooms SET gamePhase=?, voteNumber=?, runoffUsed=?, voteCandidates=?, voteOpenedAt=?, currentTurnPosition=-1, updatedAt=? WHERE id=?").run(phase, nextVoteNumber, Number(isRunoff), JSON.stringify(candidates), now(), now(), roomId);
  addEvent(roomId, round.id, isRunoff ? "runoff_opened" : "voting_opened", isRunoff ? "More than two players tied for the highest vote. A live public re-vote is open among the tied players." : `Clue cycle complete. Live public vote ${nextVoteNumber} is now open.`, { candidates });
  return { roomId, phase, voteNumber: nextVoteNumber, candidates };
}
function applyVoteTally(roomId) {
  const room = roomById(roomId); const round = latestRound(roomId); const stage = voteStage(room); const eligible = activePlayers(roomId);
  const ballots = db.prepare("SELECT * FROM votes WHERE roomId=? AND roundId=? AND voteStage=?").all(roomId, round.id, stage);
  ensure(ballots.length >= eligible.length, "Waiting for every active player's ballot.");
  const counts = new Map(); ballots.filter((ballot) => ballot.targetPlayerId).forEach((ballot) => counts.set(ballot.targetPlayerId, (counts.get(ballot.targetPlayerId) || 0) + 1));
  const countRows = [...counts.entries()].map(([playerId, count]) => ({ playerId, count }));
  const transaction = db.transaction(() => {
    db.prepare("UPDATE player_scores SET lastVotesReceived=0 WHERE roomId=?").run(roomId);
    countRows.forEach(({ playerId, count }) => db.prepare("UPDATE player_scores SET votesReceived=votesReceived+?, lastVotesReceived=? WHERE roomId=? AND playerId=?").run(count, count, roomId, playerId));
  }); transaction();
  if (!countRows.length) return { roomId, result: "stalemate", nextPlayer: resumeClues(roomId, "Every voter abstained. No player is eliminated.") };
  const maxVotes = Math.max(...countRows.map((entry) => entry.count)); const leaders = countRows.filter((entry) => entry.count === maxVotes).map((entry) => entry.playerId);
  if (leaders.length > 2 && room.gamePhase !== "runoff") return { ...openVoteStage(roomId, leaders, true), result: "runoff" };
  if (leaders.length > 2) return { roomId, result: "stalemate", nextPlayer: resumeClues(roomId, "The re-vote remained tied among more than two players. No player is eliminated.") };
  const eliminated = leaders.map((id) => eligible.find((player) => player.id === id)).filter(Boolean);
  const eliminatedById = new Map(eliminated.map((player) => [player.id, player]));
  const finalize = db.transaction(() => {
    ballots.forEach((ballot) => { const target = eliminatedById.get(ballot.targetPlayerId); const voter = eligible.find((player) => player.id === ballot.voterPlayerId); if (target?.role === "impostor" && voter?.role === "civilian") { db.prepare("UPDATE player_scores SET points=points+2, correctVotes=correctVotes+1 WHERE roomId=? AND playerId=?").run(roomId, ballot.voterPlayerId); recordScoreChange(roomId, round.id, ballot.voterPlayerId, 2, "Civilian correctly voted for an impostor."); } });
    eliminated.forEach((player) => db.prepare("UPDATE players SET isGhost=1, isReady=0 WHERE id=?").run(player.id));
    const survivingImpostors = activePlayers(roomId).filter((player) => player.role === "impostor");
    survivingImpostors.forEach((player) => { db.prepare("UPDATE player_scores SET points=points+1, impostorTallySurvivals=impostorTallySurvivals+1 WHERE roomId=? AND playerId=?").run(roomId, player.id); recordScoreChange(roomId, round.id, player.id, 1, "Impostor survived a completed vote tally."); });
    const publicEliminated = eliminated.map((player) => ({ playerId: player.id, userId: player.userId, role: player.role }));
    const summary = publicEliminated.map((player) => `${player.userId} was ${player.role === "impostor" ? "an impostor" : "a civilian"}.`).join(" ");
    addEvent(roomId, round.id, "players_eliminated", `${summary} They are now Ghosts.`, { playerIds: eliminated.map((player) => player.id), eliminated: publicEliminated, tally: countRows });
  }); finalize();
  const winner = evaluateWinner(roomId);
  const publicEliminated = eliminated.map((player) => ({ playerId: player.id, userId: player.userId, role: player.role }));
  if (winner) { finishGame(roomId, winner); return { roomId, result: "finished", winner, eliminated: publicEliminated }; }
  return { roomId, result: "eliminated", eliminated: publicEliminated, nextPlayer: resumeClues(roomId, "The next clue cycle begins now.") };
}
export function submitHint(sessionToken, content) {
  const player = requirePlayer(sessionToken); ensure(!player.isGhost, "Ghosts cannot submit hints.");
  const room = roomById(player.roomId); const round = latestRound(room.id); ensure(room.status === "playing" && room.gamePhase === "clues" && round, "Hints are not available while voting or after the game ends.");
  const players = activePlayers(room.id); const current = players[room.currentTurnPosition]; ensure(current?.id === player.id, "Wait for your turn before submitting a hint.");
  const clean = String(content || "").trim().replace(/\s+/g, " "); ensure(clean && clean.length <= 80, "Hints must be 1–80 characters.");
  ensureRoomHintIsUnique(room.id, clean);
  const cycleNumber = currentHintCycle(round.id, players.length);
  ensure(!db.prepare("SELECT id FROM hint_entries WHERE roundId=? AND playerId=? AND cycleNumber=?").get(round.id, player.id, cycleNumber), "You have already submitted in this hint round.");
  db.transaction(() => {
    db.prepare("INSERT INTO hint_entries (id,roundId,playerId,cycleNumber,content,createdAt) VALUES (?,?,?,?,?,?)").run(nanoid(), round.id, player.id, cycleNumber, clean, now());
    db.prepare("UPDATE rooms SET currentTurnPosition=?, updatedAt=? WHERE id=?").run((room.currentTurnPosition + 1) % players.length, now(), room.id);
  })();
  const submittedCount = db.prepare("SELECT COUNT(*) AS count FROM hint_entries WHERE roundId=? AND cycleNumber=?").get(round.id, cycleNumber).count;
  const requiredCycles = Number(room.voteNumber || 0) === 0
    ? Number(room.clueCycleLimit || DEFAULT_OPENING_CLUE_CYCLES)
    : RECURRING_CLUE_CYCLES;
  if (submittedCount >= players.length && cycleNumber >= requiredCycles) {
    const vote = openVoteStage(room.id);
    return { roomId: room.id, player: null, cycleNumber, voteOpened: true, vote };
  }
  if (submittedCount >= players.length) addEvent(room.id, round.id, "clue_cycle_complete", `Clue cycle ${cycleNumber} is complete.`);
  return { roomId: room.id, player: players[(room.currentTurnPosition + 1) % players.length], cycleNumber, voteOpened: false };
}
export function submitVote(sessionToken, targetPlayerId) {
  const voter = requirePlayer(sessionToken); ensure(!voter.isGhost, "Ghosts cannot vote."); const room = roomById(voter.roomId); const round = latestRound(room.id);
  ensure(["voting", "runoff"].includes(room.gamePhase) && room.status === "playing" && round, "There is no open vote.");
  const eligible = activePlayers(room.id); ensure(eligible.some((player) => player.id === voter.id), "Only active players can vote.");
  const candidates = parseList(room.voteCandidates); const target = String(targetPlayerId || "");
  ensure(target && candidates.includes(target), "Choose one of the current vote candidates."); ensure(target !== voter.id, "You cannot vote for yourself.");
  const stage = voteStage(room); ensure(!db.prepare("SELECT id FROM votes WHERE roomId=? AND roundId=? AND voteStage=? AND voterPlayerId=?").get(room.id, round.id, stage, voter.id), "Your vote is already locked.");
  db.prepare("INSERT INTO votes (id,roomId,roundId,voteStage,voterPlayerId,targetPlayerId,abstained,createdAt) VALUES (?,?,?,?,?,?,0,?)").run(nanoid(), room.id, round.id, stage, voter.id, target, now());
  const selected = eligible.find((player) => player.id === target);
  addEvent(room.id, round.id, "live_vote_cast", `${voter.userId} voted for ${selected.userId}.`, { voterPlayerId: voter.id, targetPlayerId: selected.id, voteStage: stage });
  const submitted = db.prepare("SELECT COUNT(*) AS count FROM votes WHERE roomId=? AND roundId=? AND voteStage=?").get(room.id, round.id, stage).count;
  return submitted >= eligible.length ? applyVoteTally(room.id) : { roomId: room.id, result: "waiting" };
}
export function submitSkipVote(sessionToken) {
  const voter = requirePlayer(sessionToken); ensure(!voter.isGhost, "Ghosts cannot vote."); const room = roomById(voter.roomId); const round = latestRound(room.id);
  ensure(["voting", "runoff"].includes(room.gamePhase) && room.status === "playing" && round, "There is no open vote.");
  const eligible = activePlayers(room.id); ensure(eligible.some((player) => player.id === voter.id), "Only active players can vote.");
  const stage = voteStage(room); ensure(!db.prepare("SELECT id FROM votes WHERE roomId=? AND roundId=? AND voteStage=? AND voterPlayerId=?").get(room.id, round.id, stage, voter.id), "Your vote is already locked.");
  db.prepare("INSERT INTO votes (id,roomId,roundId,voteStage,voterPlayerId,targetPlayerId,abstained,skipped,createdAt) VALUES (?,?,?,?,?,NULL,0,1,?)").run(nanoid(), room.id, round.id, stage, voter.id, now());
  addEvent(room.id, round.id, "live_vote_skipped", `${voter.userId} skipped this vote.`, { voterPlayerId: voter.id, voteStage: stage });
  const submitted = db.prepare("SELECT COUNT(*) AS count FROM votes WHERE roomId=? AND roundId=? AND voteStage=?").get(room.id, round.id, stage).count;
  return submitted >= eligible.length ? applyVoteTally(room.id) : { roomId: room.id, result: "waiting" };
}
export function abstainDisconnectedVoter(hostToken, playerId) {
  const room = requireHost(hostToken); const round = latestRound(room.id); ensure(["voting", "runoff"].includes(room.gamePhase) && round, "There is no open vote.");
  const voter = activePlayers(room.id).find((player) => player.id === playerId); ensure(voter && !voter.isConnected, "Only an offline active player can be marked absent."); const stage = voteStage(room);
  ensure(!db.prepare("SELECT id FROM votes WHERE roomId=? AND roundId=? AND voteStage=? AND voterPlayerId=?").get(room.id, round.id, stage, voter.id), "That player's ballot is already recorded.");
  db.prepare("INSERT INTO votes (id,roomId,roundId,voteStage,voterPlayerId,targetPlayerId,abstained,createdAt) VALUES (?,?,?,?,?,NULL,1,?)").run(nanoid(), room.id, round.id, stage, voter.id, now());
  addEvent(room.id, round.id, "abstention_recorded", `${voter.userId} is offline and has been recorded as absent from this vote.`);
  const submitted = db.prepare("SELECT COUNT(*) AS count FROM votes WHERE roomId=? AND roundId=? AND voteStage=?").get(room.id, round.id, stage).count;
  return submitted >= activePlayers(room.id).length ? applyVoteTally(room.id) : { roomId: room.id, result: "waiting" };
}
export function editHint(hostToken, hintId, content) { const room = requireHost(hostToken); const hint = db.prepare("SELECT h.* FROM hint_entries h JOIN rounds r ON r.id=h.roundId WHERE h.id=? AND r.roomId=?").get(hintId, room.id); ensure(hint, "Hint was not found."); const clean = String(content || "").trim().replace(/\s+/g, " "); ensure(clean && clean.length <= 80, "Hints must be 1–80 characters."); ensureRoomHintIsUnique(room.id, clean, hintId); db.prepare("UPDATE hint_entries SET content=?, editedAt=?, editedByHost=1 WHERE id=?").run(clean, now(), hintId); return room.id; }
export function revealRoles(hostToken) { const room = requireHost(hostToken); ensure(room.status === "playing", "There is no active round to reveal."); const round = latestRound(room.id); db.transaction(() => { db.prepare("UPDATE rooms SET status='revealed', gamePhase='finished', winner='manual', voteCandidates='[]', updatedAt=? WHERE id=?").run(now(), room.id); db.prepare("UPDATE rounds SET status='revealed', revealedAt=?, finishedAt=? WHERE id=?").run(now(), now(), round.id); addEvent(room.id, round.id, "roles_revealed", "The host revealed the roles and word."); })(); return room.id; }
export function continueRound(hostToken) { const room = requireHost(hostToken); ensure(room.status === "revealed", "Reveal the round before continuing."); const tx = db.transaction(() => { db.prepare("UPDATE rooms SET status='lobby', gamePhase='lobby', winner=NULL, voteNumber=0, runoffUsed=0, voteCandidates='[]', voteOpenedAt=NULL, currentTurnPosition=-1, selectedWordEntryId=NULL, updatedAt=? WHERE id=?").run(now(), room.id); db.prepare("UPDATE players SET isGhost=0, isReady=0, role='civilian' WHERE roomId=? AND isKicked=0").run(room.id); db.prepare("DELETE FROM used_word_entries WHERE roomId=?").run(room.id); addEvent(room.id, null, "next_round_ready", "All non-kicked players are back at the table. Scores carry forward; the word pool has reset for the new round."); }); tx(); return room.id; }
export function restartSession(hostToken) { const room = requireHost(hostToken); db.purgeRoomSession(room.id); return room.id; }
export function endRoom(hostToken) { const room = requireHost(hostToken); db.purgeRoomSession(room.id); return room.id; }
export function createAlert(hostToken, { message, targetPlayerId = null, type = "flash" }) { const room = requireHost(hostToken); const clean = String(message || "").trim(); ensure(clean && clean.length <= 90, "Alert must be 1–90 characters."); const round = latestRound(room.id); db.prepare("INSERT INTO host_alerts (id,roomId,roundId,message,targetPlayerId,type,createdAt) VALUES (?,?,?,?,?,?,?)").run(nanoid(), room.id, round?.id || null, clean, targetPlayerId, type, now()); return { roomId: room.id, message: clean, targetPlayerId, type }; }
export function postDiscussionMessage(sessionToken, content) {
  const player = requirePlayer(sessionToken); ensure(!player.isGhost, "Ghosts can read the discussion but cannot send messages."); const room = roomById(player.roomId); const clean = String(content || "").trim().replace(/\s+/g, " ");
  ensure(!room.discussionLocked, "The host has locked discussion for this voting period.");
  ensure(clean && clean.length <= 180, "Discussion messages must be 1–180 characters.");
  const previous = db.prepare("SELECT createdAt FROM discussion_messages WHERE roomId=? AND playerId=? ORDER BY createdAt DESC LIMIT 1").get(room.id, player.id);
  ensure(!previous || now() - previous.createdAt >= 15000, "Please wait 15 seconds before sending another discussion message.");
  const message = { id: nanoid(), roomId: room.id, playerId: player.id, content: clean, createdAt: now() }; db.prepare("INSERT INTO discussion_messages (id,roomId,playerId,content,createdAt) VALUES (@id,@roomId,@playerId,@content,@createdAt)").run(message); return { roomId: room.id, message };
}
export function postDirectMessage(sessionToken, content) {
  const sender = requirePlayer(sessionToken);
  ensure(!sender.isGhost && !sender.isKicked, "Ghosts cannot send private messages.");
  const room = roomById(sender.roomId);
  const parsed = parseTaggedDirectMessage(content, allPlayers(room.id), sender.id);
  const previous = db.prepare("SELECT createdAt FROM direct_messages WHERE roomId=? AND senderPlayerId=? ORDER BY createdAt DESC LIMIT 1").get(room.id, sender.id);
  ensure(!previous || now() - previous.createdAt >= 3000, "Please wait 3 seconds before sending another private message.");
  const message = { id: nanoid(), roomId: room.id, senderPlayerId: sender.id, recipientPlayerId: parsed.recipient.id, content: parsed.content, createdAt: now() };
  db.prepare("INSERT INTO direct_messages (id,roomId,senderPlayerId,recipientPlayerId,content,createdAt) VALUES (@id,@roomId,@senderPlayerId,@recipientPlayerId,@content,@createdAt)").run(message);
  return { roomId: room.id, message };
}
export function setDiscussionLocked(hostToken, locked) { const room = requireHost(hostToken); ensure(room.status === "playing" && ["voting", "runoff"].includes(room.gamePhase), "Discussion can be locked only while a vote is open."); const next = Number(Boolean(locked)); db.prepare("UPDATE rooms SET discussionLocked=?, updatedAt=? WHERE id=?").run(next, now(), room.id); addEvent(room.id, latestRound(room.id)?.id, next ? "discussion_locked" : "discussion_unlocked", next ? "The host locked discussion for voting." : "The host reopened discussion."); return room.id; }
export function removeDiscussionMessage(hostToken, messageId) { const room = requireHost(hostToken); const message = db.prepare("SELECT * FROM discussion_messages WHERE id=? AND roomId=? AND deletedAt IS NULL").get(messageId, room.id); ensure(message, "Discussion message was not found."); db.prepare("UPDATE discussion_messages SET deletedAt=?, deletedByHost=1 WHERE id=?").run(now(), message.id); addEvent(room.id, latestRound(room.id)?.id, "discussion_removed", "The host removed a discussion message."); return room.id; }
export function markMemorableClue(hostToken, hintId) { const room = requireHost(hostToken); ensure(room.status === "revealed", "Memorable clues are selected during the recap."); const hint = db.prepare("SELECT h.* FROM hint_entries h JOIN rounds r ON r.id=h.roundId WHERE h.id=? AND r.roomId=?").get(hintId, room.id); ensure(hint, "Clue was not found."); const next = hint.memorable ? 0 : 1; db.transaction(() => { db.prepare("UPDATE hint_entries SET memorable=? WHERE id=?").run(next, hint.id); db.prepare("UPDATE player_scores SET points=points+?, memorableClueAwards=memorableClueAwards+? WHERE roomId=? AND playerId=?").run(next ? 1 : -1, next ? 1 : -1, room.id, hint.playerId); recordScoreChange(room.id, hint.roundId, hint.playerId, next ? 1 : -1, next ? "Host awarded a memorable clue." : "Host removed the memorable-clue award."); })(); return room.id; }
export function setPackEnabled(hostToken, packId, enabled) { const room = requireHost(hostToken); ensure(room.status === "lobby", "Change enabled word packs before the round begins."); const pack = db.prepare("SELECT * FROM word_packs WHERE packId=?").get(String(packId || "")); ensure(pack, "Word pack was not found."); db.prepare("INSERT INTO room_word_packs (roomId,packId,enabled) VALUES (?,?,?) ON CONFLICT(roomId,packId) DO UPDATE SET enabled=excluded.enabled").run(room.id, pack.packId, Number(Boolean(enabled))); return room.id; }
export function deletePack(hostToken, packId) { const room = requireHost(hostToken); const pack = db.prepare("SELECT * FROM word_packs WHERE packId=?").get(String(packId || "")); ensure(pack && !pack.isDefault, "The default word pack cannot be deleted."); const inUse = db.prepare("SELECT 1 FROM rounds r JOIN rooms rm ON rm.id=r.roomId WHERE r.wordPackId=? AND rm.status='playing' LIMIT 1").get(pack.packId); ensure(!inUse, "This word pack is currently used by an active room."); if (fs.existsSync(pack.filePath)) fs.rmSync(pack.filePath, { force: true }); db.prepare("DELETE FROM word_packs WHERE packId=?").run(pack.packId); return room.id; }
export function uploadPack(hostToken, pack) { const room = requireHost(hostToken); const registered = registerPack(pack); db.prepare("INSERT INTO room_word_packs (roomId,packId,enabled) VALUES (?,?,1) ON CONFLICT(roomId,packId) DO UPDATE SET enabled=1").run(room.id, registered.packId); return registered; }
