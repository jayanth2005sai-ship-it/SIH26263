# Deploy IDVERA to Vercel

This `vercel-port` branch builds with `next build`. It uses server-side Google sign-in and libSQL/Turso for persistent SQLite storage. The Sites version remains on its own branch and deployment.

1. Create a persistent Turso database and obtain its URL and auth token. Do not use a local `file:` URL for a Vercel deployment: serverless files do not persist across functions or deployments.
2. Configure `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` as server environment variables. On an administrator machine, set those same values and run `npm run db:migrate` once. The script records applied migrations and can be rerun safely.
3. Create the Google OAuth web client as described in [Google sign-in setup](google-sign-in.md). Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `AUTH_ORIGIN` as server environment variables. Add the exact production callback URL in Google Cloud.
4. Import this repository into Vercel and select the `vercel-port` branch as the source. The framework is Next.js; build command is `npm run build`. Node 22.13 or later is required.
5. Deploy, visit `/login`, complete a real Google sign-in, add a sample institution or student, reload, then sign out and sign back in to verify persistence.

The app has no database or Google credentials in source control. Without those values the login button stays disabled and the workspace cannot operate. Existing records on Sites remain there until explicitly exported and migrated with an owner mapping.
