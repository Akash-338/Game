export function reconcilePlayerSessionMode(identity, players = []) {
  if (!identity || !identity.playerId) return identity;
  const authoritativePlayer = players.find((player) => player.id === identity.playerId);
  if (!authoritativePlayer) return identity;
  const isGhost = Boolean(authoritativePlayer.isGhost);
  return Boolean(identity.isGhost) === isGhost ? identity : { ...identity, isGhost };
}
