import { describe, expect, test, vi } from "vitest";
import { createAsyncGameCommandDispatcher } from "./asyncGameCommandDispatcher.js";

describe("async game command dispatcher", () => {
  test("preserves the current synchronous SQLite command contract by default", async () => {
    const snapshot = vi.fn(() => ({ source: "sqlite" }));
    const setReady = vi.fn(() => "room-local");
    const dispatcher = createAsyncGameCommandDispatcher({ selectedRepository: { kind: "sqlite", repository: {} }, sqliteCommands: { snapshot, setReady, setPresence: vi.fn(), kickPlayer: vi.fn() } });

    await expect(dispatcher.setReady({ sessionToken: "local-session", ready: true })).resolves.toEqual({ roomId: "room-local" });
    await expect(dispatcher.getAudienceSnapshot({ roomId: "room-local", playerId: "player-1" })).resolves.toEqual({ source: "sqlite" });
    expect(setReady).toHaveBeenCalledWith("local-session", true);
    expect(snapshot).toHaveBeenCalledWith("room-local", { playerId: "player-1", isGhost: false });
    expect(dispatcher.isCloud).toBe(false);
  });

  test("uses server-only lookups and idempotent Supabase RPCs only when cloud selection is explicit", async () => {
    const cloud = {
      findPlayerBySessionToken: vi.fn().mockResolvedValue({ room_id: "room-cloud", is_kicked: false }),
      setReadyAtomically: vi.fn().mockResolvedValue({ roomId: "room-cloud", ready: true }),
      setPresenceAtomically: vi.fn().mockResolvedValue({ roomId: "room-cloud", connected: true }),
      findRoomByHostToken: vi.fn().mockResolvedValue({ id: "room-cloud" }),
      kickPlayerAtomically: vi.fn().mockResolvedValue({ playerId: "player-2" }),
      updateLobbySettingsAtomically: vi.fn().mockResolvedValue({ roomId: "room-cloud" }),
      reorderPlayersAtomically: vi.fn().mockResolvedValue({ roomId: "room-cloud" }),
      nextTurnAtomically: vi.fn().mockResolvedValue({ roomId: "room-cloud", playerId: "player-2" }),
      setDiscussionLockedAtomically: vi.fn().mockResolvedValue({ roomId: "room-cloud", locked: true }),
      revealRolesAtomically: vi.fn().mockResolvedValue({ roomId: "room-cloud", roundId: "round-1" }),
      getAudienceSnapshot: vi.fn().mockResolvedValue({ room: { roomCode: "CLOUD" } })
    };
    const cloudService = {
      createRoom: vi.fn().mockResolvedValue({ roomCode: "CLOUD" }),
      joinRoom: vi.fn().mockResolvedValue({ roomCode: "CLOUD", playerId: "player-2" }),
      recoverHostRoom: vi.fn().mockResolvedValue({ roomCode: "CLOUD", hostToken: "host-1" }),
      hostPlayerForSession: vi.fn().mockResolvedValue({ id: "player-1" }),
      getRoomByCode: vi.fn().mockResolvedValue({ id: "room-cloud" }),
      getRoomByHostToken: vi.fn().mockResolvedValue({ id: "room-cloud" }),
      startRound: vi.fn().mockResolvedValue({ roomId: "room-cloud" }),
      submitHint: vi.fn().mockResolvedValue({ roomId: "room-cloud" }),
      submitVote: vi.fn().mockResolvedValue({ roomId: "room-cloud", tally: null }),
      continueRound: vi.fn().mockResolvedValue({ roomId: "room-cloud" }),
      postDirectMessage: vi.fn().mockResolvedValue({ roomId: "room-cloud", messageId: "message-1" }),
      endRoom: vi.fn().mockResolvedValue({ roomId: "room-cloud" }),
      postDiscussionMessage: vi.fn().mockResolvedValue({ roomId: "room-cloud", messageId: "discussion-1" }),
      leaveRoom: vi.fn().mockResolvedValue({ roomId: "room-cloud", result: "waiting" }),
      uploadPack: vi.fn().mockResolvedValue({ roomId: "room-cloud", packId: "movie-night" }),
      setPackEnabled: vi.fn().mockResolvedValue({ roomId: "room-cloud", packId: "movie-night", enabled: false }),
      deletePack: vi.fn().mockResolvedValue({ roomId: "room-cloud", packId: "movie-night" }),
      hostControl: vi.fn().mockResolvedValue({ roomId: "room-cloud" }),
      snapshot: vi.fn().mockResolvedValue({ room: { roomCode: "CLOUD" } })
    };
    const dispatcher = createAsyncGameCommandDispatcher({ selectedRepository: { kind: "supabase", repository: cloud }, sqliteCommands: {}, cloudGameService: cloudService, operationIdFactory: () => "operation-1", now: () => 123 });

    await dispatcher.createRoom({ roomCode: "CLOUD" });
    await dispatcher.joinRoom({ roomCode: "CLOUD", userId: "Maya" });
    await dispatcher.recoverHostRoom({ roomCode: "CLOUD", password: "secret" });
    await dispatcher.hostPlayerForSession("host-1", "session-1");
    await dispatcher.getRoomByCode("CLOUD");
    await dispatcher.getRoomByHostToken("host-1");
    await dispatcher.startRound("host-1");
    await dispatcher.submitHint("session-1", "clue");
    await dispatcher.submitVote("session-1", "player-2");
    await dispatcher.continueRound("host-1");
    await dispatcher.postDirectMessage("session-1", "@Maya hello");
    await dispatcher.endRoom("host-1");
    await dispatcher.postDiscussionMessage("session-1", "sus clue");
    await dispatcher.leaveRoom("session-1");
    await dispatcher.uploadPack("host-1", { packId: "movie-night", entries: [] });
    await dispatcher.setPackEnabled("host-1", "movie-night", false);
    await dispatcher.deletePack("host-1", "movie-night");
    await dispatcher.setReady({ sessionToken: "session-1", ready: true });
    await dispatcher.setPresence({ sessionToken: "session-1", connected: true });
    await dispatcher.kickPlayer({ hostToken: "host-1", playerId: "player-2" });
    await dispatcher.updateLobbySettings({ hostToken: "host-1", changes: { clueCycleLimit: 2 } });
    await dispatcher.reorderPlayers({ hostToken: "host-1", playerIds: ["player-2", "player-1"] });
    await dispatcher.nextTurn({ hostToken: "host-1" });
    await dispatcher.setDiscussionLocked({ hostToken: "host-1", locked: true });
    await dispatcher.revealRoles({ hostToken: "host-1", eventId: "event-1" });
    await dispatcher.hostControl("host-1", "abstain", { playerId: "player-2" });
    await dispatcher.hostControl("host-1", "editHint", { hintId: "hint-1", content: "edited" });
    await dispatcher.hostControl("host-1", "removeDiscussion", { messageId: "message-1" });
    await dispatcher.hostControl("host-1", "memorable", { hintId: "hint-1" });
    await dispatcher.hostControl("host-1", "alert", { type: "flash", message: "Vote now" });
    await dispatcher.getAudienceSnapshot({ roomId: "room-cloud", hostToken: "host-1", isHost: true, peek: true });

    expect(cloud.setReadyAtomically).toHaveBeenCalledWith({ operationId: "operation-1", roomId: "room-cloud", sessionToken: "session-1", ready: true, createdAt: 123 });
    expect(cloud.setPresenceAtomically).toHaveBeenCalledWith({ operationId: "operation-1", roomId: "room-cloud", sessionToken: "session-1", connected: true, createdAt: 123 });
    expect(cloud.kickPlayerAtomically).toHaveBeenCalledWith({ operationId: "operation-1", roomId: "room-cloud", hostToken: "host-1", playerId: "player-2", createdAt: 123 });
    expect(cloud.updateLobbySettingsAtomically).toHaveBeenCalledWith({ operationId: "operation-1", roomId: "room-cloud", hostToken: "host-1", changes: { clueCycleLimit: 2 }, createdAt: 123 });
    expect(cloud.reorderPlayersAtomically).toHaveBeenCalledWith({ operationId: "operation-1", roomId: "room-cloud", hostToken: "host-1", playerIds: ["player-2", "player-1"], createdAt: 123 });
    expect(cloud.nextTurnAtomically).toHaveBeenCalledWith({ operationId: "operation-1", roomId: "room-cloud", hostToken: "host-1", createdAt: 123 });
    expect(cloud.setDiscussionLockedAtomically).toHaveBeenCalledWith({ operationId: "operation-1", roomId: "room-cloud", hostToken: "host-1", locked: true, createdAt: 123 });
    expect(cloud.revealRolesAtomically).toHaveBeenCalledWith({ operationId: "operation-1", roomId: "room-cloud", hostToken: "host-1", eventId: "event-1", createdAt: 123 });
    expect(cloudService.createRoom).toHaveBeenCalledWith({ roomCode: "CLOUD" });
    expect(cloudService.joinRoom).toHaveBeenCalledWith({ roomCode: "CLOUD", userId: "Maya" });
    expect(cloudService.recoverHostRoom).toHaveBeenCalledWith({ roomCode: "CLOUD", password: "secret" });
    expect(cloudService.hostPlayerForSession).toHaveBeenCalledWith("host-1", "session-1");
    expect(cloudService.getRoomByCode).toHaveBeenCalledWith("CLOUD");
    expect(cloudService.getRoomByHostToken).toHaveBeenCalledWith("host-1");
    expect(cloudService.startRound).toHaveBeenCalledWith("host-1");
    expect(cloudService.submitHint).toHaveBeenCalledWith("session-1", "clue");
    expect(cloudService.submitVote).toHaveBeenCalledWith("session-1", "player-2", false);
    expect(cloudService.continueRound).toHaveBeenCalledWith("host-1");
    expect(cloudService.postDirectMessage).toHaveBeenCalledWith("session-1", "@Maya hello");
    expect(cloudService.endRoom).toHaveBeenCalledWith("host-1");
    expect(cloudService.postDiscussionMessage).toHaveBeenCalledWith("session-1", "sus clue");
    expect(cloudService.leaveRoom).toHaveBeenCalledWith("session-1");
    expect(cloudService.uploadPack).toHaveBeenCalledWith("host-1", { packId: "movie-night", entries: [] });
    expect(cloudService.setPackEnabled).toHaveBeenCalledWith("host-1", "movie-night", false);
    expect(cloudService.deletePack).toHaveBeenCalledWith("host-1", "movie-night");
    expect(cloudService.hostControl).toHaveBeenNthCalledWith(1, "host-1", "abstain", { playerId: "player-2" });
    expect(cloudService.hostControl).toHaveBeenNthCalledWith(2, "host-1", "editHint", { hintId: "hint-1", content: "edited" });
    expect(cloudService.hostControl).toHaveBeenNthCalledWith(3, "host-1", "removeDiscussion", { messageId: "message-1" });
    expect(cloudService.hostControl).toHaveBeenNthCalledWith(4, "host-1", "memorable", { hintId: "hint-1" });
    expect(cloudService.hostControl).toHaveBeenNthCalledWith(5, "host-1", "alert", { type: "flash", message: "Vote now" });
    expect(cloudService.snapshot).toHaveBeenCalledWith("room-cloud", { sessionToken: null, hostToken: "host-1", peek: true, isHost: true, isGhost: false, playerId: null });
    expect(dispatcher.isCloud).toBe(true);
  });
});
