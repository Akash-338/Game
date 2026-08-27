import { createSupabaseGameRepository } from "../../cloud/supabaseGameRepository.js";

export function createGameRepository({ runtimeConfig, runtimeSecrets, sqliteRepository, supabaseFactory = createSupabaseGameRepository }) {
  if (!runtimeConfig?.cloudModeEnabled) return { kind: "sqlite", repository: sqliteRepository };
  if (!runtimeConfig.cloudDataApiReady || !runtimeSecrets?.supabaseUrl || !runtimeSecrets?.supabaseSecretKey) {
    throw new Error("Cloud game repository cannot start without complete server-only Supabase configuration.");
  }
  return {
    kind: "supabase",
    repository: supabaseFactory({ url: runtimeSecrets.supabaseUrl, secretKey: runtimeSecrets.supabaseSecretKey })
  };
}
