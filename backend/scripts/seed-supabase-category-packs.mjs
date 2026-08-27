import { nanoid } from "nanoid";
import { createSupabaseGameRepository } from "../server/cloud/supabaseGameRepository.js";
import { loadDefaultCategoryPacks } from "../server/game/defaultPack.js";
import { getWordImpostorRuntimeSecrets } from "../server/runtimeConfig.js";

const { supabaseUrl, supabaseSecretKey } = getWordImpostorRuntimeSecrets();
if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required for the server-only category-pack seed.");
}

const repository = createSupabaseGameRepository({ url: supabaseUrl, secretKey: supabaseSecretKey });
const packs = loadDefaultCategoryPacks();
let entryCount = 0;

for (const { pack, filePath } of packs) {
  await repository.seedWordPack({
    id: `builtin-${pack.packId}`,
    packId: pack.packId,
    name: pack.name,
    version: pack.version,
    filePath,
    uploadedAt: Date.now(),
    isDefault: true,
    entries: pack.entries
  });
  entryCount += pack.entries.length;
}

console.log(`SUPABASE_CATEGORY_PACK_SEED packs=${packs.length} entries=${entryCount} secrets=redacted`);
