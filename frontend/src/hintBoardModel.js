function playerFromHint(hint) {
  return {
    id: hint.playerId,
    userId: hint.userId || "Player",
    avatarId: hint.avatarId,
    avatarColor: hint.avatarColor,
    isConnected: hint.isConnected !== false,
    isGhost: false,
  };
}

export function buildPlayerHintCards(players = [], hints = []) {
  const roster = players.length ? players : [...new Map(
    hints.map((hint) => [hint.playerId, playerFromHint(hint)])
  ).values()];
  return roster
    .filter((player) => !player.isGhost)
    .map((player) => ({
      player,
      hints: hints
        .filter((hint) => hint.playerId === player.id)
        .slice()
        .sort((left, right) => Number(left.cycleNumber || 1) - Number(right.cycleNumber || 1) || Number(left.id || 0) - Number(right.id || 0)),
    }));
}
