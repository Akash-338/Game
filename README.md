# The Word Impostor

The Word Impostor is a real-time social deduction game for a laptop host and phone players. The application uses **JavaScript**, **JSX**, React, Express, and Socket.IO. The canonical application layout is `frontend/` for the browser experience and `backend/` for the realtime server, database migrations, and operational checks. The local SQLite store remains a development rollback only while the Supabase-backed server path is completed and staged.

## Run on the Host Laptop

```bash
npm install
npm run dev
```

Open `http://localhost:4300` on the laptop. Enter **Host1234** to open the host control center, create a room, and give the room code and password to players. For full phone-tunneling instructions, read [`docs/running-locally-and-tunneling.md`](docs/running-locally-and-tunneling.md).

## Useful Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Starts the local live game server on port 4300. |
| `npm test` | Runs JavaScript game-rule tests. |
| `npm run build` | Builds `frontend/` into the managed production static-output directory. |
| `npm run test:host-player` | Checks Host/Player mode, reconnect behavior, and role privacy through Socket.IO. |
| `npm run test:cloud-room-rpc` | Runs the disposable server-only Supabase lifecycle check. |

## Data and Word Packs

The local rollback path creates `backend/data/word-impostor.sqlite`. The built-in word pack is assembled from the six JSON category files in `backend/server/data/categories/`; custom JSON packs uploaded during local development are stored in `backend/data/word-packs/`. These local session and custom-pack files are intentionally ignored by Git, while the built-in category source files remain part of the repository.

## Folder Map

| Folder | Responsibility |
|---|---|
| `frontend/` | React/JSX UI, browser assets, Vite configuration, and Vercel configuration. |
| `backend/server/` | Express and Socket.IO service, game rules, cloud repository, realtime adapter, and automated tests. |
| `backend/migrations/` | Version-controlled, server-only Supabase PostgreSQL migrations. |
| `backend/scripts/` | Validation, build, cloud-flow, and local Socket.IO check scripts. |
| `backend/shared/` | Small protocol helpers shared safely with the browser. |

The complete pre-build scope is documented in [`requirements.txt`](requirements.txt). The architecture-flow sketch is available in [`docs/word-impostor-architecture-flow.mmd`](docs/word-impostor-architecture-flow.mmd).
