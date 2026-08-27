import { describe, expect, test, vi } from "vitest";
import { createSupabaseGameRepository } from "../cloud/supabaseGameRepository.js";

describe("Supabase game repository", () => {
  test("fails closed when a required server credential is absent", () => {
    expect(() => createSupabaseGameRepository({ url: "https://example.supabase.co" })).toThrow("SUPABASE_SECRET_KEY");
  });

  test("maps pack seeds and transactional room creation to server-only RPC parameters", async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const repository = createSupabaseGameRepository({
      url: "https://example.supabase.co",
      secretKey: "server-only-secret",
      clientFactory: () => ({ rpc })
    });

    await repository.seedWordPack({
      id: "pack-row", packId: "animal", name: "Animal", version: 5, filePath: "server/data/categories/animal.json",
      uploadedAt: 1, isDefault: true, entries: [{ id: 1, category: "Animal", word: "Tiger", impostorHint: "Stripe" }]
    });
    await repository.createRoomAtomically({
      operationId: "operation-1",
      room: { id: "room-1", roomCode: "CLOUD1", passwordHash: "hash", hostUserId: "Akash", hostToken: "token", createdAt: 2 },
      creatorPlayer: { id: "player-1", userId: "Akash", sessionToken: "session", avatarId: "Fox", avatarColor: "#D86B4C", joinedAt: 2 },
      eventId: "event-1"
    });
    await repository.joinOrReclaimPlayerAtomically({
      operationId: "operation-2", roomId: "room-1", userId: "Maya", isGhost: false,
      player: { id: "player-2", sessionToken: "session-2", avatarId: "Owl", avatarColor: "#E9AE42", joinedAt: 3 }
    });
    await repository.purgeRoomSession("room-1");
    await repository.startRoundAtomically({
      operationId: "operation-3", roomId: "room-1", wordChoiceKey: "animal:1", impostorPlayerIds: ["player-1"], eventId: "event-2",
      round: { id: "round-1", roundNumber: 1, wordEntryId: "1", wordPackId: "animal", category: "Animal", actualWord: "Tiger", impostorHint: "Stripe", impostorCount: 1, showCategoryToImpostor: true, showHintToImpostor: false, startedAt: 4, usedWordEntryId: "used-1" }
    });
    await repository.submitHintAtomically({ operationId: "operation-4", roomId: "room-1", sessionToken: "session", hintId: "hint-1", content: "Stripe", createdAt: 5 });
    await repository.castVoteAtomically({ operationId: "operation-5", roomId: "room-1", sessionToken: "session", voteId: "vote-1", targetPlayerId: "player-2", createdAt: 6 });
    await repository.resolveVoteTallyAtomically({ operationId: "operation-6", roomId: "room-1", createdAt: 7 });
    await repository.continueRoundAtomically({ operationId: "operation-7", roomId: "room-1", createdAt: 8 });
    await repository.sendDirectMessageAtomically({ operationId: "operation-8", roomId: "room-1", sessionToken: "session", messageId: "message-1", recipientPlayerId: "player-2", content: "Private clue", createdAt: 9 });
    await repository.postDiscussionMessageAtomically({ operationId: "operation-9", roomId: "room-1", sessionToken: "session", messageId: "message-2", content: "Public discussion", createdAt: 10 });
    await repository.setReadyAtomically({ operationId: "operation-10", roomId: "room-1", sessionToken: "session", ready: true, createdAt: 11 });
    await repository.kickPlayerAtomically({ operationId: "operation-11", roomId: "room-1", hostToken: "token", playerId: "player-2", createdAt: 12 });

    expect(rpc).toHaveBeenNthCalledWith(1, "word_impostor_seed_pack", expect.objectContaining({ p_pack_id: "animal", p_entries: [{ id: 1, category: "Animal", word: "Tiger", impostorHint: "Stripe" }] }));
    expect(rpc).toHaveBeenNthCalledWith(2, "word_impostor_create_room", expect.objectContaining({ p_operation_id: "operation-1", p_room_code: "CLOUD1", p_creator_player_id: "player-1" }));
    expect(rpc).toHaveBeenNthCalledWith(3, "word_impostor_join_or_reclaim_player", expect.objectContaining({ p_operation_id: "operation-2", p_user_id: "Maya", p_new_player_id: "player-2" }));
    expect(rpc).toHaveBeenNthCalledWith(4, "word_impostor_purge_room_session", { p_room_id: "room-1" });
    expect(rpc).toHaveBeenNthCalledWith(5, "word_impostor_start_round", expect.objectContaining({ p_operation_id: "operation-3", p_word_choice_key: "animal:1", p_impostor_player_ids: ["player-1"] }));
    expect(rpc).toHaveBeenNthCalledWith(6, "word_impostor_submit_hint", expect.objectContaining({ p_operation_id: "operation-4", p_hint_id: "hint-1", p_content: "Stripe" }));
    expect(rpc).toHaveBeenNthCalledWith(7, "word_impostor_cast_vote", expect.objectContaining({ p_operation_id: "operation-5", p_vote_id: "vote-1", p_target_player_id: "player-2", p_skipped: false }));
    expect(rpc).toHaveBeenNthCalledWith(8, "word_impostor_resolve_vote_tally", { p_operation_id: "operation-6", p_room_id: "room-1", p_created_at: 7 });
    expect(rpc).toHaveBeenNthCalledWith(9, "word_impostor_continue_round", { p_operation_id: "operation-7", p_room_id: "room-1", p_created_at: 8 });
    expect(rpc).toHaveBeenNthCalledWith(10, "word_impostor_send_direct_message", expect.objectContaining({ p_operation_id: "operation-8", p_recipient_player_id: "player-2", p_content: "Private clue" }));
    expect(rpc).toHaveBeenNthCalledWith(11, "word_impostor_post_discussion_message", expect.objectContaining({ p_operation_id: "operation-9", p_message_id: "message-2", p_content: "Public discussion" }));
    expect(rpc).toHaveBeenNthCalledWith(12, "word_impostor_set_ready", expect.objectContaining({ p_operation_id: "operation-10", p_ready: true }));
    expect(rpc).toHaveBeenNthCalledWith(13, "word_impostor_kick_player", expect.objectContaining({ p_operation_id: "operation-11", p_host_token: "token", p_player_id: "player-2" }));
  });
});
