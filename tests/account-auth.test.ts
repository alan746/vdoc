// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { serializeSignedCookie } from 'better-call';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../db/schema';
import { applyMigrations } from '../scripts/neon-migrations.mjs';
import { AuthConfigurationError, authConfiguration, authenticatedUser, createAuth } from '../lib/infrastructure/auth/auth';
import { accountResponse, handleAuthRequest, resolveAccountRequest } from '../lib/infrastructure/auth/http';

const env = { AUTH_BASE_URL: 'https://vdoc.example', BETTER_AUTH_SECRET: 'test-only-secret-with-at-least-32-characters', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' };
const pg = new PGlite();
const auth = createAuth(drizzle(pg, { schema }), env);
const origin = env.AUTH_BASE_URL;
const request = (path: string, method = 'GET', body?: string, cookie?: string, requestOrigin = origin) => new Request(`${origin}${path}`, {
  method, headers: { origin: requestOrigin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body } : {}),
});
async function cookie(token: string, secret = env.BETTER_AUTH_SECRET) {
  return (await serializeSignedCookie('__Secure-better-auth.session_token', token, secret, { secure: true, httpOnly: true })).split(';')[0];
}
beforeAll(async () => {
  await applyMigrations(pg);
  await pg.exec("insert into app_user(id,name,email,email_verified) values ('alice','Alice','alice@example.test',true),('bob','Bob','bob@example.test',true)");
  await pg.exec(`insert into auth_session(id,token,user_id,expires_at) values
    ('a','alice-token','alice',now()+interval '1 day'),('b','bob-token','bob',now()+interval '1 day'),
    ('old','expired-token','alice',now()-interval '1 day')`);
});
afterAll(() => pg.close());

describe('verified Google account sessions', () => {
  it('distinguishes unavailable service, incomplete setup and a different origin without leaking failures', async () => {
    const req = request('/api/account');
    for (const [failure, code] of [[new Error('postgres://private:password@host/db'), 'ACCOUNT_UNAVAILABLE'], [new AuthConfigurationError('secret-value'), 'AUTH_NOT_CONFIGURED']] as const) {
      const response = await resolveAccountRequest(req, () => { throw failure; });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ configured: false, user: null, error: { code } });
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
    const wrongHost = await resolveAccountRequest(new Request('https://preview.example/api/account'), () => ({ auth, origin }));
    expect(wrongHost.status).toBe(403);
    expect(await wrongHost.json()).toMatchObject({ error: { code: 'ORIGIN_MISMATCH' }, signInUrl: `${origin}/account` });
    const healthy = await resolveAccountRequest(req, () => ({ auth, origin }));
    expect(await healthy.json()).toEqual({ configured: true, user: null });
  });
  it('rejects unsafe/missing configuration without echoing secret values', () => {
    expect(() => authConfiguration({})).toThrow('not configured');
    for (const AUTH_BASE_URL of ['http://public.example', 'https://user:secret@vdoc.example', 'https://vdoc.example/path', 'https://vdoc.example?secret=abc'])
      expect(() => authConfiguration({ ...env, AUTH_BASE_URL })).toThrow('Invalid sign-in origin');
    expect(() => authConfiguration({ ...env, BETTER_AUTH_SECRET: 'short' })).toThrow('at least 32');
    expect(authConfiguration({ ...env, AUTH_BASE_URL: 'http://localhost:3000' }).secure).toBe(false);
  });
  it('does not trust browser-supplied identity headers or an unsigned/forged cookie', async () => {
    expect(await authenticatedUser(auth, new Headers({ 'oai-authenticated-user-id': 'alice', 'oai-authenticated-user-email': 'alice@example.test' }))).toBeNull();
    expect(await authenticatedUser(auth, new Headers({ cookie: '__Secure-better-auth.session_token=alice-token' }))).toBeNull();
    expect(await authenticatedUser(auth, new Headers({ cookie: await cookie('alice-token', 'wrong-signing-key') }))).toBeNull();
  });
  it('resolves each signed session to its own Neon user and excludes session credentials from account output', async () => {
    for (const name of ['alice', 'bob']) {
      const response = await accountResponse(request('/api/account', 'GET', undefined, await cookie(`${name}-token`)), auth);
      const body = await response.json() as { user: { id: string; name: string; email: string } };
      expect(body.user.id).toBe(name);
      expect(Object.keys(body.user).sort()).toEqual(['email', 'id', 'name']);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(JSON.stringify(body)).not.toContain(`${name}-token`);
    }
  });
  it('rejects expired and nonexistent sessions', async () => {
    for (const token of ['expired-token', 'missing-token']) expect(await authenticatedUser(auth, new Headers({ cookie: await cookie(token) }))).toBeNull();
  });
  it('starts Google OAuth with database state and a secure HttpOnly cookie', async () => {
    const response = await handleAuthRequest(request('/api/auth/sign-in/social', 'POST', JSON.stringify({ provider: 'google', callbackURL: '/account' })), auth, origin);
    expect(response.status).toBe(200);
    const body = await response.json() as { url: string };
    const target = new URL(body.url);
    expect(target.origin).toBe('https://accounts.google.com');
    expect(target.searchParams.get('redirect_uri')).toBe(`${origin}/api/auth/callback/google`);
    expect(target.searchParams.get('state')).toBeTruthy();
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(response.headers.get('set-cookie')).toMatch(/Secure/);
    expect(response.headers.get('set-cookie')).toMatch(/SameSite=Lax/i);
    expect((await pg.query('select id from auth_verification')).rows.length).toBeGreaterThan(0);
  });
  it('rejects cross-origin mutations, alternate hosts, oversized input and open-redirect callbacks', async () => {
    expect((await handleAuthRequest(request('/api/auth/sign-out', 'POST', '{}', undefined, 'https://evil.example'), auth, origin)).status).toBe(403);
    expect((await handleAuthRequest(new Request('https://evil.example/api/auth/get-session'), auth, origin)).status).toBe(403);
    expect((await handleAuthRequest(request('/api/auth/sign-out', 'POST', 'x'.repeat(16385)), auth, origin)).status).toBe(413);
    const redirect = await handleAuthRequest(request('/api/auth/sign-in/social', 'POST', JSON.stringify({ provider: 'google', callbackURL: 'https://evil.example' })), auth, origin);
    expect(redirect.status).toBe(403);
    expect((await handleAuthRequest(request('/api/auth/sign-up/email', 'POST', '{}'), auth, origin)).status).toBe(404);
    expect((await handleAuthRequest(request('/api/auth/get-session'), auth, origin)).status).toBe(404);
  });
  it('rejects an unsolicited Google callback without creating an account', async () => {
    const response = await handleAuthRequest(request('/api/auth/callback/google?code=fake&state=unknown'), auth, origin);
    expect(response.status).toBe(302);
    expect((await pg.query('select id from app_user')).rows).toHaveLength(2);
    expect((await pg.query('select id from auth_account')).rows).toHaveLength(0);
  });
  it('revokes only the current session on logout; replay cannot authenticate', async () => {
    const alice = await cookie('alice-token');
    const response = await handleAuthRequest(request('/api/auth/sign-out', 'POST', '{}', alice), auth, origin);
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
    expect(await authenticatedUser(auth, new Headers({ cookie: alice }))).toBeNull();
    expect((await authenticatedUser(auth, new Headers({ cookie: await cookie('bob-token') })))?.id).toBe('bob');
  });
});
