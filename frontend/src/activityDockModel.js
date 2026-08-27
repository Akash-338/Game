export function shouldDismissRoomActivity({ clickedInsidePanel, clickedTrigger, key, interaction, scrolledInsidePanel = false }) {
  if (key === "Escape") return true;
  if (interaction === "scroll") return !scrolledInsidePanel;
  return !clickedInsidePanel && !clickedTrigger;
}
