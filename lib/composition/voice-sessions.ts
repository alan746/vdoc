import { env } from 'cloudflare:workers';
import { proxyVoiceSession, type VoiceSessionAction } from '../infrastructure/realtime/voice-session-proxy';
import { getRequestUser } from './auth';
import { withLibraryDatabase } from '../infrastructure/cloud-library/connection';
import { authorizeVoiceDocument } from '../infrastructure/cloud-library/voice-access';

/** Server-only composition root, imported by the Worker route handlers. */
export async function handleVoiceSessionRequest(request: Request, action: VoiceSessionAction, sessionId: string | undefined) {
  try { return await proxyVoiceSession(request, action, sessionId, {
    getUser: () => getRequestUser(request), fetch,
    serverUrl: env.VDOC_SERVER_URL,
    clientKey: env.VDOC_SERVER_CLIENT_KEY,
    authorizeDocument: (owner, id) => withLibraryDatabase(env.DATABASE_URL, owner, false, db => authorizeVoiceDocument(db, owner, id)),
  }); } catch {
    return Response.json({ error: { code: 'AUTH_UNAVAILABLE', message: 'Sign-in is temporarily unavailable.' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
