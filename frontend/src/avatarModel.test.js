import { describe, expect, it } from "vitest";
import { getAvatarInitials } from "./avatarModel.js";

describe("getAvatarInitials", () => {
  it("uses the first two letters of a player User ID", () => {
    expect(getAvatarInitials("Akash")).toBe("AK");
    expect(getAvatarInitials("Maya")).toBe("MA");
  });

  it("normalizes whitespace, casing, short names, and missing values", () => {
    expect(getAvatarInitials("  ov  ")).toBe("OV");
    expect(getAvatarInitials("Z")).toBe("Z");
    expect(getAvatarInitials("")).toBe("?");
  });
});
