import { z } from 'zod';
import { createdVoiceSessionSchema, voiceDocumentRequestSchema, voiceGrantSchema, voiceRealtimePath, voiceResourceIdSchema } from '../../domain/entities/voice-session';

export type VoiceSessionAction = 'create' | 'grant' | 'end';
export type VoiceSessionProxyDependencies = {
  getUser(): Promise<{ userId: string } | null>;
  /** Trusted Worker bindings, never values supplied by a browser. */
  serverUrl?: string; clientKey?: string; documentAccess?: string;
  fetch: typeof fetch;
};
const accessSchema = z.record(z.array(voiceResourceIdSchema));
const response = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const failure = (status: number, code: string, message: string) => response({ error: { code, message } }, status);

function configuration(deps: VoiceSessionProxyDependencies) {
  if (!deps.serverUrl || !deps.clientKey || !deps.documentAccess) throw new Error('Voice sessions are not configured.');
  const url = new URL(deps.serverUrl);
  const local = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !(url.protocol === 'https:' || (url.protocol === 'http:' && local)))
    throw new Error('Invalid voice service origin.');
  if (deps.clientKey.length < 24 || /\s/.test(deps.clientKey)) throw new Error('Invalid client key.');
  return { origin: url.origin, key: deps.clientKey, access: accessSchema.parse(JSON.parse(deps.documentAccess)) };
}

/** Bound the stream before JSON parsing, including requests without Content-Length. */
async function readBody(request: Request): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new RangeError('Body too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** App-side authorization is checked for every create, renew and end request.
 * Local-only documents have no server ownership table; the explicit Worker
 * access list is the initial authorization source, never first-caller claims. */
export async function proxyVoiceSession(request: Request, action: VoiceSessionAction, sessionId: string | undefined, deps: VoiceSessionProxyDependencies): Promise<Response> {
  if (request.method !== (action === 'end' ? 'DELETE' : 'POST')) return failure(405, 'METHOD_NOT_ALLOWED', 'Unsupported method.');
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site')
    return failure(403, 'ORIGIN_DENIED', 'Use the application’s same-origin voice endpoint.');
  const user = await deps.getUser();
  if (!user) return failure(401, 'SIGN_IN_REQUIRED', 'Sign in to use the voice assistant.');
  if (action !== 'create' && !voiceResourceIdSchema.safeParse(sessionId).success)
    return failure(400, 'INVALID_SESSION', 'Invalid voice session ID.');
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    return failure(415, 'JSON_REQUIRED', 'Send a JSON document ID.');
  let documentId: string;
  try { documentId = voiceDocumentRequestSchema.parse(await readBody(request)).documentId; }
  catch (error) { return error instanceof RangeError ? failure(413, 'BODY_TOO_LARGE', 'The request is too large.') : failure(400, 'INVALID_INPUT', 'Supply only a valid documentId.'); }
  let config: ReturnType<typeof configuration>;
  try { config = configuration(deps); }
  catch { return failure(503, 'VOICE_NOT_CONFIGURED', 'Voice sessions are not configured.'); }
  if (!Object.hasOwn(config.access, user.userId) || !config.access[user.userId].includes(documentId))
    return failure(403, 'DOCUMENT_ACCESS_DENIED', 'You do not have voice access to this document.');

  // The document ID is reauthorized on every request and remains part of the
  // upstream session path. A session ID cannot be used to escape its document.
  const base = `/v1/documents/${encodeURIComponent(documentId)}/voice-sessions`;
  const path = action === 'create' ? base : `${base}/${encodeURIComponent(sessionId!)}${action === 'grant' ? '/grants' : ''}`;
  try {
    const upstream = await deps.fetch(`${config.origin}${path}`, {
      method: action === 'end' ? 'DELETE' : 'POST',
      headers: { Authorization: `Bearer ${config.key}`, ...(action === 'create' ? { 'Content-Type': 'application/json' } : {}) },
      ...(action === 'create' ? { body: '{}' } : {}),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!upstream.ok) {
      const status = [404, 409, 429, 503].includes(upstream.status) ? upstream.status : 502;
      // Never echo an upstream error body or authentication headers.
      return failure(status, 'VOICE_SERVICE_ERROR', 'The voice service could not complete the request.');
    }
    if (action === 'end') return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    const raw: unknown = await upstream.json();
    if (action === 'grant') return response(voiceGrantSchema.parse(raw), 201);
    const created = createdVoiceSessionSchema.parse(raw);
    if (created.documentId !== documentId || created.realtimePath !== voiceRealtimePath(documentId, created.sessionId))
      throw new Error('Mismatched voice session.');
    return response(created, 201);
  } catch { return failure(502, 'VOICE_SERVICE_ERROR', 'The voice service could not complete the request.'); }
}
