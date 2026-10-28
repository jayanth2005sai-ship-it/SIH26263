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

test('Vercel sign-in stores Google identities, blocks legacy linking and revokes sessions', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { createClient } = await import('@libsql/client');
  const directory = mkdtempSync(join(tmpdir(), 'idvera-vercel-auth-'));
  const url = `file:${join(directory, 'test.db')}`;
  const oldEnv = Object.fromEntries(['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'AUTH_ORIGIN'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { TURSO_DATABASE_URL: url, GOOGLE_CLIENT_ID: config.clientId,
    GOOGLE_CLIENT_SECRET: config.clientSecret, AUTH_ORIGIN: config.origin });
  execFileSync(process.execPath, [new URL('../scripts/migrate-libsql.mjs', import.meta.url).pathname], { env: process.env });
  const db = createClient({ url });
  const context = { requestHeaders: new Headers() };
  globalThis.__idveraAuthTest = context;
  const headersUrl = 'data:text/javascript;base64,' + Buffer.from('export async function headers(){return globalThis.__idveraAuthTest.requestHeaders}').toString('base64');
  const compile = path => ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const adapterCode = compile('../lib/vercel-database.ts').replace("import 'server-only';", '')
    .replace("from '@libsql/client'", `from ${JSON.stringify(import.meta.resolve('@libsql/client'))}`);
  const adapterUrl = 'data:text/javascript;base64,' + Buffer.from(adapterCode).toString('base64');
  const serverCode = compile('../lib/google-auth-server.ts')
    .replace("from './vercel-database'", `from ${JSON.stringify(adapterUrl)}`)
    .replace("from 'next/headers'", `from ${JSON.stringify(headersUrl)}`)
    .replace("from './google-oidc'", `from ${JSON.stringify(oidcUrl)}`);
  const server = await import('data:text/javascript;base64,' + Buffer.from(serverCode).toString('base64'));
  const originalFetch = globalThis.fetch;
  let tokenClaims = {};
  globalThis.fetch = async input => {
    if (String(input) === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json(jwks);
    if (String(input) === 'https://oauth2.googleapis.com/token') return Response.json({ id_token: await sign(tokenClaims) });
    throw new Error('Unexpected request');
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete globalThis.__idveraAuthTest;
    for (const [key, value] of Object.entries(oldEnv)) value === undefined ? delete process.env[key] : process.env[key] = value;
    db.close(); rmSync(directory, { recursive: true, force: true });
  });
  const request = (path, options = {}) => new Request(config.origin + path, options);
  const start = async () => {
    const response = await server.startGoogleSignIn(request('/auth/google/start?returnTo=%2Fworkspace'));
    const redirect = new URL(response.headers.get('location'));
    tokenClaims = { nonce: redirect.searchParams.get('nonce') };
    return { state: redirect.searchParams.get('state'), flowCookie: response.headers.get('set-cookie').split(';')[0] };
  };
  const finish = (flow, cookie = flow.flowCookie) => server.finishGoogleSignIn(request(`/auth/google/callback?state=${flow.state}&code=test-code`, { headers: { cookie } }));
  await t.test('Sites header linking is rejected', async () => {
    const response = await server.startGoogleSignIn(request('/auth/google/start?mode=link', { headers: { 'oai-authenticated-user-id': 'victim' } }));
    assert.equal(response.headers.get('location'), '/login');
    assert.equal((await db.execute('SELECT COUNT(*) AS n FROM oauth_flows')).rows[0].n, 0);
  });
  let session;
  await t.test('First sign-in creates a stable Google-owned workspace', async () => {
    const flow = await start();
    const response = await finish(flow);
    assert.equal(response.headers.get('location'), '/workspace');
    session = response.headers.getSetCookie().find(value => value.startsWith('__Host-idvera_session=')).split(';')[0];
    assert.equal((await db.execute('SELECT owner_id FROM google_accounts')).rows[0].owner_id, 'google:' + claims.sub);
    assert.equal((await db.execute('SELECT token_hash FROM auth_sessions')).rows[0].token_hash, await tokenHash(session.split('=')[1]));
    assert.equal((await finish(flow)).headers.get('location'), '/login?error=expired_flow');
  });
  await t.test('Browser cookie binds the flow and prevents another browser from using it', async () => {
    const flow = await start();
    assert.equal((await finish(flow, `__Host-idvera_flow=${randomToken()}`)).headers.get('location'), '/login?error=expired_flow');
    assert.equal((await finish(flow)).headers.get('location'), '/workspace');
    assert.equal((await db.execute('SELECT COUNT(*) AS n FROM google_accounts')).rows[0].n, 1);
  });
  await t.test('Session lookup and logout use the database', async () => {
    context.requestHeaders = new Headers({ cookie: session });
    assert.equal((await server.getGoogleUser()).userId, 'google:' + claims.sub);
    const wrong = await server.signOutGoogle(request('/auth/logout', { method: 'POST', headers: { origin: 'https://other.example', cookie: session } }));
    assert.equal(wrong.status, 403);
    const response = await server.signOutGoogle(request('/auth/logout', { method: 'POST', headers: { origin: config.origin, cookie: session } }));
    assert.equal(response.headers.get('location'), '/login');
    assert.equal(await server.getGoogleUser(), null);
  });
  await t.test('Workspace batch writes remain atomic', async () => {
    const { database } = await import(adapterUrl);
    const valid = database.prepare('INSERT INTO institutions (id,owner_id,code,payload) VALUES (?,?,?,?)').bind('batch-test', 'google:test', 'TEST', '{}');
    const invalid = database.prepare('INSERT INTO institutions (id,owner_id,code,payload) VALUES (?,?,?,?)').bind('batch-test', 'google:test', 'TEST', '{}');
    await assert.rejects(database.batch([valid, invalid]));
    const result = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM institutions WHERE id=?', args: ['batch-test'] });
    assert.equal(result.rows[0].n, 0);
  });
});
