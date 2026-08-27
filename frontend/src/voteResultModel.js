export function formatPublicVoteResult({ eliminated = [], winner = null } = {}) {
  const revealed = eliminated
    .filter((player) => player?.userId && player?.role)
    .map((player) => `${player.userId} was ${player.role === "impostor" ? "an impostor" : "a civilian"}.`);
  const outcome = winner === "civilians"
    ? " Civilians win the game."
    : winner === "impostors"
      ? " Impostors win the game."
      : winner === "draw"
        ? " The game ends in a draw."
        : revealed.length ? " They are now Ghosts." : "";
  return `${revealed.join(" ")}${outcome}`.trim();
}
