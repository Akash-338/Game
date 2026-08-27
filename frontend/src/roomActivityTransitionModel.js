export function shouldCloseRoomActivityOnGameTransition(previousRoom, currentRoom) {
  if (!currentRoom) return true;
  if (!previousRoom) return true;
  return previousRoom.status !== currentRoom.status || previousRoom.gamePhase !== currentRoom.gamePhase;
}
