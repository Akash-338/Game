import { describe, expect, it } from "vitest";
import { parseTaggedDirectMessage } from "./directMessageModel.js";

const players = [
  { id: "p-1", userId: "Akash", isGhost: false, isKicked: false },
  { id: "p-2", userId: "Maya_7", isGhost: false, isKicked: false },
  { id: "p-3", userId: "Ghost", isGhost: true, isKicked: false }
];

describe("tagged direct messages", () => {
  it("resolves a case-insensitive active recipient and removes the recipient tag from private content", () => {
    expect(parseTaggedDirectMessage(" @maya_7   Are you the impostor? ", players, "p-1")).toEqual({ recipient: players[1], content: "Are you the impostor?" });
  });

  it("rejects missing tags, self-addressed messages, and Ghost recipients", () => {
    expect(() => parseTaggedDirectMessage("hello everyone", players, "p-1")).toThrow("Start a private message");
    expect(() => parseTaggedDirectMessage("@Akash hello", players, "p-1")).toThrow("another player");
    expect(() => parseTaggedDirectMessage("@Ghost hello", players, "p-1")).toThrow("active player");
  });
});
