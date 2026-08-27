# Backend deployment configuration

Set the following values only in the chosen backend host’s secret/environment-variable manager. They are deliberately not stored in an `.env` file in this repository.

| Variable | Example | Purpose |
|---|---|---|
| `PORT` | `4300` | Service listener, usually supplied by the host |
| `CORS_ORIGIN` | `https://play.example.com` | Comma-separated allowlist of frontend origins |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` | Server-side Supabase Data API endpoint for the dedicated Word Impostor project |
| `SUPABASE_SECRET_KEY` | Provider-issued `sb_secret_...` key | Server-only Supabase credential; never expose it to the client |
| `UPSTASH_REDIS_URL` | TLS `rediss://` URL from Upstash | Future multi-instance Socket.IO coordination through private Redis Pub/Sub |
| `WORD_IMPOSTOR_CLOUD_MODE` | `true` | Enables cloud-mode startup only after cloud repository flow coverage passes |
| `WORD_IMPOSTOR_REDIS_ADAPTER_ENABLED` | `true` | Attaches the Redis Socket.IO adapter only when cloud mode is enabled and a TLS Redis URL is present |
| `WORD_IMPOSTOR_STORAGE_BUCKET` | `word-impostor-packs` | Future custom word-pack storage |

The current backend consumes `PORT`, `CORS_ORIGIN`, and exposes a safe runtime readiness summary at `/api/health`. It remains on SQLite until the cloud repository flow is tested and cloud mode is explicitly enabled. Configuration alone never switches persistence or sends a credential to the browser.

Before enabling either cloud flag in a hosted environment, run `npm run test:cloud-adapters`. Its output must be exactly `CLOUD_ADAPTER_CHECK supabase=ok redis=ok secrets=redacted`; it does not log endpoints, keys, tokens, or passwords.
