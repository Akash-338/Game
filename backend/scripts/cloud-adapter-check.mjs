import { Server } from "socket.io";
import { createSupabaseGameRepository } from "../server/cloud/supabaseGameRepository.js";
import { attachRedisSocketAdapter } from "../server/realtime/redisSocketAdapter.js";
import { assertExternalStoreReady, getWordImpostorRuntimeConfig, getWordImpostorRuntimeSecrets } from "../server/runtimeConfig.js";

const runtimeConfig = getWordImpostorRuntimeConfig({
  ...process.env,
  WORD_IMPOSTOR_CLOUD_MODE: "true",
  WORD_IMPOSTOR_REDIS_ADAPTER_ENABLED: "true"
});
const runtimeSecrets = getWordImpostorRuntimeSecrets();

assertExternalStoreReady(process.env);
const repository = createSupabaseGameRepository({
  url: process.env.SUPABASE_URL,
  secretKey: process.env.SUPABASE_SECRET_KEY
});
await repository.healthCheck();

const io = new Server({ transports: ["websocket"] });
const adapter = await attachRedisSocketAdapter(io, { ...runtimeConfig, redisUrl: runtimeSecrets.redisUrl });
if (!adapter.attached) throw new Error("Redis Socket.IO adapter was not attached.");
await adapter.close();

console.log("CLOUD_ADAPTER_CHECK supabase=ok redis=ok secrets=redacted");
