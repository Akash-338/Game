import { describe, expect, it } from "vitest";
import { shouldDismissRoomActivity } from "./activityDockModel.js";

describe("room activity dismissal", () => {
  it("closes when the player taps outside the compact chat panel", () => {
    expect(shouldDismissRoomActivity({ clickedInsidePanel: false, clickedTrigger: false })).toBe(true);
  });

  it("stays open while the player uses the panel or its profile-area trigger", () => {
    expect(shouldDismissRoomActivity({ clickedInsidePanel: true, clickedTrigger: false })).toBe(false);
    expect(shouldDismissRoomActivity({ clickedInsidePanel: false, clickedTrigger: true })).toBe(false);
  });

  it("closes when the Escape key is used", () => {
    expect(shouldDismissRoomActivity({ clickedInsidePanel: true, clickedTrigger: true, key: "Escape" })).toBe(true);
  });

  it("stays open while a panel list scrolls but closes when the page itself scrolls", () => {
    expect(shouldDismissRoomActivity({ clickedInsidePanel: true, clickedTrigger: false, interaction: "scroll", scrolledInsidePanel: true })).toBe(false);
    expect(shouldDismissRoomActivity({ clickedInsidePanel: false, clickedTrigger: false, interaction: "scroll", scrolledInsidePanel: false })).toBe(true);
  });

  it("closes when focus moves to another screen control", () => {
    expect(shouldDismissRoomActivity({ clickedInsidePanel: false, clickedTrigger: false, interaction: "focus" })).toBe(true);
    expect(shouldDismissRoomActivity({ clickedInsidePanel: true, clickedTrigger: false, interaction: "focus" })).toBe(false);
  });
});
