import { describe, expect, it } from "vitest";
import { isDiscussionPinned } from "./discussionPanelModel.js";

describe("isDiscussionPinned", () => {
  it("keeps discussion open during clue play and both ballot stages", () => {
    expect(isDiscussionPinned({ status: "playing", gamePhase: "clues" })).toBe(true);
    expect(isDiscussionPinned({ status: "playing", gamePhase: "voting" })).toBe(true);
    expect(isDiscussionPinned({ status: "playing", gamePhase: "runoff" })).toBe(true);
  });

  it("does not pin discussion before a game or after the recap", () => {
    expect(isDiscussionPinned({ status: "lobby", gamePhase: "lobby" })).toBe(false);
    expect(isDiscussionPinned({ status: "revealed", gamePhase: "recap" })).toBe(false);
  });
});
