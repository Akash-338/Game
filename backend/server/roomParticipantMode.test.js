import { describe, expect, it } from "vitest";
import { restoreActiveParticipantSocketModes } from "./roomParticipantMode.js";

describe("continue-round participant mode restoration", () => {
  it("restores every connected non-host participant from Ghost socket mode", () => {
    const eliminatedPlayer = { data: { roomId: "room-1", playerId: "p-1", isGhost: true, isHost: false } };
    const lateGhost = { data: { roomId: "room-1", playerId: "p-2", isGhost: true, isHost: false } };
    const activePlayer = { data: { roomId: "room-1", playerId: "p-3", isGhost: false, isHost: false } };
    const host = { data: { roomId: "room-1", isHost: true, isGhost: false } };
    const anotherRoom = { data: { roomId: "room-2", playerId: "p-4", isGhost: true, isHost: false } };

    expect(restoreActiveParticipantSocketModes([eliminatedPlayer, lateGhost, activePlayer, host, anotherRoom], "room-1")).toBe(2);
    expect(eliminatedPlayer.data.isGhost).toBe(false);
    expect(lateGhost.data.isGhost).toBe(false);
    expect(activePlayer.data.isGhost).toBe(false);
    expect(host.data.isGhost).toBe(false);
    expect(anotherRoom.data.isGhost).toBe(true);
  });
});
