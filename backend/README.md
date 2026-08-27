# Realtime backend deployment boundary

This workspace contains the deployable Socket.IO service boundary. The server lives in `server/`, database migrations in `migrations/`, operational checks in `scripts/`, and shared protocol helpers in `shared/`. SQLite remains only a local development rollback while the staged backend is completed on server-side Supabase persistence.

For a separate deployment, set `CORS_ORIGIN` to the deployed frontend origin and run `npm run start:backend`. The backend uses server-only Supabase credentials and optional Upstash Redis coordination only after cloud-mode parity is validated.

Do not add Supabase, Redis, or object-storage credentials to this repository. Use the target provider’s environment-variable settings when account access is approved.
