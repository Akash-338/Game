import { describe, expect, test } from "vitest";
import { getRoleRevealState } from "./roleReveal.js";

describe("private role reveal state", () => {
  test("does not expose a civilian word while the vault is sealed", () => {
    const sealed = getRoleRevealState({ role: "civilian", actualWord: "Lantern", category: "Object" }, false);

    expect(sealed.mode).toBe("sealed");
    expect(sealed.label).toBe("Private word");
    expect(Object.values(sealed).join(" ")).not.toContain("Lantern");
  });

  test("only provides the role details after the player unlocks the vault", () => {
    const sealed = getRoleRevealState({ role: "impostor", category: "Sports", impostorHint: "Pitch" }, false);
    const revealed = getRoleRevealState({ role: "impostor", category: "Sports", impostorHint: "Pitch" }, true);

    expect(sealed).not.toHaveProperty("title");
    expect(revealed).toMatchObject({ mode: "revealed", title: "Impostor", detail: "Category: Sports" });
  });
});
