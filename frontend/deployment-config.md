# Frontend deployment configuration

Configure the static frontend host with the public build variable shown below. This value is safe to expose in browser code because it is only the HTTPS origin of the public realtime backend.

| Variable | Example | Required for |
|---|---|---|
| `VITE_REALTIME_URL` | `https://realtime.example.com` | A separately deployed backend |

Leave `VITE_REALTIME_URL` unset for the current same-origin local game. Do not append a trailing slash. Do not place database, Redis, storage, or provider service-role credentials in the frontend environment.
