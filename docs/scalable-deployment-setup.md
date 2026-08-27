# Provider-Ready Deployment Setup

## Purpose and current boundary

The completed local game remains the authoritative JavaScript/JSX implementation. The repository now uses a physical `frontend/` and `backend/` split: the browser UI is canonical under `frontend/src`, while the Socket.IO server, migrations, scripts, and shared protocol helpers are canonical under `backend/`. A dedicated Supabase project and Upstash Redis instance exist with managed server-only credentials. The active local development path still uses SQLite as an explicit rollback while cloud-mode service parity is completed; the hosted backend target is server-side Supabase persistence.

| Deployment responsibility | Staged workspace | Current implementation | Target managed service |
|---|---|---|---|
| Static game client | `frontend/` | React/JSX under `frontend/src/` | Vercel or equivalent CDN-hosted frontend |
| Authoritative game rules | `backend/server/` | Express and Socket.IO under `backend/server/` | Persistent container or managed Node service |
| Durable room data | Future backend adapter | Local SQLite | Supabase PostgreSQL |
| Cross-instance room fan-out | Future backend adapter | In-process Socket.IO rooms | Redis-compatible service such as Upstash Redis |
| Custom word-pack files | Future storage adapter | Local data directory | Supabase Storage or S3-compatible object storage |

## Required provider decisions

Before a production migration, choose the actual services and make the owner of each account available to configure secrets. The recommended combination is Vercel for the static frontend, Supabase for PostgreSQL and Storage, and Upstash Redis for transient Socket.IO coordination. An equivalent stack is acceptable if it supports a persistent Node WebSocket service, PostgreSQL, Redis, object storage, TLS, custom environment variables, and health checks.

| Required input | Why it is needed | Do not commit |
|---|---|---|
| Frontend URL and custom domain | Sets `VITE_REALTIME_URL` and backend `CORS_ORIGIN` | Domain credentials or DNS tokens |
| PostgreSQL connection URL | Backs durable rooms, players, rounds, ballots, messages, scores, and word-pack metadata | Database password and service role key |
| Redis connection URL | Coordinates Socket.IO rooms, presence, rate limits, and distributed locks | Redis token |
| Object-storage bucket and credentials | Stores user-uploaded word packs | Storage access key or service role key |
| Backend host and region | Keeps WebSocket connections near the selected database/Redis region | Provider access tokens |

## Environment model

The frontend may expose only `VITE_REALTIME_URL`, an HTTPS backend origin. The backend keeps `WORD_IMPOSTOR_POSTGRES_URL`, `UPSTASH_REDIS_URL`, and storage credentials private. In development, leave `VITE_REALTIME_URL` unset so the client connects to the local same-origin Socket.IO server; leave `CORS_ORIGIN` unset to preserve the present permissive local workflow. In production, set both to explicit deployed origins and use a comma-separated `CORS_ORIGIN` allowlist when preview environments are needed. The backend’s `/api/health` response reports only whether the dedicated external configuration is present; it never exposes credentials.

## Migration sequence

First, review the staged `backend/migrations/001_initial_game_schema.sql` PostgreSQL migration, which mirrors current authoritative room, role, clue, voting, direct-message, score, and word-pack records while retaining JavaScript-compatible epoch-millisecond timestamps. Apply `002_enable_backend_only_rls.sql` before exposing any Supabase URL or key: it enables Row Level Security and revokes anon/authenticated table access so the game remains backend-mediated. Apply `003_add_foreign_key_indexes.sql` to cover room, vote, score, and message foreign-key relationships reported by the Supabase performance advisor. The applied `004_cloud_repository_foundations.sql` adds server-only category-word records, a game-operation idempotency ledger, and locked transactional RPC groundwork. Run `npm run seed:supabase-category-packs` only from a server environment with managed Supabase credentials; it synchronizes the six current category packs and prints no secrets. `npm run test:cloud-room-rpc` creates, replays, verifies, and removes a disposable cloud room to validate the first transactional RPC.

The applied `005_cloud_player_lifecycle_rpcs.sql` adds a room-locked, idempotent player join/reclaim RPC and a server-only cascade-cleanup RPC. The applied `006_cloud_round_start_rpc.sql` adds a locked, idempotent round-start transaction that reserves one pack-scoped word, records its use, assigns roles, creates score rows, and opens clue play in one commit. The applied `007_cloud_hint_submission_rpc.sql` adds turn-ordered, duplicate-safe clue submission with a locked two-cycle opening gate and automatic voting transition. The reviewed `008_cloud_vote_cast_rpc.sql` adds server-only, idempotent ballot casting, including self-target protection, eligible-candidate validation, Skip Vote, and safe public ballot events. The disposable cloud check now verifies creation, replay, join, reclaim, round start/replay, two ordered clue cycles, automatic voting opening, three ballot submissions/replay, and cleanup. Vote tally resolution, score awards, eliminations, runoffs, and results remain separate transactional work. The local Socket.IO service still calls SQLite.

Next, extend repository interfaces and test each PostgreSQL operation alongside the local rollback adapter. The applied migration sequence now includes transactional room, player, round, clue, ballot, tally, continuation, direct-message, discussion, lobby, presence, and host-control foundations through `015_cloud_host_controls_rpcs.sql`. Complete the remaining asynchronous Socket.IO service dispatch and validate it behind an explicit non-production cloud flag. Activate the Redis-backed Socket.IO adapter only after game-service parity is complete. Then deploy the Supabase-backed backend to a WebSocket-compatible Node host and set the frontend’s `VITE_REALTIME_URL`.

> The current workspace build is a migration boundary, not a declaration that the SQLite server can safely scale horizontally. Do not place multiple live backend instances behind a load balancer until the PostgreSQL and Redis adapters are complete.

## Required validation gates

Use `npm run test:deployment-boundary`, `npm run validate:postgres-schema`, and `npm run build:frontend` to validate the local workspace boundary. Before any public cutover, run the full game regression suite, verify a four-player production room, test direct-message visibility from sender and recipient only, exercise creator Host/Player switching and recovery, and verify a backend restart does not duplicate messages, votes, scores, or eliminations. Retain the local SQLite path only as a development rollback until those checks pass in the production-like environment.
