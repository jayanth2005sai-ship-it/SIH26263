# IDVERA

An institutional verification workspace with student records, CSV validation and batch import, temporal collision candidates, intake accounting, human review decisions, sandbox verification and an append-only audit history.

This branch runs as a Next.js application on Vercel. The landing page is `/`; the Google-protected workspace is `/workspace`. Each verified Google account owns separate records in a persistent SQLite database such as Turso. The verifier checks workspace records and is not connected to the live APAAR registry. Sample datasets are synthetic.

## Local development

Requires Node 22.13+ and npm. Copy `.env.example` to ignored `.env.local`; use `TURSO_DATABASE_URL=file:./idvera-local.db` for local development and a local Google OAuth web client with `AUTH_ORIGIN=http://127.0.0.1:3000`. Then run:

```sh
npm ci
npm run db:migrate
npm run dev
```

Visit `/login` to sign in with Google. See [Vercel deployment setup](docs/vercel-deployment.md) and [Google sign-in setup](docs/google-sign-in.md).

## Validation

```sh
node tests/domain.test.mjs
node tests/google-auth.test.mjs
npx tsc --noEmit
npm run build
```

The 24 domain tests cover V-01–V-12, temporal overlaps, transfers, heuristic similarity, CSV parsing and safe exports. Authentication checks cover signed token validation, PKCE, browser-bound callbacks, sessions and logout against the actual SQLite migrations with local Google responses. These checks do not verify a live Google OAuth client.

## Behavior

- Programme admission windows and quota ceilings are explicit configuration. Sample values do not imply external regulatory approval.
- Imports support up to 2,000 rows and 2 MB. Rejected rows remain in the saved report and are never enrolled. Accepted and flagged records, the batch report and its audit event are committed atomically.
- Batch identifiers make retries idempotent. Potential collisions can be cleared by a reviewer with a rationale. Changed evidence invalidates a clearance; statutory findings require correction.
- Database triggers reject updates and deletes to audit events and review decisions. API responses and downloads mask APAAR identifiers.

See [the video feature mapping](docs/video-features.md) for implementation coverage. Built with React 19, Next.js 16, TypeScript and libSQL.
