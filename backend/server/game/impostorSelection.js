function shuffle(items, random) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

export function selectImpostorIds(players, impostorCount, recentImpostorIds = [], random = Math.random) {
  const eligible = players.filter((player) => player?.id);
  const recent = new Set(recentImpostorIds);
  const fresh = eligible.filter((player) => !recent.has(player.id));
  const selected = shuffle(fresh, random).slice(0, impostorCount);
  if (selected.length < impostorCount) {
    const remaining = eligible.filter((player) => !selected.some((choice) => choice.id === player.id));
    selected.push(...shuffle(remaining, random).slice(0, impostorCount - selected.length));
  }
  return selected.map((player) => player.id);
}
