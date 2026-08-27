import { describe, expect, it } from "vitest";
import { defaultCategoryFiles, loadDefaultCategoryPacks } from "./defaultPack.js";
import { assertWordPack } from "./rules.js";

const categoryPacks = loadDefaultCategoryPacks();
const entries = categoryPacks.flatMap(({ pack }) => pack.entries);
const categoryOrder = ["Animal", "Fruits", "Food", "Object", "Karnataka Big Cities", "Sports"];

describe("built-in category word packs", () => {
  it("loads the six category files as stable individual packs", () => {
    expect(defaultCategoryFiles).toEqual(["animal.json", "fruits.json", "food.json", "object.json", "karnataka-big-cities.json", "sports.json"]);
    expect(categoryPacks).toHaveLength(6);
    expect(new Set(categoryPacks.map(({ pack }) => pack.packId)).size).toBe(6);
    categoryPacks.forEach(({ pack }) => expect(new Set(pack.entries.map((entry) => entry.category)).size).toBe(1));
  });

  it("preserves sixty valid entries, one-word hints, and numeric IDs across all category files", () => {
    const categories = [...new Set(entries.map((entry) => entry.category))];
    const sortedIds = entries.map((entry) => entry.id).sort((left, right) => left - right);

    categoryPacks.forEach(({ pack }) => expect(assertWordPack(pack)).toBe(true));
    expect(categories).toEqual(categoryOrder);
    expect(sortedIds).toEqual(Array.from({ length: 60 }, (_, index) => index + 1));
    expect(entries.every((entry) => /^\S+$/.test(entry.impostorHint))).toBe(true);
    expect(categoryOrder.every((category) => entries.filter((entry) => entry.category === category).length === 10)).toBe(true);
  });
});
