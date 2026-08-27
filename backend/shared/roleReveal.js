export function getRoleRevealState(role, open) {
  if (!role) return null;

  const isImposter = role.role === "impostor";
  const subject = isImposter ? "role" : "secret word";

  if (!open) {
    return {
      isImposter,
      mode: "sealed",
      label: isImposter ? "Private role" : "Private word",
      message: `Your ${subject} is sealed from view.`,
      action: "Tap to unlock",
    };
  }

  return {
    isImposter,
    mode: "revealed",
    label: isImposter ? "You are the" : "Your secret word",
    title: isImposter ? "Impostor" : role.actualWord,
    detail: isImposter
      ? role.category
        ? `Category: ${role.category}`
        : role.impostorHint || "Blend in. Listen carefully."
      : role.category || "Keep the word between us.",
    action: "Tap to hide",
  };
}
