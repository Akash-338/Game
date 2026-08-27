import { describe, expect, it, vi } from "vitest";
import { subscribeToConnectionStatus } from "./socketConnectionModel.js";

describe("subscribeToConnectionStatus", () => {
  it("reflects the current socket state, follows lifecycle events, and removes listeners", () => {
    const handlers = new Map();
    const socket = {
      connected: false,
      on: vi.fn((event, handler) => handlers.set(event, handler)),
      off: vi.fn()
    };
    const update = vi.fn();

    const unsubscribe = subscribeToConnectionStatus(socket, update);
    expect(update).toHaveBeenLastCalledWith(false);

    handlers.get("connect")();
    handlers.get("disconnect")();
    expect(update.mock.calls).toEqual([[false], [true], [false]]);

    unsubscribe();
    expect(socket.off).toHaveBeenCalledWith("connect", handlers.get("connect"));
    expect(socket.off).toHaveBeenCalledWith("disconnect", handlers.get("disconnect"));
  });
});
