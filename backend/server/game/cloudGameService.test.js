import { describe, expect, test, vi } from "vitest";
import { createCloudGameService } from "./cloudGameService.js";

function buildRepository(overrides = {}) {
  return {
    createRoomAtomically: vi.fn().mockImplementation(({ room }) => Promise.resolve({ roomCode: room.roomCode, hostToken: room.hostToken })),
    findRoomByCode: vi.fn().mockResolvedValue({ id: "room-1", room_code: "TABLE1", password_hash: "", host_user_id: "Maya", host_token: "host-1", status: "lobby" }),
    findRoomByHostToken: vi.fn().mockResolvedValue({ id: "room-1", host_token: "host-1" }),
    findPlayerForRecovery: vi.fn().mockResolvedValue({ id: "player-1", user_id: "Maya", session_token: "creator-session", is_ghost: false, is_kicked: false }),
    findPlayerBySessionToken: vi.fn().mockResolvedValue({ id: "player-1", room_id: "room-1", user_id: "Maya", session_token: "creator-session", is_ghost: false, is_kicked: false }),
    findWordPackEntryByChoice: vi.fn().mockResolvedValue({ pack_id: "animal", entry_id: 1, category: "Animal", word: "Tiger", impostor_hint: "Stripes" }),
    getAudienceSnapshot: vi.fn().mockResolvedValue({ players: [{ avatarId: "Fox" }] }),
    joinOrReclaimPlayerAtomically: vi.fn().mockResolvedValue({ roomCode: "TABLE1", sessionToken: "joined-session", playerId: "player-2", isGhost: false }),
    startRoundAtomically: vi.fn().mockResolvedValue({ roomId: "room-1", roundId: "round-1" }),
    submitHintAtomically: vi.fn().mockResolvedValue({ roomId: "room-1", voteOpened: false }),
    castVoteAtomically: vi.fn().mockResolvedValue({ roomId: "room-1", allVoted: true }),
    resolveVoteTallyAtomically: vi.fn().mockResolvedValue({ roomId: "room-1", result: "revealed" }),
    continueRoundAtomically: vi.fn().mockResolvedValue({ roomId: "room-1", status: "lobby" }),
    sendDirectMessageAtomically: vi.fn().mockResolvedValue({ roomId: "room-1", messageId: "message-1" }),
    purgeRoomSession: vi.fn().mockResolvedValue({ roomId: "room-1", purged: true }),
    postDiscussionMessageAtomically: vi.fn().mockResolvedValue({ roomId: "room-1", messageId: "discussion-1" }),
    leavePlayerAtomically: vi.fn().mockResolvedValue({ roomId: "room-1", playerId: "player-1", allVoted: false, winner: null }),
    uploadWordPackAtomically: vi.fn().mockResolvedValue({ roomId: "room-1", packId: "movie-night", entryCount: 2 }),
    setWordPackEnabledAtomically: vi.fn().mockResolvedValue({ roomId: "room-1", packId: "movie-night", enabled: false }),
    deleteWordPackAtomically: vi.fn().mockResolvedValue({ roomId: "room-1", packId: "movie-night" }),
    abstainDisconnectedVoterAtomically: vi.fn().mockResolvedValue({ roomId: "room-1", allVoted: true }),
    editHintAtomically: vi.fn().mockResolvedValue({ roomId: "room-1", hintId: "hint-1" }),
    removeDiscussionMessageAtomically: vi.fn().mockResolvedValue({ roomId: "room-1", messageId: "discussion-1" }),
    markMemorableClueAtomically: vi.fn().mockResolvedValue({ roomId: "room-1", hintId: "hint-1", delta: 1 }),
    createAlertAtomically: vi.fn().mockResolvedValue({ roomId: "room-1", type: "flash", message: "Vote now", targetPlayerId: null }),
    ...overrides
  };
}

describe("cloud game service", () => {
  test("creates a server-hashed room and optional host player through the atomic repository call", async () => {
    const repository = buildRepository();
    const service = createCloudGameService({ repository, now: () => 100, random: () => 0, idFactory: (() => { let index = 0; return () => `id-${++index}`; })() });
    const result = await service.createRoom({ roomCode: "table1", password: "secret", hostUserId: "Maya" });

    expect(result).toMatchObject({ roomCode: "TABLE1", playerId: "id-2", userId: "Maya", isGhost: false });
    const input = repository.createRoomAtomically.mock.calls[0][0];
    expect(input.room.passwordHash).not.toContain("secret");
    expect(input.creatorPlayer).toMatchObject({ id: "id-2", userId: "Maya", avatarId: "Fox" });
  });

  test("joins through password-verified room lookup and never trusts client-supplied room identity", async () => {
    const password = "secret";
    const creationRepository = buildRepository();
    const creator = createCloudGameService({ repository: creationRepository, idFactory: (() => { let index = 0; return () => `create-${++index}`; })() });
    await creator.createRoom({ roomCode: "table1", password, hostUserId: "Maya" });
    const storedHash = creationRepository.createRoomAtomically.mock.calls[0][0].room.passwordHash;
    const repository = buildRepository({ findRoomByCode: vi.fn().mockResolvedValue({ id: "room-1", room_code: "TABLE1", password_hash: storedHash }) });
    const joiner = createCloudGameService({ repository, now: () => 200, random: () => 0, idFactory: (() => { let index = 0; return () => `join-${++index}`; })() });

    await expect(joiner.joinRoom({ roomCode: "table1", password, userId: "Akash" })).resolves.toEqual({ roomCode: "TABLE1", sessionToken: "joined-session", playerId: "player-2", isGhost: false });
    expect(repository.joinOrReclaimPlayerAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", userId: "Akash", isGhost: false, player: expect.objectContaining({ id: "join-1", avatarId: "Owl" }) }));
    await expect(joiner.joinRoom({ roomCode: "table1", password: "incorrect", userId: "Akash" })).rejects.toThrow("Room password is incorrect.");
  });

  test("recovers host credentials only after password verification and requests privacy-safe snapshots", async () => {
    const password = "secret";
    const creationRepository = buildRepository();
    const creator = createCloudGameService({ repository: creationRepository, idFactory: (() => { let index = 0; return () => `recover-${++index}`; })() });
    await creator.createRoom({ roomCode: "table1", password, hostUserId: "Maya" });
    const storedHash = creationRepository.createRoomAtomically.mock.calls[0][0].room.passwordHash;
    const repository = buildRepository({
      findRoomByCode: vi.fn().mockResolvedValue({ id: "room-1", room_code: "TABLE1", password_hash: storedHash, host_user_id: "Maya", host_token: "host-1" })
    });
    const service = createCloudGameService({ repository });

    await expect(service.recoverHostRoom({ roomCode: "table1", password })).resolves.toEqual({ roomCode: "TABLE1", hostToken: "host-1", playerId: "player-1", sessionToken: "creator-session", userId: "Maya", isGhost: false });
    await expect(service.recoverHostRoom({ roomCode: "table1", password: "wrong" })).rejects.toThrow("Room password is incorrect.");
    await service.snapshot("room-1", { isHost: true, hostToken: "host-1", peek: true });
    await service.snapshot("room-1", { sessionToken: "player-session", playerId: "player-2", isGhost: false });
    expect(repository.getAudienceSnapshot).toHaveBeenNthCalledWith(1, { roomId: "room-1", sessionToken: null, hostToken: "host-1", peek: true, playerId: null, isGhost: false });
    expect(repository.getAudienceSnapshot).toHaveBeenNthCalledWith(2, { roomId: "room-1", sessionToken: "player-session", hostToken: null, peek: false, playerId: "player-2", isGhost: false });
  });

  test("uses existing locked RPCs for cloud round, clue, vote, tally, and continuation commands", async () => {
    const repository = buildRepository({
      getAudienceSnapshot: vi.fn().mockResolvedValue({
        canStart: true,
        room: { selectedWordEntryId: "animal:1", impostorCount: 1, showCategoryToImpostor: true, showHintToImpostor: false },
        players: [
          { id: "player-1", isGhost: false, isKicked: false, isConnected: true, isReady: true },
          { id: "player-2", isGhost: false, isKicked: false, isConnected: true, isReady: true },
          { id: "player-3", isGhost: false, isKicked: false, isConnected: true, isReady: true }
        ],
        wordChoices: [{ id: "animal:1", entryId: 1, packId: "animal" }],
        round: null
      })
    });
    const service = createCloudGameService({ repository, now: () => 500, random: () => 0, idFactory: (() => { let index = 0; return () => `game-${++index}`; })() });
    await service.startRound("host-1");
    await service.submitHint("creator-session", "fierce");
    const vote = await service.submitVote("creator-session", "player-2");
    await service.continueRound("host-1");
    expect(repository.startRoundAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", wordChoiceKey: "animal:1", impostorPlayerIds: ["player-1"], round: expect.objectContaining({ actualWord: "Tiger", impostorHint: "Stripes", startedAt: 500 }) }));
    expect(repository.submitHintAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", sessionToken: "creator-session", content: "fierce", createdAt: 500 }));
    expect(repository.castVoteAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", targetPlayerId: "player-2", skipped: false, createdAt: 500 }));
    expect(repository.resolveVoteTallyAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", createdAt: 500 }));
    expect(vote.tally).toEqual({ roomId: "room-1", result: "revealed" });
    expect(repository.continueRoundAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", createdAt: 500 }));
  });

  test("parses recipient-only direct messages against the server-side room snapshot", async () => {
    const repository = buildRepository({
      getAudienceSnapshot: vi.fn().mockResolvedValue({ players: [
        { id: "player-1", userId: "Maya", isGhost: false, isKicked: false },
        { id: "player-2", userId: "Akash", isGhost: false, isKicked: false }
      ] })
    });
    const service = createCloudGameService({ repository, now: () => 700, idFactory: (() => { let index = 0; return () => `message-${++index}`; })() });
    await expect(service.postDirectMessage("creator-session", "@Akash check this clue")).resolves.toEqual({ roomId: "room-1", messageId: "message-1" });
    expect(repository.sendDirectMessageAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", sessionToken: "creator-session", recipientPlayerId: "player-2", content: "check this clue", createdAt: 700 }));
    await expect(service.postDirectMessage("creator-session", "not tagged")).rejects.toThrow("Start a private message");
  });

  test("purges a cloud room only after its host token is verified server-side", async () => {
    const repository = buildRepository();
    const service = createCloudGameService({ repository });
    await expect(service.endRoom("host-1")).resolves.toEqual({ roomId: "room-1" });
    expect(repository.purgeRoomSession).toHaveBeenCalledWith("room-1");
  });

  test("uses the locked cloud discussion transaction for active player messages", async () => {
    const repository = buildRepository();
    const service = createCloudGameService({ repository, now: () => 800, idFactory: () => "discussion-1" });
    await expect(service.postDiscussionMessage("creator-session", "sus clue")).resolves.toEqual({ roomId: "room-1", messageId: "discussion-1" });
    expect(repository.postDiscussionMessageAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", sessionToken: "creator-session", content: "sus clue", createdAt: 800 }));
  });

  test("uses the server-only leave transaction and defers tally unless remaining ballots are complete", async () => {
    const repository = buildRepository();
    const service = createCloudGameService({ repository, now: () => 900, idFactory: () => "leave-1" });
    await expect(service.leaveRoom("creator-session")).resolves.toMatchObject({ roomId: "room-1", result: "waiting", tally: null });
    expect(repository.leavePlayerAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", sessionToken: "creator-session", createdAt: 900 }));
    expect(repository.resolveVoteTallyAtomically).not.toHaveBeenCalled();
  });

  test("uses the server-only custom word-pack transactions after host-token verification", async () => {
    const repository = buildRepository();
    const service = createCloudGameService({ repository, now: () => 1_000, idFactory: (() => { let index = 0; return () => `pack-${++index}`; })() });
    const pack = { packId: "movie-night", name: "Movie night", version: 1, entries: [{ id: 1, category: "Film", word: "Jaws", impostorHint: "Shark" }, { id: 2, category: "Film", word: "Alien", impostorHint: "Space" }] };
    await expect(service.uploadPack("host-1", pack)).resolves.toMatchObject({ roomId: "room-1", packId: "movie-night" });
    await expect(service.setPackEnabled("host-1", "movie-night", false)).resolves.toMatchObject({ enabled: false });
    await expect(service.deletePack("host-1", "movie-night")).resolves.toMatchObject({ packId: "movie-night" });
    expect(repository.uploadWordPackAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", hostToken: "host-1", createdAt: 1_000, pack: expect.objectContaining({ id: "pack-2", packId: "movie-night" }) }));
    expect(repository.setWordPackEnabledAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", packId: "movie-night", enabled: false }));
    expect(repository.deleteWordPackAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", packId: "movie-night" }));
  });

  test("uses host-only moderation and alert transactions, resolving a completed offline abstention through the tally RPC", async () => {
    const repository = buildRepository({ resolveVoteTallyAtomically: vi.fn().mockResolvedValue({ roomId: "room-1", result: "finished" }) });
    const service = createCloudGameService({ repository, now: () => 1_100, idFactory: (() => { let index = 0; return () => `control-${++index}`; })() });

    await expect(service.hostControl("host-1", "abstain", { playerId: "player-2" })).resolves.toMatchObject({ roomId: "room-1", result: "finished", tally: { result: "finished" } });
    await service.hostControl("host-1", "editHint", { hintId: "hint-1", content: "edited clue" });
    await service.hostControl("host-1", "removeDiscussion", { messageId: "discussion-1" });
    await service.hostControl("host-1", "memorable", { hintId: "hint-1" });
    await service.hostControl("host-1", "alert", { type: "nudge", message: "Your turn is waiting", targetPlayerId: "player-2" });

    expect(repository.abstainDisconnectedVoterAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", hostToken: "host-1", playerId: "player-2", createdAt: 1_100 }));
    expect(repository.resolveVoteTallyAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", createdAt: 1_100 }));
    expect(repository.editHintAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", hintId: "hint-1", content: "edited clue" }));
    expect(repository.removeDiscussionMessageAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", messageId: "discussion-1" }));
    expect(repository.markMemorableClueAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", hintId: "hint-1" }));
    expect(repository.createAlertAtomically).toHaveBeenCalledWith(expect.objectContaining({ roomId: "room-1", type: "nudge", message: "Your turn is waiting", targetPlayerId: "player-2" }));
  });
});
