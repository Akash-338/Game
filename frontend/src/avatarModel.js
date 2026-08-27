export function getAvatarInitials(userId) {
  const normalized = String(userId ?? "").trim();
  return (normalized.slice(0, 2) || "?").toUpperCase();
}
