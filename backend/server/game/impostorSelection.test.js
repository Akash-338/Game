import { describe, expect, it } from "vitest";
import { selectImpostorIds } from "./impostorSelection.js";

describe("selectImpostorIds", () => {
  const players = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("avoids the immediately previous impostor when fresh eligible players exist", () => {
    expect(selectImpostorIds(players, 1, ["a"], () => 0)).not.toContain("a");
  });

  it("uses prior impostors only when needed and never duplicates a selected player", () => {
    const selected = selectImpostorIds([{ id: "a" }, { id: "b" }], 2, ["a"], () => 0);
    expect(new Set(selected).size).toBe(2);
    expect(selected.sort()).toEqual(["a", "b"]);
  });
});
