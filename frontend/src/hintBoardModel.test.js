import { describe, expect, it } from "vitest";
import { buildPlayerHintCards } from "./hintBoardModel.js";

describe("buildPlayerHintCards", () => {
  it("keeps each active player in a stable card with only their ordered clue history", () => {
    const cards = buildPlayerHintCards([
      { id: "p1", userId: "Akash", isConnected: true },
      { id: "p2", userId: "Maya", isConnected: false },
      { id: "g1", userId: "Ghost", isGhost: true, isConnected: true },
    ], [
      { id: 3, playerId: "p1", cycleNumber: 2, content: "Bright" },
      { id: 1, playerId: "p2", cycleNumber: 1, content: "Tropical" },
      { id: 2, playerId: "p1", cycleNumber: 1, content: "Sweet" },
    ]);

    expect(cards).toHaveLength(2);
    expect(cards[0].player.userId).toBe("Akash");
    expect(cards[0].player.isConnected).toBe(true);
    expect(cards[0].hints.map((hint) => hint.content)).toEqual(["Sweet", "Bright"]);
    expect(cards[1].player.userId).toBe("Maya");
    expect(cards[1].player.isConnected).toBe(false);
    expect(cards[1].hints.map((hint) => hint.content)).toEqual(["Tropical"]);
  });

  it("keeps zero-clue connected and offline players visible when a host supplies the full roster", () => {
    const cards = buildPlayerHintCards([
      { id: "p1", userId: "Akash", isConnected: true },
      { id: "p2", userId: "Maya", isConnected: false },
      { id: "p3", userId: "Ravi", isConnected: true },
      { id: "g1", userId: "Ghost", isGhost: true, isConnected: true },
    ], [
      { id: 1, playerId: "p1", cycleNumber: 1, content: "Bright" },
    ]);

    expect(cards.map((card) => card.player.userId)).toEqual(["Akash", "Maya", "Ravi"]);
    expect(cards.map((card) => card.player.isConnected)).toEqual([true, false, true]);
    expect(cards[1].hints).toEqual([]);
    expect(cards[2].hints).toEqual([]);
  });
});
