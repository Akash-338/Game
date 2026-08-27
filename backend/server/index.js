import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import {
  abstainDisconnectedVoter, bootstrapPacks, chooseRandomWord, continueRound, createAlert, createRoom, deletePack, editHint, getRoomByCode, getRoomByHostToken, hostPlayerForSession,
  joinRoom, kickPlayer, leaveRoom, markMemorableClue, nextTurn, postDirectMessage, postDiscussionMessage, removeDiscussionMessage, reorderPlayers, restartSession, endRoom, recoverHostRoom, revealRoles, requireHost, setDiscussionLocked, setPackEnabled, setPresence,
  setReady, snapshot, startRound, submitHint, submitSkipVote, submitVote, updateSettings, uploadPack
} from "./game/service.js";
import { projectRoot, purgeUnfinishedRoomSessions } from "./game/db.js";
import { restoreActiveParticipantSocketModes } from "./roomParticipantMode.js";
import { getWordImpostorRuntimeConfig, getWordImpostorRuntimeSecrets } from "./runtimeConfig.js";
import { attachRedisSocketAdapter } from "./realtime/redisSocketAdapter.js";
import sqliteGameRepository from "./game/repositories/sqliteGameRepositoryRuntime.js";
import { createGameRepository } from "./game/repositories/gameRepositoryFactory.js";
import { createAsyncGameCommandDispatcher } from "./game/repositories/asyncGameCommandDispatcher.js";

const purgedUnfinishedRooms = purgeUnfinishedRoomSessions();
bootstrapPacks();
if (purgedUnfinishedRooms.length) console.log(`Purged ${purgedUnfinishedRooms.length} unfinished room session(s) from a previous server process.`);
const app = express();
const server = createServer(app);
const runtimeConfig = getWordImpostorRuntimeConfig();
const runtimeSecrets = getWordImpostorRuntimeSecrets();
const selectedGameRepository = createGameRepository({ runtimeConfig, runtimeSecrets, sqliteRepository: sqliteGameRepository });
const gameCommandDispatcher = createAsyncGameCommandDispatcher({
  selectedRepository: selectedGameRepository,
  sqliteCommands: { snapshot, setReady, setPresence, kickPlayer, updateSettings, reorderPlayers, nextTurn, setDiscussionLocked, revealRoles, startRound, submitHint, submitVote, submitSkipVote, continueRound, postDirectMessage, endRoom, postDiscussionMessage, leaveRoom, uploadPack, setPackEnabled, deletePack, abstainDisconnectedVoter, editHint, removeDiscussionMessage, markMemorableClue, createAlert }
});
const configuredOrigins = String(process.env.CORS_ORIGIN || "").split(",").map((origin) => origin.trim()).filter(Boolean);
const io = new Server(server, { cors: { origin: configuredOrigins.length ? configuredOrigins : true, credentials: false }, transports: ["websocket"] });
const redisAdapterStatus = await attachRedisSocketAdapter(io, { ...runtimeConfig, redisUrl: runtimeSecrets.redisUrl });
app.use(express.json({ limit: "2mb" }));
app.get("/api/health", (_req, res) => res.json({
  ok: true,
  runtime: {
    database: runtimeConfig.database,
    redis: runtimeConfig.redis,
    storage: runtimeConfig.storage,
    externalStoreRequested: runtimeConfig.externalStoreRequested,
    externalStoreReady: runtimeConfig.externalStoreReady,
    cloudModeEnabled: runtimeConfig.cloudModeEnabled,
    redisAdapterEnabled: runtimeConfig.redisAdapterEnabled,
    missingExternalRequirements: runtimeConfig.missingExternalRequirements
  },
  realtimeAdapter: { attached: redisAdapterStatus.attached, reason: redisAdapterStatus.reason || null }
}));

function ackError(ack, error) { if (typeof ack === "function") ack({ ok: false, error: error.message || "Something went wrong." }); }
function hostRoom(token) { return requireHost(token); }
const HOST_RECONNECT_GRACE_MS = Number(process.env.HOST_RECONNECT_GRACE_MS || 20_000);
const hostExitTimers = new Map();
function cancelHostExit(hostToken) {
  const pendingExit = hostExitTimers.get(hostToken);
  if (pendingExit) clearTimeout(pendingExit.timer);
  hostExitTimers.delete(hostToken);
  return pendingExit || null;
}
function hostWaitingState(roomId) { return [...hostExitTimers.values()].find((pendingExit) => pendingExit.roomId === roomId) || null; }
async function closeHostedRoom(hostToken, message) {
  cancelHostExit(hostToken);
  const result = await gameCommandDispatcher.endRoom(hostToken);
  const roomId = result.roomId;
  io.to(`room:${roomId}`).emit("roomEnded", { message });
  for (const candidate of io.sockets.sockets.values()) if (candidate.data.roomId === roomId) { candidate.leave(`room:${roomId}`); candidate.data = {}; }
  return roomId;
}
function emitRoom(roomId) {
  const pendingHostReturn = hostWaitingState(roomId);
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.roomId !== roomId) continue;
    const view = socket.data.isHost && socket.data.viewMode !== "player"
      ? snapshot(roomId, { isHost: true, peek: socket.data.peek })
      : snapshot(roomId, { playerId: socket.data.playerId, isGhost: socket.data.isGhost });
    socket.emit("roomSnapshot", view);
    if (pendingHostReturn && !socket.data.isHost) socket.emit("hostReconnectWaiting", { deadline: pendingHostReturn.deadline });
  }
}
async function emitCloudRoom(roomId) {
  const pendingHostReturn = hostWaitingState(roomId);
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.roomId !== roomId) continue;
    const view = socket.data.isHost && socket.data.viewMode !== "player"
      ? await gameCommandDispatcher.getAudienceSnapshot({ roomId, hostToken: socket.data.hostToken, isHost: true, peek: socket.data.peek })
      : await gameCommandDispatcher.getAudienceSnapshot({ roomId, sessionToken: socket.data.sessionToken, playerId: socket.data.playerId, isGhost: socket.data.isGhost });
    socket.emit("roomSnapshot", view);
    if (pendingHostReturn && !socket.data.isHost) socket.emit("hostReconnectWaiting", { deadline: pendingHostReturn.deadline });
  }
}
function emitAuthoritativeRoom(roomId) {
  return gameCommandDispatcher.isCloud ? emitCloudRoom(roomId) : emitRoom(roomId);
}
function bindHost(socket, hostToken, participant = null) {
  const room = hostRoom(hostToken);
  const pendingHostReturn = cancelHostExit(hostToken);
  socket.data = { roomId: room.id, isHost: true, hostToken, peek: false, viewMode: "host", playerId: participant?.id || null, sessionToken: participant?.sessionToken || null, isGhost: Boolean(participant?.isGhost) };
  socket.join(`room:${room.id}`);
  if (participant) setPresence(participant.sessionToken, true);
  if (pendingHostReturn) io.to(`room:${room.id}`).emit("hostReconnected");
  return room;
}
async function bindCloudHost(socket, hostToken, participant, room) {
  const pendingHostReturn = cancelHostExit(hostToken);
  socket.data = { roomId: room.id, isHost: true, hostToken, peek: false, viewMode: "host", playerId: participant?.id || null, sessionToken: participant?.sessionToken || null, isGhost: Boolean(participant?.isGhost) };
  socket.join(`room:${room.id}`);
  if (participant) await gameCommandDispatcher.setPresence({ sessionToken: participant.sessionToken, connected: true });
  if (pendingHostReturn) io.to(`room:${room.id}`).emit("hostReconnected");
  return room;
}
io.on("connection", (socket) => {
  socket.on("createRoom", async (payload, ack) => { try {
    if (!gameCommandDispatcher.isCloud) { const result = createRoom(payload || {}); const participant = result.sessionToken ? hostPlayerForSession(result.hostToken, result.sessionToken) : null; bindHost(socket, result.hostToken, participant); emitRoom(socket.data.roomId); ack?.({ ok: true, ...result, snapshot: snapshot(socket.data.roomId, { isHost: true }) }); return; }
    const result = await gameCommandDispatcher.createRoom(payload || {}); const participant = result.sessionToken ? await gameCommandDispatcher.hostPlayerForSession(result.hostToken, result.sessionToken) : null; const room = await gameCommandDispatcher.getRoomByHostToken(result.hostToken); await bindCloudHost(socket, result.hostToken, participant, room); await emitCloudRoom(room.id); ack?.({ ok: true, ...result, snapshot: await gameCommandDispatcher.getAudienceSnapshot({ roomId: room.id, hostToken: result.hostToken, isHost: true }) });
  } catch (error) { ackError(ack, error); } });
  socket.on("resumeHost", async ({ hostToken, sessionToken }, ack) => { try {
    if (!gameCommandDispatcher.isCloud) { const participant = sessionToken ? hostPlayerForSession(hostToken, sessionToken) : null; const room = bindHost(socket, hostToken, participant); ack?.({ ok: true, roomCode: room.roomCode, ...(participant ? { playerId: participant.id, sessionToken: participant.sessionToken, userId: participant.userId, isGhost: Boolean(participant.isGhost) } : {}), snapshot: snapshot(room.id, { isHost: true }) }); return; }
    const participant = sessionToken ? await gameCommandDispatcher.hostPlayerForSession(hostToken, sessionToken) : null; const room = await gameCommandDispatcher.getRoomByHostToken(hostToken); if (!room) throw new Error("Host session is not valid."); await bindCloudHost(socket, hostToken, participant, room); ack?.({ ok: true, roomCode: room.room_code, ...(participant ? { playerId: participant.id, sessionToken: participant.sessionToken, userId: participant.userId, isGhost: Boolean(participant.isGhost) } : {}), snapshot: await gameCommandDispatcher.getAudienceSnapshot({ roomId: room.id, hostToken, isHost: true }) });
  } catch (error) { ackError(ack, error); } });
  socket.on("recoverHost", async (payload, ack) => { try {
    if (!gameCommandDispatcher.isCloud) { const result = recoverHostRoom(payload || {}); const participant = result.sessionToken ? hostPlayerForSession(result.hostToken, result.sessionToken) : null; const room = bindHost(socket, result.hostToken, participant); emitRoom(room.id); ack?.({ ok: true, ...result, snapshot: snapshot(room.id, { isHost: true }) }); return; }
    const result = await gameCommandDispatcher.recoverHostRoom(payload || {}); const participant = result.sessionToken ? await gameCommandDispatcher.hostPlayerForSession(result.hostToken, result.sessionToken) : null; const room = await gameCommandDispatcher.getRoomByHostToken(result.hostToken); await bindCloudHost(socket, result.hostToken, participant, room); await emitCloudRoom(room.id); ack?.({ ok: true, ...result, snapshot: await gameCommandDispatcher.getAudienceSnapshot({ roomId: room.id, hostToken: result.hostToken, isHost: true }) });
  } catch (error) { ackError(ack, error); } });
  socket.on("joinRoom", async (payload, ack) => { try {
    if (!gameCommandDispatcher.isCloud) { const result = joinRoom(payload || {}); const room = getRoomByCode(result.roomCode); for (const candidate of io.sockets.sockets.values()) if (candidate.id !== socket.id && candidate.data.sessionToken === result.sessionToken) { candidate.leave(`room:${room.id}`); candidate.data = {}; } socket.data = { roomId: room.id, sessionToken: result.sessionToken, playerId: result.playerId, isGhost: result.isGhost, isHost: false }; socket.join(`room:${room.id}`); setPresence(result.sessionToken, true); emitRoom(room.id); ack?.({ ok: true, ...result, snapshot: snapshot(room.id, { playerId: result.playerId, isGhost: result.isGhost }) }); return; }
    const result = await gameCommandDispatcher.joinRoom(payload || {}); const room = await gameCommandDispatcher.getRoomByCode(result.roomCode); for (const candidate of io.sockets.sockets.values()) if (candidate.id !== socket.id && candidate.data.sessionToken === result.sessionToken) { candidate.leave(`room:${room.id}`); candidate.data = {}; } socket.data = { roomId: room.id, sessionToken: result.sessionToken, playerId: result.playerId, isGhost: result.isGhost, isHost: false }; socket.join(`room:${room.id}`); await gameCommandDispatcher.setPresence({ sessionToken: result.sessionToken, connected: true }); await emitCloudRoom(room.id); ack?.({ ok: true, ...result, snapshot: await gameCommandDispatcher.getAudienceSnapshot({ roomId: room.id, sessionToken: result.sessionToken, playerId: result.playerId, isGhost: result.isGhost }) });
  } catch (error) { ackError(ack, error); } });
  socket.on("setHostViewMode", async ({ hostToken, mode }, ack) => { try { if (!socket.data.isHost || socket.data.hostToken !== hostToken) throw new Error("Host session is not valid."); const nextMode = mode === "player" ? "player" : "host"; if (nextMode === "player" && !socket.data.playerId) throw new Error("This host room was created without a player identity."); socket.data.viewMode = nextMode; socket.data.peek = false; await emitAuthoritativeRoom(socket.data.roomId); ack?.({ ok: true, mode: nextMode }); } catch (error) { ackError(ack, error); } });
  socket.on("leaveRoom", async ({ sessionToken }, ack) => { try { if (!socket.data.sessionToken || socket.data.sessionToken !== sessionToken) throw new Error("Player session is not valid."); const event = await gameCommandDispatcher.leaveRoom(sessionToken); socket.leave(`room:${event.roomId}`); socket.data = {}; await emitAuthoritativeRoom(event.roomId); const tally = event.tally || event; if (tally.result === "runoff") io.to(`room:${event.roomId}`).emit("runoffOpened"); if (tally.result === "finished") io.to(`room:${event.roomId}`).emit("rolesRevealed"); if (["eliminated", "finished", "stalemate"].includes(tally.result)) io.to(`room:${event.roomId}`).emit("voteResolved", { result: tally.result, winner: tally.winner || null, eliminated: tally.eliminated || [] }); ack?.({ ok: true, result: tally.result }); } catch (error) { ackError(ack, error); } });
  socket.on("setReady", async ({ sessionToken, isReady }, ack) => { try { const result = await gameCommandDispatcher.setReady({ sessionToken, ready: isReady }); await emitAuthoritativeRoom(result.roomId); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("updateGameSettings", async ({ hostToken, changes }, ack) => { try { const result = await gameCommandDispatcher.updateLobbySettings({ hostToken, changes: changes || {} }); await emitAuthoritativeRoom(result.roomId); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("randomizeWord", ({ hostToken }, ack) => { try { const word = chooseRandomWord(hostToken); const room = requireHost(hostToken); emitRoom(room.id); ack?.({ ok: true, word }); } catch (error) { ackError(ack, error); } });
  socket.on("uploadWordPack", async ({ hostToken, pack }, ack) => { try { const registered = await gameCommandDispatcher.uploadPack(hostToken, pack); await emitAuthoritativeRoom(registered.roomId); ack?.({ ok: true, pack: registered }); } catch (error) { ackError(ack, error); } });
  socket.on("setWordPackEnabled", async ({ hostToken, packId, enabled }, ack) => { try { const result = await gameCommandDispatcher.setPackEnabled(hostToken, packId, enabled); await emitAuthoritativeRoom(result.roomId); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("deleteWordPack", async ({ hostToken, packId }, ack) => { try { const result = await gameCommandDispatcher.deletePack(hostToken, packId); await emitAuthoritativeRoom(result.roomId); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("reorderPlayers", async ({ hostToken, playerIds }, ack) => { try { const result = await gameCommandDispatcher.reorderPlayers({ hostToken, playerIds }); await emitAuthoritativeRoom(result.roomId); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("kickPlayer", async ({ hostToken, playerId }, ack) => { try { const kicked = await gameCommandDispatcher.kickPlayer({ hostToken, playerId }); for (const candidate of io.sockets.sockets.values()) if (candidate.data.playerId === kicked.playerId || candidate.data.sessionToken === kicked.sessionToken) candidate.emit("kicked"); await emitAuthoritativeRoom(kicked.roomId); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("startRound", async ({ hostToken }, ack) => { try { const result = await gameCommandDispatcher.startRound(hostToken); await emitAuthoritativeRoom(result.roomId); io.to(`room:${result.roomId}`).emit("roleAssigned"); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("nextTurn", async ({ hostToken }, ack) => { try { const event = await gameCommandDispatcher.nextTurn({ hostToken }); await emitAuthoritativeRoom(event.roomId); io.to(`room:${event.roomId}`).emit("turnChanged", { playerId: event.playerId }); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("submitHint", async ({ sessionToken, content }, ack) => { try { if (hostWaitingState(socket.data.roomId)) throw new Error("Waiting for the host to return before submitting a clue."); const event = await gameCommandDispatcher.submitHint(sessionToken, content); await emitAuthoritativeRoom(event.roomId); io.to(`room:${event.roomId}`).emit("hintAdded", { cycleNumber: event.cycleNumber }); if (event.voteOpened) io.to(`room:${event.roomId}`).emit("votingOpened", { voteNumber: event.voteNumber || event.vote?.voteNumber }); else if (event.nextPlayerId || event.player) io.to(`room:${event.roomId}`).emit("turnChanged", { playerId: event.nextPlayerId || event.player?.id }); ack?.({ ok: true, nextPlayerId: event.nextPlayerId || event.player?.id || null, voteOpened: Boolean(event.voteOpened) }); } catch (error) { ackError(ack, error); } });
  async function handleVote(socket, sessionToken, targetPlayerId, skipped, ack) {
    if (hostWaitingState(socket.data.roomId)) throw new Error("Waiting for the host to return before voting.");
    const event = await gameCommandDispatcher.submitVote(sessionToken, targetPlayerId, skipped);
    const tally = event.tally || event;
    await emitAuthoritativeRoom(event.roomId || tally.roomId);
    if (!event.tally) {
      ack?.({ ok: true, result: event.result || "pending" });
      return;
    }
    if (tally.result === "runoff") io.to(`room:${tally.roomId}`).emit("runoffOpened");
    if (tally.result === "finished") io.to(`room:${tally.roomId}`).emit("rolesRevealed");
    if (["eliminated", "finished", "stalemate"].includes(tally.result)) io.to(`room:${tally.roomId}`).emit("voteResolved", { result: tally.result, winner: tally.winner || null, eliminated: tally.eliminated || [] });
    ack?.({ ok: true, result: tally.result });
  }
  socket.on("submitVote", async ({ sessionToken, targetPlayerId }, ack) => { try { await handleVote(socket, sessionToken, targetPlayerId, false, ack); } catch (error) { ackError(ack, error); } });
  socket.on("submitSkipVote", async ({ sessionToken }, ack) => { try { await handleVote(socket, sessionToken, null, true, ack); } catch (error) { ackError(ack, error); } });
  socket.on("abstainDisconnectedVoter", async ({ hostToken, playerId }, ack) => { try { const event = await gameCommandDispatcher.hostControl(hostToken, "abstain", { playerId }); const tally = event.tally || event; await emitAuthoritativeRoom(event.roomId || tally.roomId); if (tally.result === "runoff") io.to(`room:${tally.roomId}`).emit("runoffOpened"); if (tally.result === "finished") io.to(`room:${tally.roomId}`).emit("rolesRevealed"); if (["eliminated", "finished", "stalemate"].includes(tally.result)) io.to(`room:${tally.roomId}`).emit("voteResolved", { result: tally.result, winner: tally.winner || null, eliminated: tally.eliminated || [] }); ack?.({ ok: true, result: tally.result || "waiting" }); } catch (error) { ackError(ack, error); } });
  socket.on("postDiscussionMessage", async ({ sessionToken, content }, ack) => { try { const event = await gameCommandDispatcher.postDiscussionMessage(sessionToken, content); await emitAuthoritativeRoom(event.roomId); ack?.({ ok: true, messageId: event.messageId || event.message?.id }); } catch (error) { ackError(ack, error); } });
  socket.on("postDirectMessage", async ({ sessionToken, content }, ack) => { try { const event = await gameCommandDispatcher.postDirectMessage(sessionToken, content); await emitAuthoritativeRoom(event.roomId); ack?.({ ok: true, messageId: event.messageId || event.message?.id }); } catch (error) { ackError(ack, error); } });
  socket.on("setDiscussionLocked", async ({ hostToken, locked }, ack) => { try { const result = await gameCommandDispatcher.setDiscussionLocked({ hostToken, locked }); await emitAuthoritativeRoom(result.roomId); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("removeDiscussionMessage", async ({ hostToken, messageId }, ack) => { try { const result = await gameCommandDispatcher.hostControl(hostToken, "removeDiscussion", { messageId }); await emitAuthoritativeRoom(result.roomId); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("markMemorableClue", async ({ hostToken, hintId }, ack) => { try { const result = await gameCommandDispatcher.hostControl(hostToken, "memorable", { hintId }); await emitAuthoritativeRoom(result.roomId); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("editHint", async ({ hostToken, hintId, content }, ack) => { try { const result = await gameCommandDispatcher.hostControl(hostToken, "editHint", { hintId, content }); await emitAuthoritativeRoom(result.roomId); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("peekRoles", async ({ hostToken, open }, ack) => { try { if (!socket.data.isHost || socket.data.hostToken !== hostToken) throw new Error("Host session is not valid."); socket.data.peek = Boolean(open); const view = gameCommandDispatcher.isCloud ? await gameCommandDispatcher.getAudienceSnapshot({ roomId: socket.data.roomId, hostToken, isHost: true, peek: Boolean(open) }) : snapshot(socket.data.roomId, { isHost: true, peek: Boolean(open) }); socket.emit("roomSnapshot", view); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("nudgePlayer", async ({ hostToken, playerId }, ack) => { try { const event = gameCommandDispatcher.isCloud ? await gameCommandDispatcher.hostControl(hostToken, "alert", { type: "nudge", message: "Your turn is waiting", targetPlayerId: playerId }) : createAlert(hostToken, { type: "nudge", message: "Your turn is waiting", targetPlayerId: playerId }); for (const candidate of io.sockets.sockets.values()) if (candidate.data.roomId === event.roomId && candidate.data.playerId === playerId) candidate.emit("nudge", event); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("sendFlashAlert", async ({ hostToken, message }, ack) => { try { const event = gameCommandDispatcher.isCloud ? await gameCommandDispatcher.hostControl(hostToken, "alert", { type: "flash", message }) : createAlert(hostToken, { type: "flash", message }); io.to(`room:${event.roomId}`).emit("flashAlert", event); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("revealRoles", async ({ hostToken }, ack) => { try { const result = await gameCommandDispatcher.revealRoles({ hostToken, eventId: `role-reveal-${Date.now()}-${socket.id}` }); await emitAuthoritativeRoom(result.roomId); io.to(`room:${result.roomId}`).emit("rolesRevealed"); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("continueRound", async ({ hostToken }, ack) => { try { const result = await gameCommandDispatcher.continueRound(hostToken); restoreActiveParticipantSocketModes(io.sockets.sockets.values(), result.roomId); await emitAuthoritativeRoom(result.roomId); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("restartSession", ({ hostToken }, ack) => { try { const roomId = restartSession(hostToken); io.to(`room:${roomId}`).emit("sessionRestarted"); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("endRoom", async ({ hostToken }, ack) => { try { await closeHostedRoom(hostToken, "The host ended this room. Thanks for playing!"); ack?.({ ok: true }); } catch (error) { ackError(ack, error); } });
  socket.on("disconnect", async () => { try {
    if (socket.data.isHost && socket.data.hostToken) {
      if (socket.data.sessionToken) await gameCommandDispatcher.setPresence({ sessionToken: socket.data.sessionToken, connected: false });
      const hostToken = socket.data.hostToken;
      const anotherHostIsConnected = [...io.sockets.sockets.values()].some((candidate) => candidate.id !== socket.id && candidate.data.isHost && candidate.data.hostToken === hostToken);
      if (!anotherHostIsConnected) {
        const roomId = socket.data.roomId;
        const deadline = Date.now() + HOST_RECONNECT_GRACE_MS;
        const timer = setTimeout(() => { closeHostedRoom(hostToken, "The host did not return, so this game has ended.").catch(() => {}); }, HOST_RECONNECT_GRACE_MS);
        hostExitTimers.set(hostToken, { timer, roomId, deadline });
        io.to(`room:${roomId}`).emit("hostReconnectWaiting", { deadline });
      }
    } else if (socket.data.sessionToken) { const result = await gameCommandDispatcher.setPresence({ sessionToken: socket.data.sessionToken, connected: false }); await emitAuthoritativeRoom(result.roomId); }
  } catch {} });
});

if (process.env.NODE_ENV === "development") {
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: "spa" });
  app.use(vite.middlewares);
} else {
  const publicDir = path.join(projectRoot, "dist", "public");
  app.use(express.static(publicDir));
  app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
}

const port = Number(process.env.PORT || 4300);
server.listen(port, () => console.log(`Server running on http://localhost:${port}/`));
