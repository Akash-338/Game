import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultCategoryDirectory = path.join(here, "..", "data", "categories");
export const defaultCategoryFiles = ["animal.json", "fruits.json", "food.json", "object.json", "karnataka-big-cities.json", "sports.json"];

export function loadDefaultCategoryPacks() {
  return defaultCategoryFiles.map((fileName) => ({
    filePath: path.join(defaultCategoryDirectory, fileName),
    pack: JSON.parse(fs.readFileSync(path.join(defaultCategoryDirectory, fileName), "utf8"))
  }));
}
