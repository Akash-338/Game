import { describe, expect, test, vi } from "vitest";
import { createGameRepository } from "./gameRepositoryFactory.js";

describe("game repository factory", () => {
  test("retains SQLite as the default even when external credentials are configured", () => {
    const sqliteRepository = { prepare: vi.fn() };
    const result = createGameRepository({ runtimeConfig: { cloudModeEnabled: false }, runtimeSecrets: {}, sqliteRepository });
    expect(result).toEqual({ kind: "sqlite", repository: sqliteRepository });
  });

  test("fails closed for incomplete cloud secrets and builds the server-only Supabase repository only when cloud mode is explicit", () => {
    expect(() => createGameRepository({ runtimeConfig: { cloudModeEnabled: true, cloudDataApiReady: false }, runtimeSecrets: {}, sqliteRepository: {} })).toThrow("Cloud game repository");
    const factory = vi.fn(() => ({ healthCheck: vi.fn() }));
    const result = createGameRepository({ runtimeConfig: { cloudModeEnabled: true, cloudDataApiReady: true }, runtimeSecrets: { supabaseUrl: "https://example.supabase.co", supabaseSecretKey: "server-secret" }, sqliteRepository: {}, supabaseFactory: factory });
    expect(result.kind).toBe("supabase");
    expect(factory).toHaveBeenCalledWith({ url: "https://example.supabase.co", secretKey: "server-secret" });
  });
});
