import { env } from 'cloudflare:workers';
import { createDatabase } from '@/lib/infrastructure/persistence/neon-database';
import { authConfiguration, authenticatedUser, createAuth } from '@/lib/infrastructure/auth/auth';
import { accountResponse, handleAuthRequest } from '@/lib/infrastructure/auth/http';

export function requestAuth() {
  const config = authConfiguration(env);
  return { auth: createAuth(createDatabase(env.DATABASE_URL), env), origin: config.origin };
}

export async function getRequestUser(request: Request) {
  const { auth, origin } = requestAuth();
  if (new URL(request.url).origin !== origin) return null;
  const identity = await authenticatedUser(auth, request.headers);
  return identity ? { userId: identity.id } : null;
}

export async function handleAccountRequest(request: Request) {
  try {
    const { auth, origin } = requestAuth();
    return accountResponse(request, new URL(request.url).origin === origin ? auth : null);
  } catch { return accountResponse(request, null); }
}

export async function handleSignInRequest(request: Request) {
  try {
    const { auth, origin } = requestAuth();
    return await handleAuthRequest(request, auth, origin);
  } catch {
    return Response.json({ error: 'Sign-in is not configured or is temporarily unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
