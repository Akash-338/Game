import assert from "node:assert/strict";
import { io } from "socket.io-client";

const baseUrl = process.env.GAME_URL || "http://127.0.0.1:4300";
const roomCode = `V${Date.now().toString(36).slice(-7)}`.toUpperCase();
const password = "verify-pass";
const sockets = [];

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, { transports: ["websocket"], timeout: 5000 });
    sockets.push(socket);
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function emit(socket, event, payload = {}) {
  return new Promise((resolve, reject) => socket.emit(event, payload, (response) => response?.ok ? resolve(response) : reject(new Error(response?.error || `${event} failed`))));
}

function waitFor(condition, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => condition() ? resolve() : Date.now() - started > 2500 ? reject(new Error(`Timed out waiting for ${label}`)) : setTimeout(poll, 30);
    poll();
  });
}

const views = new Map();
function track(socket, key) { socket.on("roomSnapshot", (view) => views.set(key, view)); }

try {
  const host = await connect(); track(host, "host");
  const created = await emit(host, "createRoom", { roomCode, password });
  const hostToken = created.hostToken;
  views.set("host", created.snapshot);

  const players = [];
  for (const userId of ["Asha", "Ben", "Cara"]) {
    const socket = await connect(); const key = userId.toLowerCase(); track(socket, key);
    const joined = await emit(socket, "joinRoom", { roomCode, password, userId });
    views.set(key, joined.snapshot); players.push({ socket, key, ...joined });
  }
  const ghost = await connect(); track(ghost, "ghost");
  const ghostJoin = await emit(ghost, "joinRoom", { roomCode, password, userId: "Ghost", isGhost: true });
  views.set("ghost", ghostJoin.snapshot);

  for (const player of players) await emit(player.socket, "setReady", { sessionToken: player.sessionToken, isReady: true });
  await waitFor(() => views.get("host")?.canStart, "ready-gated host start");
  await emit(host, "startRound", { hostToken });
  await waitFor(() => players.every((player) => views.get(player.key)?.round?.status === "playing"), "role delivery");

  const playerRoles = players.map((player) => views.get(player.key).ownRole.role);
  assert.equal(playerRoles.filter((role) => role === "impostor").length, 1, "exactly one impostor is assigned");
  assert.equal(views.get("ghost").roles.length, 3, "ghost can observe all role assignments");

  await emit(players[0].socket, "submitHint", { sessionToken: players[0].sessionToken, content: "It feels familiar." });
  await waitFor(() => views.get("host")?.hints?.length === 1, "host hint board update");
  await emit(host, "nextTurn", { hostToken });
  await waitFor(() => Boolean(views.get("host")?.currentTurnPlayerId), "turn update");

  await emit(host, "peekRoles", { hostToken, open: true });
  await waitFor(() => views.get("host")?.roles?.length === 3, "private host peeking");
  await emit(host, "revealRoles", { hostToken });
  await waitFor(() => views.get("host")?.room?.status === "revealed", "role reveal");

  console.log(`Realtime verification passed for room ${roomCode}.`);
} finally {
  sockets.forEach((socket) => socket.disconnect());
}
