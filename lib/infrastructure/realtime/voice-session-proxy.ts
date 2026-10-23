import { z } from 'zod/v3';
import { createdVoiceSessionSchema, voiceDocumentRequestSchema, voiceGrantSchema, voiceRealtimePath, voiceResourceIdSchema } from '../../domain/entities/voice-session';

export type VoiceSessionAction = 'check' | 'create' | 'grant' | 'end';
export type VoiceSessionProxyDependencies = {
  getUser(): Promise<{ userId: string } | null>;
  /** Trusted Worker bindings, never values supplied by a browser. */
  serverUrl?: string; clientKey?: string; documentAccess?: string;
  /** Returns an owner-scoped transport ID only for an active, owned document. */
  authorizeDocument?(userId: string, documentId: string): Promise<string | null>;
  fetch: typeof fetch;
};
const accessSchema = z.record(z.array(voiceResourceIdSchema));
const validUserId = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= 128 && /^[A-Za-z0-9]/.test(value) && !/[^A-Za-z0-9._:-]/.test(value);
const response = (body: unknown, status: number, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const failure = (status: number, code: string, message: string) => response({ error: { code, message } }, status);

function configuration(deps: VoiceSessionProxyDependencies) {
  if (!deps.serverUrl || !deps.clientKey || (!deps.documentAccess && !deps.authorizeDocument)) throw new Error('Voice sessions are not configured.');
  const url = new URL(deps.serverUrl);
  const local = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !(url.protocol === 'https:' || (url.protocol === 'http:' && local)))
    throw new Error('Invalid voice service origin.');
  if (deps.clientKey.length < 24 || /\s/.test(deps.clientKey)) throw new Error('Invalid client key.');
  return { origin: url.origin, key: deps.clientKey, access: deps.authorizeDocument ? null : accessSchema.parse(JSON.parse(deps.documentAccess!)) };
}

/** Bound the stream before JSON parsing, including requests without Content-Length. */
async function readBody(request: Pick<Request, 'body'>): Promise<unknown> {
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

/** Reauthorize every create, renew and end request against document ownership. */
export async function proxyVoiceSession(request: Request, action: VoiceSessionAction, sessionId: string | undefined, deps: VoiceSessionProxyDependencies): Promise<Response> {
  if (request.method !== (action === 'check' ? 'GET' : action === 'end' ? 'DELETE' : 'POST')) return failure(405, 'METHOD_NOT_ALLOWED', 'Unsupported method.');
  const origin = request.headers.get('origin');
  if ((origin !== new URL(request.url).origin && !(action === 'check' && !origin)) || request.headers.get('sec-fetch-site') === 'cross-site')
    return failure(403, 'ORIGIN_DENIED', 'Use the application’s same-origin voice endpoint.');
  const user = await deps.getUser();
  if (!user || !validUserId(user.userId)) return failure(401, 'SIGN_IN_REQUIRED', 'Sign in to use the voice assistant.');
  if (action !== 'create' && action !== 'check' && !voiceResourceIdSchema.safeParse(sessionId).success)
    return failure(400, 'INVALID_SESSION', 'Invalid voice session ID.');
  if (action !== 'check' && request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    return failure(415, 'JSON_REQUIRED', 'Send a JSON document ID.');
  let documentId: string;
  try { documentId = action === 'check' ? voiceResourceIdSchema.parse(new URL(request.url).searchParams.get('documentId')) : voiceDocumentRequestSchema.parse(await readBody(request)).documentId; }
  catch (error) { return error instanceof RangeError ? failure(413, 'BODY_TOO_LARGE', 'The request is too large.') : failure(400, 'INVALID_INPUT', 'Supply only a valid documentId.'); }
  let config: ReturnType<typeof configuration>;
  try { config = configuration(deps); }
  catch { return failure(503, 'VOICE_NOT_CONFIGURED', 'Voice sessions are not configured.'); }
  let transportDocumentId = documentId;
  if (deps.authorizeDocument) {
    try {
      const authorized = await deps.authorizeDocument(user.userId, documentId);
      if (!authorized) return failure(403, 'DOCUMENT_ACCESS_DENIED', 'You do not have voice access to this document.');
      transportDocumentId = voiceResourceIdSchema.parse(authorized);
    } catch { return failure(503, 'STORAGE_UNAVAILABLE', 'Document access could not be verified.'); }
  } else if (!config.access || !Object.hasOwn(config.access, user.userId) || !config.access[user.userId].includes(documentId)) {
    return failure(403, 'DOCUMENT_ACCESS_DENIED', 'You do not have voice access to this document.');
  }

  // Read-only discovery never allocates a session or exposes the server credential.
  if (action === 'check') {
    const url = new URL(config.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return response({ url: url.origin, sessionsUrl: '/api/voice-sessions', audio: true }, 200);
  }

  // The document ID is reauthorized on every request and remains part of the
  // upstream session path. A session ID cannot be used to escape its document.
  const base = `/v1/documents/${encodeURIComponent(transportDocumentId)}/voice-sessions`;
  const path = action === 'create' ? base : `${base}/${encodeURIComponent(sessionId!)}${action === 'grant' ? '/grants' : ''}`;
  try {
    const upstream = await deps.fetch(`${config.origin}${path}`, {
      method: action === 'end' ? 'DELETE' : 'POST',
      headers: { Authorization: `Bearer ${config.key}`, 'X-Vdoc-User-Id': user.userId, 'X-Request-Id': crypto.randomUUID(), ...(action === 'create' ? { 'Content-Type': 'application/json' } : {}) },
      ...(action === 'create' ? { body: '{}' } : {}),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!upstream.ok) {
      const quota = await quotaFailure(upstream);
      if (quota) return quota;
      const status = [402, 404, 409, 429, 503].includes(upstream.status) ? upstream.status : 502;
      // Never echo an upstream error body or authentication headers.
      return failure(status, 'VOICE_SERVICE_ERROR', 'The voice service could not complete the request.');
    }
    if (action === 'end') return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    const raw: unknown = await upstream.json();
    if (action === 'grant') return response(voiceGrantSchema.parse(raw), 201);
    const created = createdVoiceSessionSchema.parse(raw);
    if (created.documentId !== transportDocumentId || created.realtimePath !== voiceRealtimePath(transportDocumentId, created.sessionId))
      throw new Error('Mismatched voice session.');
    return response({ ...created, documentId, ...(transportDocumentId !== documentId ? { transportDocumentId } : {}) }, 201);
  } catch { return failure(502, 'VOICE_SERVICE_ERROR', 'The voice service could not complete the request.'); }
}

const positiveSeconds = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Only stable, typed quota fields cross the service boundary; details never do. */
async function quotaFailure(upstream: Response): Promise<Response | undefined> {
  if (upstream.status !== 429 && upstream.status !== 503) return undefined;
  let problem: Record<string, unknown>;
  try {
    const raw = await readBody(upstream);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    problem = raw as Record<string, unknown>;
  } catch { return undefined; }
  const retryHeader = upstream.headers.get('retry-after');
  const headerSeconds = retryHeader && /^\d{1,16}$/.test(retryHeader) ? Number(retryHeader) : undefined;
  const retryAfterSeconds = positiveSeconds(problem.retryAfterSeconds) ? problem.retryAfterSeconds : positiveSeconds(headerSeconds) ? headerSeconds : undefined;
  const retryFields = retryAfterSeconds ? { retryAfterSeconds } : {};
  const retryHeaders: Record<string, string> = retryAfterSeconds ? { 'Retry-After': String(retryAfterSeconds) } : {};
  if (upstream.status === 503 && problem.code === 'QUOTA_UNAVAILABLE') {
    return response({ error: { code: 'QUOTA_UNAVAILABLE', message: 'Voice limits could not be checked. Try again later.', ...retryFields } }, 503, retryHeaders);
  }
  if (upstream.status !== 429 || problem.code !== 'QUOTA_EXCEEDED') return undefined;
  const quotaKind = problem.quotaKind === 'concurrency' || problem.quotaKind === 'rate' ? problem.quotaKind : undefined;
  return response({ error: {
    code: 'QUOTA_EXCEEDED', message: 'Your voice session limit has been reached.',
    ...(quotaKind ? { quotaKind } : {}), ...retryFields,
  } }, 429, retryHeaders);
}
