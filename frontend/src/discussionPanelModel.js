export function isDiscussionPinned(room) {
  return room?.status === "playing" || ["voting", "runoff"].includes(room?.gamePhase);
}
