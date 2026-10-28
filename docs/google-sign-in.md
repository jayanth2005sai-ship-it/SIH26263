# Google sign-in setup

The application has a Google OpenID Connect authorization-code flow with PKCE, state and nonce checks, verification of Google's signed ID tokens, opaque database-backed sessions, account linking and sign-out revocation. It is staged behind `AUTH_PROVIDER`: the current Sites authentication remains active until Google is configured and account linking is complete.

## 1. Create the Google OAuth client

1. Open [Google Auth Platform in Google Cloud Console](https://console.cloud.google.com/auth/overview), select a project or create one, and complete **Branding** with app name **IDVERA**, your support email and your contact email.
2. Under **Audience**, choose the audience appropriate to your Google account. If the app is in testing, add the Google account you will use under **Test users**.
3. Under **Clients**, create an OAuth client with application type **Web application**.
4. Add this exact **Authorized redirect URI**:

   ```text
   https://idvera-regulatory-demo.jocundmink9.chatgpt.site/auth/google/callback
   ```

5. Save the client. Copy the client ID and client secret. The server flow requests only `openid email profile`; it does not request student data access, Drive, Gmail or offline access. A JavaScript origin is not required by this server redirect flow.

## 2. Configure secrets

Configure these production runtime values through Sites:

```text
GOOGLE_CLIENT_ID=<the web client ID ending in .apps.googleusercontent.com>
GOOGLE_CLIENT_SECRET=<the client secret>
AUTH_ORIGIN=https://idvera-regulatory-demo.jocundmink9.chatgpt.site
AUTH_PROVIDER=sites
```

Keep the client secret out of chat and Git. If configuring through this coding session, put the values in the ignored file `.env.google-setup.local` in this checkout, then tell the agent that the file is ready. The agent can transfer them to Sites as secrets without displaying their values. This file is a secure handoff, not an application configuration source. Runtime values must be configured in Sites and applied with a deployment.

## 3. Preserve existing records

After the credentials have been applied, open `/account` while still signed in through the existing Sites account. Choose **Continue with Google**, select your Google account and complete consent. This explicitly links the verified Google subject to your existing workspace owner ID. Existing institution, student, batch and audit records keep their owner ID; no email-based automatic account merge occurs.

## 4. Activate Google

Set `AUTH_PROVIDER=google` and deploy. The private Sites gate currently requires ChatGPT sign-in before requests reach the app. Replacing that gate completely requires the owner's explicit approval to make the hosting audience public while the application continues to protect `/workspace`, `/account` and all workspace APIs with Google sessions. Public hosting must not be enabled merely to deploy a change.

Without that access change, Google can be used inside the existing private Sites gate, so visitors would still pass through ChatGPT first. Activation is not complete until the chosen access mode and a real Google login/logout have been verified.

## Local development and checks

Use a separate testing OAuth client or add a local callback such as `http://127.0.0.1:5173/auth/google/callback`. Put local values in ignored `.dev.vars`, use the matching `AUTH_ORIGIN`, and apply the generated authentication migration to local D1. HTTP cookies are permitted only for loopback development; hosted sessions use Secure, HttpOnly cookies.

`node tests/google-auth.test.mjs` checks signed token validation, issuer/audience/nonce/expiry handling, PKCE, cookies, redirects and code exchange. Server integration checks apply all three real SQLite migrations and exercise account ownership preservation, conflicting links, one-time callbacks, browser binding, session expiry and logout revocation. Google responses are supplied locally; these offline tests do not prove a live Google OAuth client is configured.

References: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [ID token validation](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [jose](https://github.com/panva/jose).
