function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function parseTaggedDirectMessage(content, players, senderPlayerId) {
  const clean = cleanText(content);
  const match = clean.match(/^@([a-z0-9_-]{1,32})\s+(.+)$/i);
  if (!match) throw new Error("Start a private message with @player, followed by your message.");
  const recipient = players.find((player) => player.userId.toLowerCase() === match[1].toLowerCase() && !player.isGhost && !player.isKicked);
  if (!recipient) throw new Error("Choose an active player name after @.");
  if (recipient.id === senderPlayerId) throw new Error("Choose another player for a private message.");
  const message = cleanText(match[2]);
  if (!message || message.length > 180) throw new Error("Private messages must be 1–180 characters.");
  return { recipient, content: message };
}
