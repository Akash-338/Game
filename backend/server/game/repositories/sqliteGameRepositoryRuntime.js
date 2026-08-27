import database, { purgeRoomSession } from "../db.js";
import { createSqliteGameRepository } from "./sqliteGameRepository.js";

const sqliteGameRepository = createSqliteGameRepository({
  sqlite: database,
  purgeRoomSession
});

export default sqliteGameRepository;
