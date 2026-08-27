import { describe, expect, it } from "vitest";
import { findWordEntry, sameWordEntryId, wordChoiceKey } from "../../shared/wordEntryId.js";

describe("numeric word-entry IDs", () => {
  it("matches the host's persisted string selection to a numeric word choice", () => {
    expect(sameWordEntryId(13, "13")).toBe(true);
    expect(sameWordEntryId(13, "14")).toBe(false);
    expect(sameWordEntryId(13, null)).toBe(false);
    expect(findWordEntry([{ id: 13, word: "Pizza" }], "13")).toEqual({ id: 13, word: "Pizza" });
  });

  it("keeps same-numbered entries from separate packs distinct for host selection", () => {
    const classic = { id: 55, packId: "classic-pack", word: "Bread" };
    const custom = { id: 55, packId: "custom-pack", word: "Noodles" };

    expect(wordChoiceKey(classic)).toBe("classic-pack:55");
    expect(wordChoiceKey(custom)).toBe("custom-pack:55");
    expect(new Set([wordChoiceKey(classic), wordChoiceKey(custom)]).size).toBe(2);
    expect(findWordEntry([classic, custom], wordChoiceKey(custom))).toBe(custom);
  });
});
