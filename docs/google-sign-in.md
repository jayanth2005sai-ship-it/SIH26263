# Google sign-in on Vercel

This branch uses Google OpenID Connect with a server-side authorization code exchange, PKCE, state, nonce, signed ID token verification, and database-backed sessions. It does not accept Sites identity headers or link a Google account to a Sites owner ID.

1. In [Google Auth Platform](https://console.cloud.google.com/auth/overview), set up Branding and Audience. Add your Google account as a test user if the app is in testing.
2. Create a **Web application** OAuth client. Add `https://YOUR-VERCEL-DOMAIN/auth/google/callback` as an authorized redirect URI. For local development, add `http://127.0.0.1:3000/auth/google/callback` to a separate testing client.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `AUTH_ORIGIN=https://YOUR-VERCEL-DOMAIN` in Vercel's server environment variables. `AUTH_ORIGIN` must be the exact origin used by visitors, with no path or trailing slash.
4. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, apply migrations, then deploy. Use `/login` for a real sign-in and sign-out check.

The flow requests only `openid email profile`; no student data is sent to Google as part of sign-in. The production cookie is Secure, HttpOnly and SameSite=Lax. Keep credentials out of Git and chat.

Existing Sites data has owner IDs from ChatGPT sign-in. It is not automatically transferred to this independent Vercel database or mapped to a Google account. Plan a reviewed export and owner mapping before retiring the Sites version if existing records must move.
