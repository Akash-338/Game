import { describe, expect, test } from "vitest";
import { attachRedisSocketAdapter } from "../realtime/redisSocketAdapter.js";

describe("Redis Socket.IO adapter boundary", () => {
  test("does not create network connections unless cloud-mode adapter is explicitly enabled", async () => {
    const result = await attachRedisSocketAdapter({}, { redisAdapterEnabled: false });
    expect(result).toEqual({ attached: false, reason: "disabled" });
  });

  test("fails closed when enabled without a private Redis URL", async () => {
    await expect(attachRedisSocketAdapter({}, { redisAdapterEnabled: true, redisUrl: null })).rejects.toThrow("UPSTASH_REDIS_URL");
  });
});
