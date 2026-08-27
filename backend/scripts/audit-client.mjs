import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => readFileSync(path.join(projectRoot, relativePath), "utf8");

const activeSource = [
  "frontend/src/App.jsx",
  "frontend/src/components/gameShell.jsx",
  "frontend/src/views/EntryPage.jsx",
  "frontend/src/views/GameplayViews.jsx",
  "frontend/src/views/HostDashboard.jsx",
  "frontend/src/views/RoomActivityPanel.jsx"
].map(read).join("\n");

const activeStyles = [
  "frontend/src/styles.css",
  "frontend/src/accessibility.css",
  "frontend/src/role-reveal.css",
  "frontend/src/voting-discussion.css"
].map(read).join("\n");
const roomActivityPanel = read("frontend/src/views/RoomActivityPanel.jsx");

const sourceRequirements = [
  "aria-expanded={open}",
  "aria-label=\"Your current-round clue\"",
  "aria-label=\"Submit your clue\"",
  "Nudge ${player.userId}",
  "Remove ${player.userId} from the room",
  "Save host hint edit",
  "aria-label=\"Open private messages\"",
  "subscribeToConnectionStatus(socket, setConnected)"
];

const styleRequirements = [
  "@media (max-width:900px)",
  "@media (max-width:680px)",
  ".host-grid",
  ".entry-page,.host-create",
  ".hint-composer",
  ".role-vault",
  ".vote-option > .avatar",
  ".vote-option > span:not(.avatar)",
  ".live-vote-feed article > .avatar",
  "repeat(auto-fit, minmax(4.7rem, 1fr))",
  "overscroll-behavior: contain",
  ".private-message-list",
  ":focus-visible",
  "prefers-reduced-motion"
];

for (const requirement of sourceRequirements) {
  assert.ok(activeSource.includes(requirement), `Missing active UI contract: ${requirement}`);
}
for (const requirement of styleRequirements) {
  assert.ok(activeStyles.includes(requirement), `Missing responsive, motion, or focus contract: ${requirement}`);
}
assert.ok(!roomActivityPanel.includes("setOpen(true)"), "Room activity must never open itself without the top-bar trigger.");
assert.ok(!roomActivityPanel.includes("isDiscussionPinned"), "Room activity content must not force the chat view during another selected tab.");

console.log("Client accessibility and responsive-layout audit passed.");
