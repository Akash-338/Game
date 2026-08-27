# Compact Chat UI Verification

## 2026-08-20 check

The entry screen was checked at both 1280 × 720 and 375 × 812 viewports after the compact chat redesign. The responsive header and game-entry layout rendered without visible horizontal clipping or overlap. The room activity control is intentionally not present before a user has entered a room; it appears only in room-based host, player, Ghost, and result views.

The chat panel placement and outside-dismiss behavior are covered by the focused activity dock regression. Host game-start readiness remains controlled by the existing `game.canStart` condition, independent of the chat panel.
