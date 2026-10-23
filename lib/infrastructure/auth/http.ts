import { type AppAuth, AuthConfigurationError, authenticatedUser } from './auth';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Origin' };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

/** Expose only login, its callback, and logout. /api/account returns safe identity. */
export async function handleAuthRequest(request: Request, auth: AppAuth, origin: string) {
  const url = new URL(request.url);
  if (url.origin !== origin) return reply({ error: 'Use the configured sign-in domain.' }, 403);
  const routes: Record<string, string> = {
    '/api/auth/sign-in/social': 'POST', '/api/auth/sign-out': 'POST',
    '/api/auth/callback/google': 'GET',
  };
  if (!routes[url.pathname]) return reply({ error: 'Not found.' }, 404);
  if (routes[url.pathname] !== request.method) return reply({ error: 'Method not allowed.' }, 405);
  if (request.method === 'POST') {
    if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site')
      return reply({ error: 'Request origin is not allowed.' }, 403);
    // Auth POST payloads are tiny. Bound streamed input before handing it to the library.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      if (reader) for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) { await reader.cancel(); return reply({ error: 'Request too large.' }, 413); }
        chunks.push(value);
      }
    } finally { reader?.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    } catch { return reply({ error: 'Invalid JSON request.' }, 400); }
    if (url.pathname === '/api/auth/sign-in/social') {
      for (const key of ['callbackURL', 'errorCallbackURL']) {
        if (body[key] !== undefined && body[key] !== '/account' && body[key] !== '/account?login=failed')
          return reply({ error: 'Invalid callback.' }, 403);
      }
      if (body.provider !== 'google' || Object.keys(body).some(key => !['provider', 'callbackURL', 'errorCallbackURL'].includes(key)))
        return reply({ error: 'Use Google sign-in.' }, 400);
      body = { provider: 'google', callbackURL: '/account', errorCallbackURL: '/account?login=failed' };
    } else if (Object.keys(body).length) return reply({ error: 'Invalid sign-out request.' }, 400);
    const forwardedHeaders = new Headers(request.headers);
    forwardedHeaders.delete('content-length');
    forwardedHeaders.set('content-type', 'application/json');
    request = new Request(request.url, { method: request.method, headers: forwardedHeaders, body: JSON.stringify(body) });
  }
  try {
    if (url.pathname === '/api/auth/sign-out') {
      // Better Auth's sign-out endpoint clears the cookie even when deletion
      // fails. Require durable revocation before reporting success to the UI.
      const current = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } });
      if (current) await (await auth.$context).internalAdapter.deleteSession(current.session.token);
    }
    const response = await auth.handler(request);
    const result = new Response(response.body, response);
    for (const [name, value] of Object.entries(headers)) result.headers.set(name, value);
    return result;
  } catch { return reply({ error: 'Sign-in is temporarily unavailable.' }, 503); }
}

export async function accountResponse(request: Request, auth: AppAuth | null) {
  if (!auth) return accountUnavailable('AUTH_NOT_CONFIGURED');
  try { return reply({ configured: true, user: await authenticatedUser(auth, request.headers) }); }
  catch { return accountUnavailable('ACCOUNT_UNAVAILABLE'); }
}

type AccountFailure = 'AUTH_NOT_CONFIGURED' | 'ORIGIN_MISMATCH' | 'ACCOUNT_UNAVAILABLE';
function accountUnavailable(code: AccountFailure, signInUrl?: string) {
  const messages: Record<AccountFailure, string> = {
    AUTH_NOT_CONFIGURED: 'Sign-in setup is incomplete. You can check again or continue with local documents.',
    ORIGIN_MISMATCH: 'Please use the main VDoc website to sign in.',
    ACCOUNT_UNAVAILABLE: 'We could not connect to your account. Please try again.',
  };
  return reply({ configured: false, user: null, error: { code, message: messages[code] }, ...(signInUrl ? { signInUrl } : {}) }, code === 'ORIGIN_MISMATCH' ? 403 : 503);
}

/** Initialization failures must not masquerade as an unsupported address. */
export async function resolveAccountRequest(request: Request, initialize: () => { auth: AppAuth; origin: string }) {
  try {
    const { auth, origin } = initialize();
    if (new URL(request.url).origin !== origin) return accountUnavailable('ORIGIN_MISMATCH', new URL('/account', origin).href);
    return await accountResponse(request, auth);
  } catch (error) {
    return accountUnavailable(error instanceof AuthConfigurationError ? 'AUTH_NOT_CONFIGURED' : 'ACCOUNT_UNAVAILABLE');
  }
}
