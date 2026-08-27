import { describe, expect, it } from "vitest";
import { assertWordPack, canBeginRound, unusedWords } from "./rules.js";

describe("Word Impostor rules", () => {
  it("blocks the round until every active player is online and ready", () => {
    const players = [
      { isReady: true, isConnected: true },
      { isReady: true, isConnected: true },
      { isReady: false, isConnected: true },
      { isReady: false, isConnected: false, isGhost: true }
    ];
    expect(canBeginRound(players, 1)).toBe(false);
    players[2].isReady = true;
    expect(canBeginRound(players, 1)).toBe(true);
  });

  it("rejects repeated word entry IDs from the current session", () => {
    const entries = [
      { id: 1, category: "Food" },
      { id: 2, category: "Places" }
    ];
    expect(unusedWords(entries, ["1"])).toEqual([{ id: 2, category: "Places" }]);
    expect(unusedWords(entries, [], ["Food"])).toEqual([{ id: 1, category: "Food" }]);
  });

  it("validates uploaded custom word packs", () => {
    const pack = { packId: "friends", name: "Friends", version: 1, entries: [{ id: 1, category: "Animals", word: "Cat", impostorHint: "Pet" }] };
    expect(assertWordPack(pack)).toBe(true);
    expect(() => assertWordPack({ ...pack, entries: [{ ...pack.entries[0] }, { ...pack.entries[0] }] })).toThrow("Duplicate entry id");
    expect(() => assertWordPack({ ...pack, entries: [{ ...pack.entries[0], id: "cat" }] })).toThrow("positive numeric id");
  });
});
