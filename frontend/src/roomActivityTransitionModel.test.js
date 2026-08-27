import { describe, expect, it } from "vitest";
import { shouldCloseRoomActivityOnGameTransition } from "./roomActivityTransitionModel.js";

describe("shouldCloseRoomActivityOnGameTransition", () => {
  it("closes the compact room-activity panel as a game begins or is recovered in play", () => {
    expect(shouldCloseRoomActivityOnGameTransition({ status: "lobby", gamePhase: "lobby" }, { status: "playing", gamePhase: "clues" })).toBe(true);
    expect(shouldCloseRoomActivityOnGameTransition({ status: "revealed", gamePhase: "finished" }, { status: "playing", gamePhase: "clues" })).toBe(true);
    expect(shouldCloseRoomActivityOnGameTransition(null, { status: "playing", gamePhase: "clues" })).toBe(true);
  });

  it("closes it between clue, vote, runoff, and result phases but not routine snapshots in one phase", () => {
    expect(shouldCloseRoomActivityOnGameTransition({ status: "playing", gamePhase: "clues" }, { status: "playing", gamePhase: "voting" })).toBe(true);
    expect(shouldCloseRoomActivityOnGameTransition({ status: "playing", gamePhase: "voting" }, { status: "playing", gamePhase: "voting" })).toBe(false);
    expect(shouldCloseRoomActivityOnGameTransition({ status: "playing", gamePhase: "runoff" }, { status: "revealed", gamePhase: "finished" })).toBe(true);
  });
});
