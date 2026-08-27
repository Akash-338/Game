import { describe, expect, test } from "vitest";
import { buildCloudSnapshot } from "./cloudSnapshotModel.js";

const room = { room_code: "SAFE42", status: "playing", game_phase: "clues", winner: null, impostor_count: 1, show_category_to_impostor: true, show_hint_to_impostor: true, selected_categories: ["Animal"], selected_word_entry_id: "warm-party-classic-animal:1", current_turn_position: 0, sound_muted: false, clue_cycle_limit: 2, vote_number: 0, vote_candidates: [], discussion_locked: false };
const players = [
  { id: "civilian", user_id: "Civilian", avatar_id: "CI", avatar_color: "#111", role: "civilian", is_ghost: false, is_ready: true, is_connected: true, is_kicked: false, turn_position: 0, joined_at: 1, left_at: null, session_token: "must-not-leak" },
  { id: "impostor", user_id: "Impostor", avatar_id: "IM", avatar_color: "#222", role: "impostor", is_ghost: false, is_ready: true, is_connected: true, is_kicked: false, turn_position: 1, joined_at: 2, left_at: null, session_token: "must-not-leak" },
  { id: "ghost", user_id: "Ghost", avatar_id: "GH", avatar_color: "#333", role: "civilian", is_ghost: true, is_ready: false, is_connected: true, is_kicked: false, turn_position: 2, joined_at: 3, left_at: null, session_token: "must-not-leak" }
];
const round = { id: "round-1", round_number: 1, status: "playing", category: "Animal", actual_word: "Tiger", impostor_hint: "Stripe", show_category_to_impostor: true, show_hint_to_impostor: true, started_at: 4, revealed_at: null, finished_at: null };

describe("cloud snapshot model", () => {
  test("keeps a civilian's own word private and filters unrelated direct messages", () => {
    const snapshot = buildCloudSnapshot({ room, players, round, viewer: { playerId: "civilian", isHost: false, peek: false }, directMessages: [
      { id: "visible", sender_player_id: "civilian", recipient_player_id: "impostor", content: "hello", created_at: 5 },
      { id: "hidden", sender_player_id: "impostor", recipient_player_id: "ghost", content: "secret", created_at: 6 }
    ], events: [{ id: "event", round_id: "round-1", type: "round_started", message: "Round started", meta: { impostorPlayerIds: ["impostor"] }, created_at: 4 }] });

    expect(snapshot.ownRole).toEqual({ role: "civilian", category: "Animal", actualWord: "Tiger" });
    expect(snapshot.roles).toEqual([]);
    expect(snapshot.round).not.toHaveProperty("actualWord");
    expect(snapshot.room.selectedWordEntryId).toBeNull();
    expect(snapshot.directMessages.map((message) => message.id)).toEqual(["visible"]);
    expect(snapshot.discussionMessages).toEqual([]);
    expect(snapshot.gameLog[0].meta).toEqual({});
    expect(JSON.stringify(snapshot)).not.toContain("must-not-leak");
  });

  test("limits an impostor's role to the enabled hint/category and gives a ghost revealed roles", () => {
    const impostorView = buildCloudSnapshot({ room, players, round, viewer: { playerId: "impostor", isHost: false, peek: false } });
    const ghostView = buildCloudSnapshot({ room, players, round, viewer: { playerId: "ghost", isHost: false, peek: false } });

    expect(impostorView.ownRole).toEqual({ role: "impostor", category: "Animal", impostorHint: "Stripe" });
    expect(impostorView.roles).toEqual([]);
    expect(ghostView.ownRole).toBeNull();
    expect(ghostView.roles).toHaveLength(3);
  });

  test("exposes host-only controls only to a verified host-mode audience", () => {
    const playerSnapshot = buildCloudSnapshot({ room, players, round, viewer: { playerId: "civilian", isHost: false, peek: false }, hostData: { packs: ["not-for-player"], categories: ["Animal"], wordChoices: [{ word: "Tiger" }] } });
    const hostSnapshot = buildCloudSnapshot({ room, players, round, viewer: { isHost: true, peek: true }, hostData: { packs: [{ packId: "animal" }], categories: ["Animal"], wordChoices: [{ word: "Tiger" }] } });

    expect(playerSnapshot.packs).toEqual([]);
    expect(playerSnapshot.wordChoices).toEqual([]);
    expect(hostSnapshot.packs).toEqual([{ packId: "animal" }]);
    expect(hostSnapshot.roles).toHaveLength(3);
  });

  test("projects only public discussion content with a safe sender identity", () => {
    const snapshot = buildCloudSnapshot({ room, players, round, viewer: { playerId: "civilian", isHost: false, peek: false }, discussionMessages: [{ id: "discussion-1", player_id: "impostor", content: "That clue feels suspicious", created_at: 7 }] });

    expect(snapshot.discussionMessages).toEqual([{ id: "discussion-1", playerId: "impostor", userId: "Impostor", avatarId: "IM", avatarColor: "#222", content: "That clue feels suspicious", createdAt: 7 }]);
    expect(JSON.stringify(snapshot.discussionMessages)).not.toContain("must-not-leak");
  });
});
