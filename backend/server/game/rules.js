import { entryKey } from "../../shared/wordEntryId.js";

export function assertWordPack(pack) {
  if (!pack || typeof pack !== "object") throw new Error("Upload a JSON word pack object.");
  if (typeof pack.packId !== "string" || !pack.packId.trim()) throw new Error("Word pack needs a packId.");
  if (typeof pack.name !== "string" || !pack.name.trim()) throw new Error("Word pack needs a name.");
  if (!Number.isInteger(pack.version)) throw new Error("Word pack version must be a number.");
  if (!Array.isArray(pack.entries) || !pack.entries.length) throw new Error("Word pack needs at least one entry.");
  const identifiers = new Set();
  pack.entries.forEach((entry, index) => {
    if (!Number.isInteger(entry?.id) || entry.id <= 0) throw new Error(`Entry ${index + 1} needs a positive numeric id.`);
    ["category", "word", "impostorHint"].forEach((field) => {
      if (typeof entry?.[field] !== "string" || !entry[field].trim()) throw new Error(`Entry ${index + 1} needs ${field}.`);
    });
    if (identifiers.has(entry.id)) throw new Error(`Duplicate entry id: ${entry.id}.`);
    identifiers.add(entry.id);
  });
  return true;
}

export function canBeginRound(players, impostorCount) {
  const active = players.filter((player) => !player.isGhost && !player.isKicked);
  return active.length >= 3 && active.length > impostorCount && active.every((player) => player.isReady && player.isConnected);
}

export function unusedWords(entries, usedIds, selectedCategories = []) {
  const used = new Set(usedIds.map(entryKey));
  return entries.filter((entry) => !used.has(entryKey(entry.id)) && (!selectedCategories.length || selectedCategories.includes(entry.category)));
}
