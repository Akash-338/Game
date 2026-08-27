import { describe, expect, it } from "vitest";
import { getRoleRevealState } from "./roleRevealModel.js";

describe("getRoleRevealState", () => {
  it("keeps every civilian secret detail out of the sealed vault", () => {
    expect(getRoleRevealState({ role: "civilian", actualWord: "Mango", category: "Fruits" }, false)).toEqual({
      isImposter: false,
      mode: "sealed",
      label: "Private word",
      message: "Your secret word is sealed from view.",
      action: "Tap to unlock"
    });
  });

  it("returns only the intended impostor category when both category and hint exist", () => {
    expect(getRoleRevealState({ role: "impostor", category: "Sports", impostorHint: "Pitch" }, true)).toEqual({
      isImposter: true,
      mode: "revealed",
      label: "You are the",
      title: "Impostor",
      detail: "Category: Sports",
      action: "Tap to hide"
    });
  });

  it("does not create a role card before the server assigns a private role", () => {
    expect(getRoleRevealState(null, false)).toBeNull();
  });
});
