/**
 * Transitional repository adapter for the existing synchronous local runtime.
 *
 * Service rules continue to use the same statements and SQLite transactions in
 * this stage. Keeping those capabilities behind one injected seam lets later
 * migrations replace bounded service flows with asynchronous Supabase methods
 * without changing the default local game path.
 */
export function createSqliteGameRepository({
  sqlite,
  purgeRoomSession
}) {
  return Object.freeze({
    prepare(statement) {
      return sqlite.prepare(statement);
    },
    transaction(callback) {
      return sqlite.transaction(callback);
    },
    purgeRoomSession(roomId) {
      return purgeRoomSession(roomId);
    }
  });
}
