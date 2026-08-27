# Realtime Backend Host Options

## Active Staging Backend

The user-approved Render Free service **`word-impostor-realtime-staging`** is deployed in Singapore from `Akash-338/Game-` on the `main` branch. Its public HTTPS/WSS origin is `https://word-impostor-realtime-staging.onrender.com`. It runs the root Node.js workspace with `npm ci` and `node backend/server/index.js`. The provider secret manager contains only the existing Supabase Data API URL/server key, Upstash Redis TLS URL, and the two explicit cloud flags; no browser-facing `VITE_*` credential has been configured.

The redacted public lifecycle check connects to this origin and validates cloud mode plus its Redis Socket.IO adapter before exercising room creation, presence, role-safe snapshots, direct-message privacy, alerts, moderation, hints, voting, tallying, continuation, rejoin, voluntary leave, host recovery, and full room cleanup. The final lifecycle passed against the live service. The backend has no reliance on its ephemeral local filesystem because authoritative cloud sessions use Supabase and cross-instance signaling uses Upstash Redis.

The service deliberately responds with an application JSON `404` at `/` because it is a **backend-only** Socket.IO endpoint; it does not carry the browser bundle. The managed combined deployment still serves `dist/public/index.html` when that bundle is present. A separately deployed frontend must set only `VITE_REALTIME_URL` to this public HTTPS/WSS origin.

## Current Shortlist

Render Free Web Services are a viable **no-cost staging option** for the separately hosted Node.js/Socket.IO backend because Render documents support for inbound public WebSocket connections. The Word Impostor client already has reconnection behavior and will use a single HTTPS/WSS origin through `VITE_REALTIME_URL` once a backend is available.[1][2]

| Criterion | Render Free Web Service | Consequence for The Word Impostor |
| --- | --- | --- |
| WebSocket support | Supported over the public internet. | Suitable for Socket.IO WebSocket transport. |
| Idle behavior | Spins down after 15 minutes with no HTTP or WebSocket traffic; a cold start takes about one minute. | Not suitable for an always-available game endpoint; users can experience delayed reconnection after inactivity. |
| Runtime durability | Local files are ephemeral after redeploy, restart, or spin-down. | Safe only because cloud mode persists authoritative rooms in Supabase and shared Socket.IO coordination uses Upstash Redis. |
| Scaling | Free services cannot scale beyond one instance. | A staging/backend proof only; not a thousands-user production target. |
| Availability | Free services can restart at any time. | Client reconnect and host recovery must be validated before use. |

## Decision Gate

The user requested **no paid subscription**. Therefore, Render Free may be used only after cloud service parity is proven and only with explicit acknowledgement of its sleep, restart, and monthly-use limitations. It will not be described as a reliable persistent-production service. A future paid persistent host or a managed reserved runtime would require a separate cost review and user approval.

## Required Deployment Controls

The backend receives `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `UPSTASH_REDIS_URL` only through the host’s secret manager. The staging service has `WORD_IMPOSTOR_CLOUD_MODE=true` and `WORD_IMPOSTOR_REDIS_ADAPTER_ENABLED=true`; its public lifecycle now verifies both flags through the redacted health response. `CORS_ORIGIN` remains optional: when unset, the server accepts any public origin, which is appropriate only for this temporary staging endpoint. Before a separate frontend production deployment, set it to the final frontend origin. The Vercel frontend will receive only `VITE_REALTIME_URL`; no database or Redis credential may be browser-visible.

## References

[1]: https://render.com/docs/websocket "Render: WebSockets on Render"
[2]: https://render.com/docs/free "Render: Deploy for Free"
