const safeBackPaths = {
  "player-join": { label: "Back to your name", destination: "entry" },
  "host-access": { label: "Back to sign in", destination: "entry" }
};

export function getBackNavigation(surface, { hasActiveRoom = false } = {}) {
  if (hasActiveRoom) return null;
  return safeBackPaths[surface] || null;
}
