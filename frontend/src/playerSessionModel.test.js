import { describe, expect, it } from "vitest";
import { reconcilePlayerSessionMode } from "./playerSessionModel.js";

describe("player session mode reconciliation", () => {
  it("updates a saved Ghost identity when the authoritative roster restores the player", () => {
    const identity = { role: "player", playerId: "p-1", userId: "Akash", isGhost: true };
    const next = reconcilePlayerSessionMode(identity, [{ id: "p-1", isGhost: false }]);
    expect(next).toEqual({ ...identity, isGhost: false });
  });

  it("does not alter hosts, unrelated roster rows, or an already-current player mode", () => {
    const host = { role: "host", hostToken: "secret" };
    const player = { role: "player", playerId: "p-1", isGhost: false };
    expect(reconcilePlayerSessionMode(host, [{ id: "p-1", isGhost: true }])).toBe(host);
    expect(reconcilePlayerSessionMode(player, [{ id: "p-2", isGhost: true }])).toBe(player);
    expect(reconcilePlayerSessionMode(player, [{ id: "p-1", isGhost: false }])).toBe(player);
  });
});
