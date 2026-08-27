export function entryKey(value) {
  return String(value ?? "").trim();
}

export function sameWordEntryId(left, right) {
  return Boolean(entryKey(left) && entryKey(right)) && entryKey(left) === entryKey(right);
}

export function wordChoiceKey(entry) {
  const id = entryKey(typeof entry === "object" ? entry?.id : entry);
  const packId = entryKey(typeof entry === "object" ? entry?.packId : "");
  return packId && id ? `${packId}:${id}` : id;
}

export function findWordEntry(entries, selectedId) {
  const selection = entryKey(selectedId);
  return entries.find((entry) => wordChoiceKey(entry) === selection)
    || entries.find((entry) => sameWordEntryId(entry.id, selection));
}
