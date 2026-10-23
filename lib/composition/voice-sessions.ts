import { env } from 'cloudflare:workers';
import { proxyVoiceSession, type VoiceSessionAction } from '../infrastructure/realtime/voice-session-proxy';

/** Server-only composition root, imported by the Worker route handlers. */
export function handleVoiceSessionRequest(request: Request, action: VoiceSessionAction, sessionId: string | undefined, getUser: () => Promise<{ userId: string } | null>) {
  return proxyVoiceSession(request, action, sessionId, {
    getUser, fetch,
    serverUrl: env.VDOC_SERVER_URL,
    clientKey: env.VDOC_SERVER_CLIENT_KEY,
    documentAccess: env.VDOC_VOICE_DOCUMENT_ACCESS,
  });
}
