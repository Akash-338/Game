export function restoreActiveParticipantSocketModes(sockets, roomId) {
  let restored = 0;
  for (const socket of sockets) {
    if (socket?.data?.roomId !== roomId || socket.data.isHost || !socket.data.playerId) continue;
    if (socket.data.isGhost) restored += 1;
    socket.data.isGhost = false;
  }
  return restored;
}
