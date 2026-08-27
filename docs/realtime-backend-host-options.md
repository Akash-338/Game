# Realtime Backend Host Options

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

The backend must receive `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `UPSTASH_REDIS_URL`, and `CORS_ORIGIN` only through the host’s secret manager. `WORD_IMPOSTOR_CLOUD_MODE=true` and `WORD_IMPOSTOR_REDIS_ADAPTER_ENABLED=true` remain prohibited until the service-level cloud parity suite passes. The Vercel frontend receives only `VITE_REALTIME_URL`; no database or Redis credential is browser-visible.

## References

[1]: https://render.com/docs/websocket "Render: WebSockets on Render"
[2]: https://render.com/docs/free "Render: Deploy for Free"
