# Frontend deployment boundary

This is the canonical React/JSX game client for a separate static deployment such as Vercel. Its source lives in `src/`, its browser-only assets live in `public/`, and its Vite configuration emits the production bundle into the managed root `../dist/public` directory for the current single-service build.

Set `VITE_REALTIME_URL` to the HTTPS origin of the separately deployed Socket.IO service. Do not include a trailing slash. Leave it unset for the current same-origin local server at port 4300.

`package.json` lists every browser dependency so a Vercel project can safely use `frontend/` as its Root Directory. `vercel.json` declares the Vite preset and an SPA fallback. The deployed frontend must receive only `VITE_REALTIME_URL`; Supabase and Redis credentials stay server-side.
