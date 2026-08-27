import tls from "node:tls";
import { describe, expect, test } from "vitest";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
const upstashRedisUrl = process.env.UPSTASH_REDIS_URL;
const cloudCredentialsAvailable = Boolean(supabaseUrl && supabaseSecret && upstashRedisUrl);
const cloudTest = cloudCredentialsAvailable ? test : test.skip;

function pingRedisAttempt(redisUrl) {
  const url = new URL(redisUrl);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: url.hostname, port: Number(url.port || 6379), servername: url.hostname }, () => {
      const password = decodeURIComponent(url.password);
      socket.write(`*2\r\n$4\r\nAUTH\r\n$${Buffer.byteLength(password)}\r\n${password}\r\n*1\r\n$4\r\nPING\r\n`);
    });
    let received = "";
    socket.setTimeout(8_000, () => socket.destroy(new Error("Redis credential validation timed out.")));
    socket.on("data", (chunk) => {
      received += chunk.toString("utf8");
      if (received.includes("+PONG")) {
        socket.end();
        resolve();
      }
    });
    socket.on("error", reject);
  });
}

async function pingRedis(redisUrl, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await pingRedisAttempt(redisUrl);
    } catch (error) {
      lastError = error;
      const retryable = ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"].includes(error?.code);
      if (!retryable || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  throw lastError;
}

describe("cloud credential smoke checks", () => {
  cloudTest("uses only server-side credentials to access Supabase and the TLS Redis endpoint", async () => {
    const response = await fetch(`${supabaseUrl}/rest/v1/rooms?select=id&limit=1`, {
      headers: { apikey: supabaseSecret, Authorization: `Bearer ${supabaseSecret}` }
    });
    expect(response.ok).toBe(true);
    await expect(pingRedis(upstashRedisUrl)).resolves.toBeUndefined();
  }, 28_000);
});
