import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

// Compile the production helpers without changing their runtime behavior.
const compiled = ts.transpileModule(fs.readFileSync(new URL('../lib/google-oidc.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/from 'jose'/g, `from ${JSON.stringify(import.meta.resolve('jose'))}`);
const oidcUrl = 'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64');
const oidc = await import(oidcUrl);
const { googleConfig, safeReturnTo, randomToken, tokenHash, authCookie, authCookieName,
  cookieValue, authorizationRequest, exchangeCode, verifyGoogleToken } = oidc;
const values = {
  GOOGLE_CLIENT_ID: '123456789-test.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-secret',
  AUTH_ORIGIN: 'https://idvera.example',
};
const config = googleConfig(values);
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwks = { keys: [{ ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256' }] };
const keys = createLocalJWKSet(jwks);
const now = Math.floor(Date.now() / 1000);
const claims = { iss: 'https://accounts.google.com', aud: config.clientId,
  sub: 'google-test-subject', email: 'person@example.com', email_verified: true,
  name: 'Test Person', nonce: 'test-nonce', iat: now, exp: now + 300 };
const sign = (changes = {}, key = privateKey) => new SignJWT({ ...claims, ...changes })
  .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(key);
const invalidIdentity = { code: 'invalid_identity' };

test('Configuration requires client ID, secret and a trusted origin', () => {
  assert.equal(config.callbackUrl, 'https://idvera.example/auth/google/callback');
  assert.equal(config.secure, true);
  for (const key of Object.keys(values)) assert.equal(googleConfig({ ...values, [key]: '' }), null);
  for (const origin of ['http://idvera.example', 'https://user:pass@idvera.example',
    'https://idvera.example/path', 'https://idvera.example/?x=1', 'https://idvera.example/#x']) {
    assert.equal(googleConfig({ ...values, AUTH_ORIGIN: origin }), null);
  }
  assert.equal(googleConfig({ ...values, GOOGLE_CLIENT_ID: 'not-a-google-client' }), null);
});
test('HTTP cookies are allowed only for explicitly enabled loopback development', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const local = { ...values, AUTH_ORIGIN: `http://${host}:5173` };
    assert.equal(googleConfig(local), null);
    assert.equal(googleConfig(local, true).secure, false);
  }
  assert.equal(googleConfig({ ...values, AUTH_ORIGIN: 'http://other.example' }, true), null);
});
test('Return paths reject external redirects and authentication loops', () => {
  for (const path of [undefined, ['//evil.example'], 'https://evil.example', '//evil.example',
    '/\\evil.example', '/\r\nLocation: https://evil.example', '/auth/google/start',
    '/login?returnTo=/login', '/signin-with-chatgpt', '/signout-with-chatgpt',
    '/callback', '/safe/../auth/logout']) assert.equal(safeReturnTo(path), '/workspace');
  assert.equal(safeReturnTo('/workspace?tab=students#record'), '/workspace?tab=students#record');
  assert.equal(safeReturnTo('/account'), '/account');
});
test('PKCE flow binds independent state and browser tokens and expires in ten minutes', async () => {
  const result = await authorizationRequest(config, '/workspace?tab=students', 'existing-owner', now);
  const url = new URL(result.url), state = url.searchParams.get('state');
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('redirect_uri'), config.callbackUrl);
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), await tokenHash(result.flow.verifier));
  assert.equal(result.flow.stateHash, await tokenHash(state));
  assert.equal(result.flow.browserHash, await tokenHash(result.browserToken));
  assert.equal(result.flow.nonce, url.searchParams.get('nonce'));
  assert.equal(result.flow.expiresAt, now + 600);
  assert.equal(result.flow.linkOwnerId, 'existing-owner');
  assert.equal(result.flow.returnTo, '/workspace?tab=students');
  assert.equal(new Set([state, result.browserToken, result.flow.nonce, result.flow.verifier]).size, 4);
  assert(!result.url.includes(config.clientSecret));
});
test('Session and flow cookies are host-only, HttpOnly and same-site', () => {
  for (const kind of ['session', 'flow']) {
    const cookie = authCookie(kind, 'token', true, 600);
    assert(cookie.startsWith(`__Host-idvera_${kind}=token;`));
    for (const part of ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=600', 'Secure']) assert(cookie.includes(part));
    assert(!cookie.includes('Domain='));
    assert(authCookie(kind, '', true, 0).includes('Max-Age=0'));
    assert.equal(authCookieName(kind, false), `idvera_${kind}`);
    assert(!authCookie(kind, 'token', false, 600).includes('Secure'));
  }
  assert.equal(cookieValue('other=a; __Host-idvera_session=opaque', '__Host-idvera_session'), 'opaque');
  assert.equal(cookieValue(null, '__Host-idvera_session'), '');
  assert.equal(cookieValue('other=a', '__Host-idvera_session'), '');
  assert.match(randomToken(), /^[A-Za-z0-9_-]{43}$/);
});
test('Code exchange sends the verifier and credentials only to Google token endpoint', async () => {
  const token = await exchangeCode(config, 'one-time-code', 'test-verifier', async (url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(init.method, 'POST');
    const body = new URLSearchParams(init.body);
    assert.equal(body.get('client_id'), config.clientId);
    assert.equal(body.get('client_secret'), config.clientSecret);
    assert.equal(body.get('code'), 'one-time-code');
    assert.equal(body.get('code_verifier'), 'test-verifier');
    assert.equal(body.get('redirect_uri'), config.callbackUrl);
    assert.equal(body.get('grant_type'), 'authorization_code');
    return Response.json({ id_token: 'signed-id-token' });
  });
  assert.equal(token, 'signed-id-token');
  await assert.rejects(exchangeCode(config, 'code', 'verifier', async () => new Response('', { status: 400 })), { code: 'exchange_failed' });
  await assert.rejects(exchangeCode(config, 'code', 'verifier', async () => Response.json({ access_token: 'wrong-token-type' })), { code: 'exchange_failed' });
});
test('Signed Google identity accepts both supported issuers and verified claims', async () => {
  for (const iss of ['https://accounts.google.com', 'accounts.google.com']) {
    assert.deepEqual(await verifyGoogleToken(await sign({ iss }), config.clientId, claims.nonce, keys), {
      subject: claims.sub, email: claims.email, name: claims.name,
    });
  }
});
for (const [title, changes] of [
  ['wrong issuer', { iss: 'https://evil.example' }],
  ['wrong audience', { aud: 'different-client' }],
  ['wrong nonce', { nonce: 'other-browser' }],
  ['missing nonce', { nonce: undefined }],
  ['expired token', { exp: now - 60 }],
  ['stale token', { iat: now - 700 }],
  ['future token', { iat: now + 60 }],
  ['missing expiry', { exp: undefined }],
  ['unverified email', { email_verified: false }],
  ['truthy email verification', { email_verified: 'true' }],
  ['missing subject', { sub: undefined }],
  ['empty subject', { sub: '' }],
  ['invalid email', { email: 'invalid-email' }],
  ['wrong authorized party', { azp: 'other-client' }],
  ['multiple audiences without authorized party', { aud: [config.clientId, 'other-client'] }],
]) test(`Identity rejects ${title}`, async () => {
  await assert.rejects(verifyGoogleToken(await sign(changes), config.clientId, claims.nonce, keys), invalidIdentity);
});
test('Identity rejects an invalid signature and unsigned tokens', async () => {
  const other = await generateKeyPair('RS256');
  await assert.rejects(verifyGoogleToken(await sign({}, other.privateKey), config.clientId, claims.nonce, keys), invalidIdentity);
  const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
  await assert.rejects(verifyGoogleToken(unsigned, config.clientId, claims.nonce, keys), invalidIdentity);
});
test('Multiple audiences require the matching authorized party', async () => {
  assert.equal((await verifyGoogleToken(await sign({ aud: [config.clientId, 'other-client'], azp: config.clientId }), config.clientId, claims.nonce, keys)).subject, claims.sub);
});

// Exercise the production server functions against the actual SQL migrations.
// Only the framework request context and Google network responses are supplied locally.
test('Server flow: link ownership, replay prevention, sessions, conflicts and sign-out', async (t) => {
  const { DatabaseSync } = await import('node:sqlite');
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const migration of ['0000_nosy_human_cannonball.sql', '0001_perfect_tana_nile.sql', '0002_greedy_nuke.sql']) {
    sql.exec(fs.readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), 'utf8'));
  }
  const prepare = (query, args = []) => ({
    bind: (...bound) => prepare(query, bound),
    first: async () => sql.prepare(query).get(...args) ?? null,
    run: async () => sql.prepare(query).run(...args),
  });
  const env = { ...values, AUTH_PROVIDER: 'sites', DB: { prepare, batch: async (statements) => {
    sql.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } } };
  const owner = { userId: 'existing-owner', email: 'owner@example.com', displayName: 'Existing Owner', fullName: null };
  const context = { env, requestHeaders: new Headers(), user: owner };
  globalThis.__idveraAuthTest = context;
  const contextUrl = 'data:text/javascript;base64,' + Buffer.from(`
    export const env = globalThis.__idveraAuthTest.env;
    export async function headers() { return globalThis.__idveraAuthTest.requestHeaders; }
    export async function getChatGPTUser() { return globalThis.__idveraAuthTest.user; }
  `).toString('base64');
  let serverCode = ts.transpileModule(fs.readFileSync(new URL('../lib/google-auth-server.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const path of ['cloudflare:workers', 'next/headers', '../app/chatgpt-auth']) serverCode = serverCode.replace(`from '${path}'`, `from ${JSON.stringify(contextUrl)}`);
  serverCode = serverCode.replace("from './google-oidc'", `from ${JSON.stringify(oidcUrl)}`).replace('import.meta.env.DEV', 'false');
  const server = await import('data:text/javascript;base64,' + Buffer.from(serverCode).toString('base64'));
  const originalFetch = globalThis.fetch;
  let tokenClaims = {};
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json(jwks);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ id_token: await sign(tokenClaims) });
    throw new Error('Unexpected network request');
  };
  t.after(() => { globalThis.fetch = originalFetch; delete globalThis.__idveraAuthTest; sql.close(); });
  const request = (path, options = {}) => new Request(config.origin + path, options);
  const start = async (path = '/auth/google/start?mode=link') => {
    const response = await server.startGoogleSignIn(request(path));
    const url = new URL(response.headers.get('location'));
    const cookie = response.headers.get('set-cookie').split(';')[0];
    tokenClaims = { nonce: url.searchParams.get('nonce') };
    return { state: url.searchParams.get('state'), cookie };
  };
  const finish = (flow, extras = '') => server.finishGoogleSignIn(request(`/auth/google/callback?state=${flow.state}&code=test-code${extras}`, { headers: { cookie: flow.cookie } }));
  await t.test('Account linking requires an existing authenticated Sites user', async () => {
    context.user = null;
    const response = await server.startGoogleSignIn(request('/auth/google/start?mode=link'));
    assert.equal(response.headers.get('location'), '/signin-with-chatgpt?return_to=%2Faccount');
    context.user = owner;
  });
  await t.test('Incorrect origins cannot start an OAuth flow', async () => {
    const response = await server.startGoogleSignIn(new Request('https://other.example/auth/google/start?mode=link'));
    assert.equal(response.headers.get('location'), '/login?error=configuration');
  });
  let linkedSession;
  await t.test('Linking preserves existing owner IDs and stores only hashed session tokens', async () => {
    sql.prepare('INSERT INTO institutions (id,owner_id,code,payload) VALUES (?,?,?,?)').run('existing-institution', owner.userId, 'TEST', '{}');
    const flow = await start();
    const response = await finish(flow);
    assert.equal(response.headers.get('location'), '/account?linked=1');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    linkedSession = response.headers.getSetCookie().find(c => c.startsWith('__Host-idvera_session=')).split(';')[0];
    assert.equal(sql.prepare('SELECT owner_id FROM google_accounts').get().owner_id, owner.userId);
    assert.equal(sql.prepare('SELECT owner_id FROM institutions').get().owner_id, owner.userId);
    assert.equal(sql.prepare('SELECT token_hash FROM auth_sessions').get().token_hash, await tokenHash(linkedSession.split('=')[1]));
    assert.equal(sql.prepare('SELECT action FROM audit_events').get().action, 'GOOGLE_ACCOUNT_LINKED');
    assert.equal((await finish(flow)).headers.get('location'), '/login?error=expired_flow');
  });
  await t.test('Mismatched browser cookies cannot consume another browser’s flow', async () => {
    const flow = await start();
    assert.equal((await finish({ ...flow, cookie: `__Host-idvera_flow=${randomToken()}` })).headers.get('location'), '/login?error=expired_flow');
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM oauth_flows').get().n, 1);
    assert.equal((await finish(flow)).headers.get('location'), '/account?linked=1');
  });
  await t.test('Google cancellation consumes the flow without creating a session', async () => {
    const before = sql.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n;
    const flow = await start();
    assert.equal((await finish(flow, '&error=access_denied')).headers.get('location'), '/account?error=cancelled');
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n, before);
    assert.equal((await finish(flow)).headers.get('location'), '/login?error=expired_flow');
  });
  await t.test('A Google account cannot be linked to a different workspace', async () => {
    context.user = { ...owner, userId: 'another-owner' };
    assert.equal((await finish(await start())).headers.get('location'), '/account?error=account_conflict');
    assert.equal(sql.prepare('SELECT owner_id FROM google_accounts').get().owner_id, owner.userId);
    context.user = owner;
  });
  await t.test('Workspace authentication uses the stored session and rejects expiry', async () => {
    context.requestHeaders = new Headers({ cookie: linkedSession });
    assert.equal((await server.getGoogleUser()).userId, owner.userId);
    const hash = await tokenHash(linkedSession.split('=')[1]);
    sql.prepare('UPDATE auth_sessions SET expires_at=? WHERE token_hash=?').run(now - 1, hash);
    assert.equal(await server.getGoogleUser(), null);
    sql.prepare('UPDATE auth_sessions SET expires_at=? WHERE token_hash=?').run(now + 300, hash);
  });
  await t.test('Google sign-in returns to the requested workspace using the linked owner', async () => {
    env.AUTH_PROVIDER = 'google';
    const response = await finish(await start('/auth/google/start?returnTo=%2Fworkspace%3Ftab%3Dstudents'));
    assert.equal(response.headers.get('location'), '/workspace?tab=students');
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM google_accounts').get().n, 1);
  });
  await t.test('Logout rejects other origins, then revokes the session and appends an audit event', async () => {
    context.requestHeaders = new Headers({ cookie: linkedSession });
    assert.equal((await server.signOutGoogle(request('/auth/logout', { method: 'POST', headers: { origin: 'https://other.example', cookie: linkedSession } }))).status, 403);
    assert(await server.getGoogleUser());
    const response = await server.signOutGoogle(request('/auth/logout', { method: 'POST', headers: { origin: config.origin, cookie: linkedSession } }));
    assert.equal(response.headers.get('location'), '/login');
    assert(response.headers.get('set-cookie').includes('Max-Age=0'));
    assert.equal(await server.getGoogleUser(), null);
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='GOOGLE_SIGN_OUT'").get().n, 1);
    assert.throws(() => sql.exec('DELETE FROM audit_events'), /append-only/);
  });
});
