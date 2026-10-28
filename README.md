# IDVERA

An institutional verification workspace with student records, CSV validation and batch import, temporal collision candidates, intake accounting, human review decisions, sandbox verification and an append-only audit history.

The landing page is `/`; the application is `/workspace`. The Site retains its existing private audience. Signed-in users own separate records in Cloudflare D1. The verifier checks workspace records and is not connected to the live APAAR registry. Sample datasets are synthetic.

## Local development

Requires Node 22.13+ and npm. Install with `npm ci`, then build with `npm run build`. Apply the three generated migrations once to a fresh local database:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_nosy_human_cannonball.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_perfect_tana_nile.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_greedy_nuke.sql
npm run dev
```

Visit the local server's `/signin-with-chatgpt?return_to=/workspace` route to use the starter's local sign-in. Hosted authentication is managed by Sites.

Google sign-in is staged at `/login`, with account linking at `/account`. Configure the OAuth client and link your existing workspace before activating it; see [Google sign-in setup](docs/google-sign-in.md). Until activation, the existing Sites sign-in remains in use.

## Validation

```sh
node tests/domain.test.mjs
node tests/google-auth.test.mjs
npx tsc --noEmit
npm run build
```

The 24 domain tests cover V-01–V-12, temporal overlaps, transfers, heuristic similarity, CSV parsing and safe exports. The authentication tests cover signed-token validation, PKCE, cookies, redirects and code exchange, plus account linking, session expiry, replay prevention, ownership conflicts and logout against the actual SQLite migrations with local Google responses. These checks do not verify a live Google OAuth client. Browser checks exercise saved records, CSV upload/preview/import/retry, human adjudication, all verification outcomes, identifier masking, responsive layouts and a 225-row batch.

## Behavior

- Programme admission windows and quota ceilings are explicit configuration. Sample values do not imply external regulatory approval.
- Imports support up to 2,000 rows and 2 MB. Rejected rows remain in the saved report and are never enrolled. Accepted and flagged records, the batch report and its audit event are committed atomically.
- Batch identifiers make retries idempotent. Potential collisions can be cleared by a reviewer with a rationale. Changed evidence invalidates a clearance; statutory findings require correction.
- Database triggers reject updates and deletes to audit events and review decisions. API responses and downloads mask APAAR identifiers.

See [the video feature mapping](docs/video-features.md) for implementation coverage. Built with React 19, TypeScript, Vinext/Vite and Cloudflare D1, deployed through Sites.
