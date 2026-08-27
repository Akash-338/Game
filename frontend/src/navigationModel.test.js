import { describe, expect, it } from "vitest";
import { getBackNavigation } from "./navigationModel.js";

describe("safe back-navigation policy", () => {
  it("allows a player to return from the Room ID and password form without losing their entered name", () => {
    expect(getBackNavigation("player-join")).toEqual({ label: "Back to your name", destination: "entry" });
  });

  it("allows a host to return from the room create or recovery screen before a room exists", () => {
    expect(getBackNavigation("host-access")).toEqual({ label: "Back to sign in", destination: "entry" });
  });

  it("never offers a back path that could abandon an active room", () => {
    expect(getBackNavigation("player-join", { hasActiveRoom: true })).toBeNull();
    expect(getBackNavigation("host-access", { hasActiveRoom: true })).toBeNull();
    expect(getBackNavigation("live-game")).toBeNull();
  });
});
