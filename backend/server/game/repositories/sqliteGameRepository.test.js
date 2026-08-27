import { describe, expect, it, vi } from "vitest";
import { createSqliteGameRepository } from "./sqliteGameRepository.js";

describe("sqlite game repository", () => {
  it("delegates statements, transactions, and session purge without changing the local contract", () => {
    const statement = { get: vi.fn(() => ({ id: "room-1" })) };
    const prepare = vi.fn(() => statement);
    const transaction = vi.fn((callback) => (...args) => callback(...args));
    const purgeRoomSession = vi.fn();
    const repository = createSqliteGameRepository({
      sqlite: { prepare, transaction },
      purgeRoomSession
    });

    expect(repository.prepare("SELECT id FROM rooms").get()).toEqual({ id: "room-1" });
    expect(prepare).toHaveBeenCalledWith("SELECT id FROM rooms");

    expect(repository.transaction((value) => value + 1)(4)).toBe(5);
    expect(transaction).toHaveBeenCalledTimes(1);

    repository.purgeRoomSession("room-1");
    expect(purgeRoomSession).toHaveBeenCalledWith("room-1");
  });
});
