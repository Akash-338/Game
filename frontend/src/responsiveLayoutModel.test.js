import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("./responsive-universal.css", import.meta.url), "utf8");

describe("responsive universal layout model", () => {
  it("covers compact phones, tablets, landscape screens, large desktops, and TV-scale displays", () => {
    expect(stylesheet).toContain("@media (max-width: 35rem)");
    expect(stylesheet).toContain("@media (max-width: 48rem)");
    expect(stylesheet).toContain("@media (max-width: 52rem)");
    expect(stylesheet).toContain("@media (max-height: 35rem) and (orientation: landscape)");
    expect(stylesheet).toContain("@media (min-width: 90rem)");
    expect(stylesheet).toContain("@media (min-width: 137.5rem)");
  });

  it("keeps page shells, fixed controls, the host grid, and activity dock inside the viewport", () => {
    expect(stylesheet).toContain("overflow-x: clip");
    expect(stylesheet).toContain(".host-grid");
    expect(stylesheet).toContain(".activity-dock");
    expect(stylesheet).toContain(".hint-composer");
    expect(stylesheet).toContain("100dvh");
    expect(stylesheet).toContain("text-overflow: ellipsis");
    expect(stylesheet).toContain("48dvh");
  });
});
