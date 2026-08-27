function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getWordImpostorRuntimeSecrets(environment = process.env) {
  return {
    supabaseUrl: stringValue(environment.SUPABASE_URL),
    supabaseSecretKey: stringValue(environment.SUPABASE_SECRET_KEY),
    redisUrl: stringValue(environment.UPSTASH_REDIS_URL)
  };
}

export function getWordImpostorRuntimeConfig(environment = process.env) {
  const { supabaseUrl, supabaseSecretKey, redisUrl } = getWordImpostorRuntimeSecrets(environment);
  const storageBucket = stringValue(environment.WORD_IMPOSTOR_STORAGE_BUCKET);
  const cloudModeEnabled = environment.WORD_IMPOSTOR_CLOUD_MODE === "true";
  const redisAdapterEnabled = cloudModeEnabled && environment.WORD_IMPOSTOR_REDIS_ADAPTER_ENABLED === "true";
  const externalStoreRequested = Boolean(supabaseUrl || supabaseSecretKey || redisUrl || storageBucket);
  const cloudDataApiReady = Boolean(supabaseUrl && supabaseSecretKey);

  return {
    database: cloudDataApiReady ? "supabase-data-api-pending-adapter" : "sqlite",
    redis: redisAdapterEnabled ? "redis-adapter-enabled" : redisUrl ? "configured-pending-adapter" : "disabled",
    storage: storageBucket ? "configured-pending-adapter" : "local",
    externalStoreRequested,
    externalStoreReady: Boolean(cloudDataApiReady && redisUrl),
    cloudModeEnabled,
    redisAdapterEnabled,
    cloudDataApiReady,
    missingExternalRequirements: [
      !supabaseUrl && "SUPABASE_URL",
      !supabaseSecretKey && "SUPABASE_SECRET_KEY",
      !redisUrl && "UPSTASH_REDIS_URL"
    ].filter(Boolean)
  };
}

export function assertExternalStoreReady(environment = process.env) {
  const config = getWordImpostorRuntimeConfig(environment);
  if (!config.externalStoreReady) {
    throw new Error(`External runtime requires ${config.missingExternalRequirements.join(" and ")}.`);
  }
  return config;
}
