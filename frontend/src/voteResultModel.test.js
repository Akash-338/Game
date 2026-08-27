import { describe, expect, it } from "vitest";
import { formatPublicVoteResult } from "./voteResultModel.js";

describe("formatPublicVoteResult", () => {
  it("publicly identifies each eliminated player without exposing active-player roles", () => {
    expect(formatPublicVoteResult({
      eliminated: [{ userId: "Asha", role: "impostor" }, { userId: "Ben", role: "civilian" }]
    })).toBe("Asha was an impostor. Ben was a civilian. They are now Ghosts.");
  });

  it("adds the authoritative winner when the completed vote ends the game", () => {
    expect(formatPublicVoteResult({
      eliminated: [{ userId: "Asha", role: "impostor" }],
      winner: "civilians"
    })).toBe("Asha was an impostor. Civilians win the game.");
  });
});
