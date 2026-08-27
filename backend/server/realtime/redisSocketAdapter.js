import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";

export async function attachRedisSocketAdapter(io, runtimeConfig, logger = console) {
  if (!runtimeConfig.redisAdapterEnabled) return { attached: false, reason: "disabled" };
  if (!runtimeConfig.redisUrl) throw new Error("UPSTASH_REDIS_URL is required when the Redis Socket.IO adapter is enabled.");

  const redisOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectTimeout: 8_000
  };
  const publisher = new Redis(runtimeConfig.redisUrl, redisOptions);
  const subscriber = publisher.duplicate(redisOptions);

  try {
    await Promise.all([publisher.connect(), subscriber.connect()]);
    io.adapter(createAdapter(publisher, subscriber, {
      key: "word-impostor:socket.io",
      publishOnSpecificResponseChannel: true
    }));
    return {
      attached: true,
      close: async () => Promise.allSettled([publisher.quit(), subscriber.quit()])
    };
  } catch (error) {
    await Promise.allSettled([publisher.quit(), subscriber.quit()]);
    logger.error("Redis Socket.IO adapter could not be attached; cloud mode will not start.", { message: error.message });
    throw error;
  }
}
