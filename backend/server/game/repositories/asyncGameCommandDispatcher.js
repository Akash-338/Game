import { nanoid } from "nanoid";
import { createCloudGameService } from "../cloudGameService.js";

function requireMethod(value, label) {
  if (typeof value !== "function") throw new Error(`Async game dispatcher requires ${label}.`);
  return value;
}

export function createAsyncGameCommandDispatcher({ selectedRepository, sqliteCommands, cloudGameService = null, operationIdFactory = () => `cloud-command-${nanoid(16)}`, now = () => Date.now() }) {
  if (!selectedRepository?.repository || !selectedRepository?.kind) throw new Error("Async game dispatcher requires a selected repository.");
  const isCloud = selectedRepository.kind === "supabase";
  const cloud = selectedRepository.repository;
  const cloudService = isCloud ? (cloudGameService || createCloudGameService({ repository: cloud, now })) : null;

  return {
    kind: selectedRepository.kind,
    isCloud,
    async createRoom(payload) {
      if (isCloud) return cloudService.createRoom(payload);
      return requireMethod(sqliteCommands.createRoom, "sqliteCommands.createRoom")(payload);
    },
    async joinRoom(payload) {
      if (isCloud) return cloudService.joinRoom(payload);
      return requireMethod(sqliteCommands.joinRoom, "sqliteCommands.joinRoom")(payload);
    },
    async recoverHostRoom(payload) {
      if (isCloud) return cloudService.recoverHostRoom(payload);
      return requireMethod(sqliteCommands.recoverHostRoom, "sqliteCommands.recoverHostRoom")(payload);
    },
    async hostPlayerForSession(hostToken, sessionToken) {
      if (isCloud) return cloudService.hostPlayerForSession(hostToken, sessionToken);
      return requireMethod(sqliteCommands.hostPlayerForSession, "sqliteCommands.hostPlayerForSession")(hostToken, sessionToken);
    },
    async getRoomByCode(roomCode) {
      if (isCloud) return cloudService.getRoomByCode(roomCode);
      return requireMethod(sqliteCommands.getRoomByCode, "sqliteCommands.getRoomByCode")(roomCode);
    },
    async getRoomByHostToken(hostToken) {
      if (isCloud) return cloudService.getRoomByHostToken(hostToken);
      return requireMethod(sqliteCommands.getRoomByHostToken, "sqliteCommands.getRoomByHostToken")(hostToken);
    },
    async startRound(hostToken) {
      if (isCloud) return cloudService.startRound(hostToken);
      const room = requireMethod(sqliteCommands.startRound, "sqliteCommands.startRound")(hostToken);
      return { roomId: room.id };
    },
    async submitHint(sessionToken, content) {
      if (isCloud) return cloudService.submitHint(sessionToken, content);
      return requireMethod(sqliteCommands.submitHint, "sqliteCommands.submitHint")(sessionToken, content);
    },
    async submitVote(sessionToken, targetPlayerId = null, skipped = false) {
      if (isCloud) return cloudService.submitVote(sessionToken, targetPlayerId, skipped);
      return skipped
        ? requireMethod(sqliteCommands.submitSkipVote, "sqliteCommands.submitSkipVote")(sessionToken)
        : requireMethod(sqliteCommands.submitVote, "sqliteCommands.submitVote")(sessionToken, targetPlayerId);
    },
    async continueRound(hostToken) {
      if (isCloud) return cloudService.continueRound(hostToken);
      return { roomId: requireMethod(sqliteCommands.continueRound, "sqliteCommands.continueRound")(hostToken) };
    },
    async postDirectMessage(sessionToken, content) {
      if (isCloud) return cloudService.postDirectMessage(sessionToken, content);
      return requireMethod(sqliteCommands.postDirectMessage, "sqliteCommands.postDirectMessage")(sessionToken, content);
    },
    async endRoom(hostToken) {
      if (isCloud) return cloudService.endRoom(hostToken);
      return { roomId: requireMethod(sqliteCommands.endRoom, "sqliteCommands.endRoom")(hostToken) };
    },
    async postDiscussionMessage(sessionToken, content) {
      if (isCloud) return cloudService.postDiscussionMessage(sessionToken, content);
      return requireMethod(sqliteCommands.postDiscussionMessage, "sqliteCommands.postDiscussionMessage")(sessionToken, content);
    },
    async leaveRoom(sessionToken) {
      if (isCloud) return cloudService.leaveRoom(sessionToken);
      return requireMethod(sqliteCommands.leaveRoom, "sqliteCommands.leaveRoom")(sessionToken);
    },
    async uploadPack(hostToken, pack) {
      if (isCloud) return cloudService.uploadPack(hostToken, pack);
      return requireMethod(sqliteCommands.uploadPack, "sqliteCommands.uploadPack")(hostToken, pack);
    },
    async setPackEnabled(hostToken, packId, enabled) {
      if (isCloud) return cloudService.setPackEnabled(hostToken, packId, enabled);
      return requireMethod(sqliteCommands.setPackEnabled, "sqliteCommands.setPackEnabled")(hostToken, packId, enabled);
    },
    async deletePack(hostToken, packId) {
      if (isCloud) return cloudService.deletePack(hostToken, packId);
      return requireMethod(sqliteCommands.deletePack, "sqliteCommands.deletePack")(hostToken, packId);
    },
    async getAudienceSnapshot({ roomId, sessionToken = null, hostToken = null, peek = false, isHost = false, isGhost = false, playerId = null }) {
      if (isCloud) return cloudService.snapshot(roomId, { sessionToken, hostToken, peek, isHost, isGhost, playerId });
      return requireMethod(sqliteCommands.snapshot, "sqliteCommands.snapshot")(roomId, isHost && !playerId ? { isHost: true, peek: Boolean(peek) } : { playerId, isGhost: Boolean(isGhost) });
    },
    async setReady({ sessionToken, ready }) {
      if (!isCloud) return { roomId: requireMethod(sqliteCommands.setReady, "sqliteCommands.setReady")(sessionToken, ready) };
      const player = await cloud.findPlayerBySessionToken(sessionToken);
      if (!player || player.is_kicked) throw new Error("Player session is not valid.");
      return cloud.setReadyAtomically({ operationId: operationIdFactory(), roomId: player.room_id, sessionToken, ready: Boolean(ready), createdAt: now() });
    },
    async setPresence({ sessionToken, connected }) {
      if (!isCloud) return { roomId: requireMethod(sqliteCommands.setPresence, "sqliteCommands.setPresence")(sessionToken, connected) };
      const player = await cloud.findPlayerBySessionToken(sessionToken);
      if (!player || player.is_kicked) throw new Error("Player session is not valid.");
      return cloud.setPresenceAtomically({ operationId: operationIdFactory(), roomId: player.room_id, sessionToken, connected: Boolean(connected), createdAt: now() });
    },
    async kickPlayer({ hostToken, playerId }) {
      if (!isCloud) return requireMethod(sqliteCommands.kickPlayer, "sqliteCommands.kickPlayer")(hostToken, playerId);
      const room = await cloud.findRoomByHostToken(hostToken);
      if (!room) throw new Error("Host session is not valid.");
      return cloud.kickPlayerAtomically({ operationId: operationIdFactory(), roomId: room.id, hostToken, playerId, createdAt: now() });
    },
    async updateLobbySettings({ hostToken, changes }) {
      if (!isCloud) {
        const room = requireMethod(sqliteCommands.updateSettings, "sqliteCommands.updateSettings")(hostToken, changes);
        return { roomId: room.id };
      }
      const room = await cloud.findRoomByHostToken(hostToken);
      if (!room) throw new Error("Host session is not valid.");
      return cloud.updateLobbySettingsAtomically({ operationId: operationIdFactory(), roomId: room.id, hostToken, changes, createdAt: now() });
    },
    async reorderPlayers({ hostToken, playerIds }) {
      if (!isCloud) return { roomId: requireMethod(sqliteCommands.reorderPlayers, "sqliteCommands.reorderPlayers")(hostToken, playerIds) };
      const room = await cloud.findRoomByHostToken(hostToken);
      if (!room) throw new Error("Host session is not valid.");
      return cloud.reorderPlayersAtomically({ operationId: operationIdFactory(), roomId: room.id, hostToken, playerIds, createdAt: now() });
    },
    async nextTurn({ hostToken }) {
      if (!isCloud) {
        const event = requireMethod(sqliteCommands.nextTurn, "sqliteCommands.nextTurn")(hostToken);
        return { roomId: event.roomId, playerId: event.player.id };
      }
      const room = await cloud.findRoomByHostToken(hostToken);
      if (!room) throw new Error("Host session is not valid.");
      return cloud.nextTurnAtomically({ operationId: operationIdFactory(), roomId: room.id, hostToken, createdAt: now() });
    },
    async setDiscussionLocked({ hostToken, locked }) {
      if (!isCloud) return { roomId: requireMethod(sqliteCommands.setDiscussionLocked, "sqliteCommands.setDiscussionLocked")(hostToken, locked), locked: Boolean(locked) };
      const room = await cloud.findRoomByHostToken(hostToken);
      if (!room) throw new Error("Host session is not valid.");
      return cloud.setDiscussionLockedAtomically({ operationId: operationIdFactory(), roomId: room.id, hostToken, locked: Boolean(locked), createdAt: now() });
    },
    async revealRoles({ hostToken, eventId }) {
      if (!isCloud) return { roomId: requireMethod(sqliteCommands.revealRoles, "sqliteCommands.revealRoles")(hostToken) };
      const room = await cloud.findRoomByHostToken(hostToken);
      if (!room) throw new Error("Host session is not valid.");
      return cloud.revealRolesAtomically({ operationId: operationIdFactory(), roomId: room.id, hostToken, eventId, createdAt: now() });
    },
    async hostControl(hostToken, action, payload = {}) {
      if (isCloud) return cloudService.hostControl(hostToken, action, payload);
      if (action === "abstain") return requireMethod(sqliteCommands.abstainDisconnectedVoter, "sqliteCommands.abstainDisconnectedVoter")(hostToken, payload.playerId);
      if (action === "editHint") return { roomId: requireMethod(sqliteCommands.editHint, "sqliteCommands.editHint")(hostToken, payload.hintId, payload.content) };
      if (action === "removeDiscussion") return { roomId: requireMethod(sqliteCommands.removeDiscussionMessage, "sqliteCommands.removeDiscussionMessage")(hostToken, payload.messageId) };
      if (action === "memorable") return { roomId: requireMethod(sqliteCommands.markMemorableClue, "sqliteCommands.markMemorableClue")(hostToken, payload.hintId) };
      if (action === "alert") return requireMethod(sqliteCommands.createAlert, "sqliteCommands.createAlert")(hostToken, payload);
      throw new Error("Game host control is not valid.");
    }
  };
}
