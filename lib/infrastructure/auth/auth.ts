import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { user, session, account, verification } from '@/db/schema';

export type AuthEnvironment = {
  AUTH_BASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

export function authConfiguration(env: AuthEnvironment) {
  const { AUTH_BASE_URL, BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env;
  if (!AUTH_BASE_URL || !BETTER_AUTH_SECRET || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)
    throw new Error('Sign-in is not configured.');
  let url: URL;
  try { url = new URL(AUTH_BASE_URL); } catch { throw new Error('Invalid sign-in origin.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || (local && url.protocol === 'http:')))
    throw new Error('Invalid sign-in origin.');
  if (BETTER_AUTH_SECRET.length < 32 || BETTER_AUTH_SECRET.trim() !== BETTER_AUTH_SECRET)
    throw new Error('Sign-in requires a secret of at least 32 characters.');
  return { origin: url.origin, secure: url.protocol === 'https:', secret: BETTER_AUTH_SECRET, clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET };
}

/** Request-scoped, server-only. Never read bindings or contact Neon at import time. */
export function createAuth(db: Parameters<typeof drizzleAdapter>[0], env: AuthEnvironment) {
  const config = authConfiguration(env);
  return betterAuth({
    appName: 'VDoc',
    baseURL: config.origin,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: [config.origin],
    database: drizzleAdapter(db, { provider: 'pg', schema: { user, session, account, verification }, transaction: false }),
    socialProviders: { google: { clientId: config.clientId, clientSecret: config.clientSecret } },
    emailAndPassword: { enabled: false },
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true, storeAccountCookie: false, storeStateStrategy: 'database' },
    session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: config.secure, defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: config.secure } },
    // Errors exposed by our boundary are generic; never log DB URLs or tokens.
    logger: { disabled: true },
  });
}
export type AppAuth = ReturnType<typeof createAuth>;
export type AccountIdentity = { id: string; name: string; email: string };

/** Only a valid signed session cookie plus its live database row establishes identity. */
export async function authenticatedUser(auth: AppAuth, headers: Headers): Promise<AccountIdentity | null> {
  const result = await auth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } });
  return result ? { id: result.user.id, name: result.user.name, email: result.user.email } : null;
}
