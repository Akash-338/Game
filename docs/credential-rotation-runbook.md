# Server Credential Rotation Runbook

## Scope

This runbook applies to the server-only Supabase secret API key and the Upstash Redis TLS password used by the Render staging service. It deliberately contains **no credential values**. Browser bundles, committed files, local Windows `.env` files, and documentation must never receive either secret.

## Supabase sequence

Create a new named secret API key in **Settings → API Keys**, update Render to use that replacement, redeploy, and run the redacted staging lifecycle. Only after the service is proven healthy should the exposed secret key be deleted. Supabase states that its secret API keys bypass Row Level Security and that deleting an API key is irreversible.[1]

## Upstash sequence

Record every server-side consumer of the current Redis credential, reset the database password in Upstash, immediately replace the `UPSTASH_REDIS_URL` value in Render, redeploy, and rerun the adapter and lifecycle checks. Upstash documents that its Redis token is the database password and that TLS is enabled by default.[2] The reset-password API changes the database password, so all consumers need the replacement value before verification.[3]

## Validation and closure

The post-rotation validation gate is: `npm run test:cloud-adapters`, followed by the redacted public cloud lifecycle against the Render HTTPS/WSS origin. Verify the health endpoint reports cloud mode and Redis adapter enabled, then verify the old credentials have been removed from every host and local environment that held them. Do not mark the rotation complete until both provider changes and this validation gate pass.

## References

[1]: https://supabase.com/docs/guides/getting-started/api-keys "Supabase: Understanding API keys"
[2]: https://upstash.com/docs/redis/howto/connect-client "Upstash: Connect Your Client"
[3]: https://upstash.com/docs/devops/developer-api/redis/reset_password "Upstash: Reset Password"
