import { describe, expect, test } from "vitest";
import { assertExternalStoreReady, getWordImpostorRuntimeConfig, getWordImpostorRuntimeSecrets } from "./runtimeConfig.js";

describe("Word Impostor deployment runtime configuration", () => {
  test("keeps the active local game on SQLite with no external credentials", () => {
    expect(getWordImpostorRuntimeConfig({})).toMatchObject({
      database: "sqlite",
      redis: "disabled",
      externalStoreRequested: false,
      externalStoreReady: false
    });
  });

  test("uses dedicated Word Impostor variables instead of an unrelated platform database URL", () => {
    const config = getWordImpostorRuntimeConfig({
      DATABASE_URL: "postgres://platform-managed-value",
      SUPABASE_URL: "https://word-impostor.supabase.co",
      SUPABASE_SECRET_KEY: "server-only-secret",
      UPSTASH_REDIS_URL: "rediss://:secret@redis.example:6379"
    });
    expect(config).toMatchObject({
      database: "supabase-data-api-pending-adapter",
      redis: "configured-pending-adapter",
      externalStoreReady: true
    });
  });

  test("fails closed when only part of the external stack is supplied", () => {
    expect(() => assertExternalStoreReady({ SUPABASE_URL: "https://word-impostor.supabase.co", SUPABASE_SECRET_KEY: "server-only-secret" })).toThrow("UPSTASH_REDIS_URL");
  });

  test("keeps the Redis Socket.IO adapter disabled unless cloud mode and its explicit adapter flag are both enabled", () => {
    const config = getWordImpostorRuntimeConfig({
      SUPABASE_URL: "https://word-impostor.supabase.co",
      SUPABASE_SECRET_KEY: "server-only-secret",
      UPSTASH_REDIS_URL: "rediss://:secret@redis.example:6379"
    });
    expect(config.redisAdapterEnabled).toBe(false);
  });

  test("keeps private provider connection values out of the public runtime status object", () => {
    const environment = {
      SUPABASE_URL: "https://word-impostor.supabase.co",
      SUPABASE_SECRET_KEY: "server-only-secret",
      UPSTASH_REDIS_URL: "rediss://:secret@redis.example:6379"
    };
    expect(JSON.stringify(getWordImpostorRuntimeConfig(environment))).not.toContain("server-only-secret");
    expect(getWordImpostorRuntimeSecrets(environment).redisUrl).toContain("rediss://");
  });
});
