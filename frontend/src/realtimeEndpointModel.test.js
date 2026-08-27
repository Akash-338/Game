import { describe, expect, test } from "vitest";
import { resolveRealtimeUrl } from "./realtimeEndpointModel.js";

describe("resolveRealtimeUrl", () => {
  test("keeps local same-origin Socket.IO behaviour when no external endpoint is configured", () => {
    expect(resolveRealtimeUrl()).toBeUndefined();
    expect(resolveRealtimeUrl("   ")).toBeUndefined();
  });

  test("normalizes an externally deployed realtime endpoint", () => {
    expect(resolveRealtimeUrl("https://realtime.example.com/")).toBe("https://realtime.example.com");
  });
});
