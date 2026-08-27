import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { DatabaseSync } = await import("node:sqlite");

const here = path.dirname(fileURLToPath(import.meta.url));
export const backendRoot = path.resolve(here, "../..");
export const projectRoot = path.resolve(backendRoot, "..");
export const dataDirectory = process.env.WORD_IMPOSTOR_DATA_DIRECTORY
  ? path.resolve(process.env.WORD_IMPOSTOR_DATA_DIRECTORY)
  : path.join(backendRoot, "data");
export const wordPackDirectory = path.join(dataDirectory, "word-packs");
fs.mkdirSync(wordPackDirectory, { recursive: true });

const rawDatabase = new DatabaseSync(path.join(dataDirectory, "word-impostor.sqlite"));
rawDatabase.exec("PRAGMA journal_mode = WAL;");
rawDatabase.exec("PRAGMA foreign_keys = ON;");
const db = {
  exec: rawDatabase.exec.bind(rawDatabase),
  prepare: rawDatabase.prepare.bind(rawDatabase),
  transaction: (callback) => (...args) => {
    rawDatabase.exec("BEGIN");
    try {
      const result = callback(...args);
      rawDatabase.exec("COMMIT");
      return result;
    } catch (error) {
      rawDatabase.exec("ROLLBACK");
      throw error;
    }
  }
};
db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY, roomCode TEXT NOT NULL UNIQUE, passwordHash TEXT NOT NULL,
  hostUserId TEXT NOT NULL, hostToken TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'lobby',
  impostorCount INTEGER NOT NULL DEFAULT 1, showCategoryToImpostor INTEGER NOT NULL DEFAULT 1,
  showHintToImpostor INTEGER NOT NULL DEFAULT 1, selectedCategories TEXT NOT NULL DEFAULT '[]',
  selectedWordEntryId TEXT, currentTurnPosition INTEGER NOT NULL DEFAULT -1, soundMuted INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY, roomId TEXT NOT NULL, userId TEXT NOT NULL, sessionToken TEXT NOT NULL UNIQUE,
  avatarId TEXT NOT NULL, avatarColor TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'civilian',
  isGhost INTEGER NOT NULL DEFAULT 0, isReady INTEGER NOT NULL DEFAULT 0, isConnected INTEGER NOT NULL DEFAULT 0,
  isKicked INTEGER NOT NULL DEFAULT 0, turnPosition INTEGER NOT NULL DEFAULT 0, joinedAt INTEGER NOT NULL, leftAt INTEGER,
  UNIQUE(roomId, userId), FOREIGN KEY(roomId) REFERENCES rooms(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY, roomId TEXT NOT NULL, roundNumber INTEGER NOT NULL, wordEntryId TEXT NOT NULL,
  wordPackId TEXT NOT NULL, category TEXT NOT NULL, actualWord TEXT NOT NULL, impostorHint TEXT NOT NULL,
  impostorCount INTEGER NOT NULL, showCategoryToImpostor INTEGER NOT NULL, showHintToImpostor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'playing', startedAt INTEGER NOT NULL, revealedAt INTEGER,
  FOREIGN KEY(roomId) REFERENCES rooms(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS hints (
  id TEXT PRIMARY KEY, roundId TEXT NOT NULL, playerId TEXT NOT NULL, content TEXT NOT NULL,
  createdAt INTEGER NOT NULL, editedAt INTEGER, editedByHost INTEGER NOT NULL DEFAULT 0,
  UNIQUE(roundId, playerId), FOREIGN KEY(roundId) REFERENCES rounds(id) ON DELETE CASCADE,
  FOREIGN KEY(playerId) REFERENCES players(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS hint_entries (
  id TEXT PRIMARY KEY, roundId TEXT NOT NULL, playerId TEXT NOT NULL, cycleNumber INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL, createdAt INTEGER NOT NULL, editedAt INTEGER, editedByHost INTEGER NOT NULL DEFAULT 0,
  UNIQUE(roundId, playerId, cycleNumber), FOREIGN KEY(roundId) REFERENCES rounds(id) ON DELETE CASCADE,
  FOREIGN KEY(playerId) REFERENCES players(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS used_word_entries (
  id TEXT PRIMARY KEY, roomId TEXT NOT NULL, wordEntryId TEXT NOT NULL, roundId TEXT NOT NULL, usedAt INTEGER NOT NULL,
  UNIQUE(roomId, wordEntryId), FOREIGN KEY(roomId) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY(roundId) REFERENCES rounds(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS word_packs (
  id TEXT PRIMARY KEY, packId TEXT NOT NULL UNIQUE, name TEXT NOT NULL, version INTEGER NOT NULL,
  filePath TEXT NOT NULL, uploadedAt INTEGER NOT NULL, isDefault INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS host_alerts (
  id TEXT PRIMARY KEY, roomId TEXT NOT NULL, roundId TEXT, message TEXT NOT NULL, targetPlayerId TEXT,
  type TEXT NOT NULL, createdAt INTEGER NOT NULL, FOREIGN KEY(roomId) REFERENCES rooms(id) ON DELETE CASCADE
);`);

function hasColumn(table, column) {
  return rawDatabase.prepare(`PRAGMA table_info(${table})`).all().some((entry) => entry.name === column);
}
function addColumn(table, definition) {
  const column = definition.trim().split(/\s+/)[0];
  if (!hasColumn(table, column)) rawDatabase.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

addColumn("rooms", "gamePhase TEXT NOT NULL DEFAULT 'lobby'");
addColumn("rooms", "clueCycleLimit INTEGER NOT NULL DEFAULT 2");
addColumn("rooms", "voteNumber INTEGER NOT NULL DEFAULT 0");
addColumn("rooms", "runoffUsed INTEGER NOT NULL DEFAULT 0");
addColumn("rooms", "voteCandidates TEXT NOT NULL DEFAULT '[]'");
addColumn("rooms", "voteOpenedAt INTEGER");
addColumn("rooms", "winner TEXT");
addColumn("rooms", "discussionLocked INTEGER NOT NULL DEFAULT 0");
addColumn("rounds", "finishedAt INTEGER");
addColumn("hint_entries", "memorable INTEGER NOT NULL DEFAULT 0");

rawDatabase.exec(`
CREATE TABLE IF NOT EXISTS room_word_packs (
  roomId TEXT NOT NULL, packId TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(roomId, packId),
  FOREIGN KEY(roomId) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY(packId) REFERENCES word_packs(packId) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY, roomId TEXT NOT NULL, roundId TEXT NOT NULL, voteStage INTEGER NOT NULL,
  voterPlayerId TEXT NOT NULL, targetPlayerId TEXT, abstained INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL, UNIQUE(roundId, voteStage, voterPlayerId),
  FOREIGN KEY(roomId) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY(roundId) REFERENCES rounds(id) ON DELETE CASCADE,
  FOREIGN KEY(voterPlayerId) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY(targetPlayerId) REFERENCES players(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS game_events (
  id TEXT PRIMARY KEY, roomId TEXT NOT NULL, roundId TEXT, type TEXT NOT NULL,
  message TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}', createdAt INTEGER NOT NULL,
  FOREIGN KEY(roomId) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY(roundId) REFERENCES rounds(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS discussion_messages (
  id TEXT PRIMARY KEY, roomId TEXT NOT NULL, playerId TEXT NOT NULL, content TEXT NOT NULL,
  createdAt INTEGER NOT NULL, deletedAt INTEGER, deletedByHost INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(roomId) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY(playerId) REFERENCES players(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS direct_messages (
  id TEXT PRIMARY KEY, roomId TEXT NOT NULL, senderPlayerId TEXT NOT NULL, recipientPlayerId TEXT NOT NULL,
  content TEXT NOT NULL, createdAt INTEGER NOT NULL, deletedAt INTEGER,
  FOREIGN KEY(roomId) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY(senderPlayerId) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY(recipientPlayerId) REFERENCES players(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS player_scores (
  id TEXT PRIMARY KEY, roomId TEXT NOT NULL, playerId TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0,
  correctVotes INTEGER NOT NULL DEFAULT 0, impostorTallySurvivals INTEGER NOT NULL DEFAULT 0,
  votesReceived INTEGER NOT NULL DEFAULT 0, lastVotesReceived INTEGER NOT NULL DEFAULT 0,
  memorableClueAwards INTEGER NOT NULL DEFAULT 0, UNIQUE(roomId, playerId),
  FOREIGN KEY(roomId) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY(playerId) REFERENCES players(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS score_events (
  id TEXT PRIMARY KEY, roomId TEXT NOT NULL, roundId TEXT, playerId TEXT NOT NULL,
  delta INTEGER NOT NULL, reason TEXT NOT NULL, createdAt INTEGER NOT NULL,
  FOREIGN KEY(roomId) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY(roundId) REFERENCES rounds(id) ON DELETE SET NULL,
  FOREIGN KEY(playerId) REFERENCES players(id) ON DELETE CASCADE
);`);
addColumn("votes", "skipped INTEGER NOT NULL DEFAULT 0");
rawDatabase.exec(`
  INSERT OR IGNORE INTO hint_entries (id, roundId, playerId, cycleNumber, content, createdAt, editedAt, editedByHost)
  SELECT id, roundId, playerId, 1, content, createdAt, editedAt, editedByHost FROM hints;
`);

export function purgeRoomSession(roomId) {
  const purge = db.transaction((targetRoomId) => {
    db.prepare("DELETE FROM hints WHERE roundId IN (SELECT id FROM rounds WHERE roomId=?) OR playerId IN (SELECT id FROM players WHERE roomId=?)").run(targetRoomId, targetRoomId);
    db.prepare("DELETE FROM hint_entries WHERE roundId IN (SELECT id FROM rounds WHERE roomId=?) OR playerId IN (SELECT id FROM players WHERE roomId=?)").run(targetRoomId, targetRoomId);
    db.prepare("DELETE FROM host_alerts WHERE roomId=?").run(targetRoomId);
    db.prepare("DELETE FROM votes WHERE roomId=?").run(targetRoomId);
    db.prepare("DELETE FROM game_events WHERE roomId=?").run(targetRoomId);
    db.prepare("DELETE FROM discussion_messages WHERE roomId=?").run(targetRoomId);
    db.prepare("DELETE FROM direct_messages WHERE roomId=?").run(targetRoomId);
    db.prepare("DELETE FROM score_events WHERE roomId=?").run(targetRoomId);
    db.prepare("DELETE FROM player_scores WHERE roomId=?").run(targetRoomId);
    db.prepare("DELETE FROM room_word_packs WHERE roomId=?").run(targetRoomId);
    db.prepare("DELETE FROM used_word_entries WHERE roomId=?").run(targetRoomId);
    db.prepare("DELETE FROM rounds WHERE roomId=?").run(targetRoomId);
    db.prepare("DELETE FROM players WHERE roomId=?").run(targetRoomId);
    db.prepare("DELETE FROM rooms WHERE id=?").run(targetRoomId);
  });
  purge(roomId);
}

export function purgeUnfinishedRoomSessions() {
  const unfinishedRoomIds = db.prepare("SELECT id FROM rooms WHERE status IN ('lobby', 'playing', 'revealed')").all().map((room) => room.id);
  unfinishedRoomIds.forEach((roomId) => purgeRoomSession(roomId));
  return unfinishedRoomIds;
}

export function closeDatabase() {
  rawDatabase.close();
}

export default db;
