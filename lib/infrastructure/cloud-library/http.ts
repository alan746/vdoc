import { z } from 'zod/v3';
import { parseDocument } from '../persistence/document-codec';
import { executeCommand, LibraryError, listItems, listVersions, readItem, type LibraryCommand, type SqlClient } from './store';

const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const revision = z.number().int().min(1).max(2147483646);
const base = { id: idSchema, expectedRevision: revision };
const commandSchema = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('put'), expectedRevision: z.number().int().min(0).max(2147483646), kind: z.enum(['document', 'folder']),
    title: z.string().trim().min(1).max(500), parentId: idSchema.nullable(), starred: z.boolean(), content: z.unknown(), formatVersion: z.number().int().nullable() }).strict(),
  z.object({ ...base, action: z.literal('trash') }).strict(),
  z.object({ ...base, action: z.literal('restore') }).strict(),
  z.object({ ...base, action: z.literal('delete') }).strict(),
  z.object({ ...base, action: z.literal('checkpoint'), versionId: idSchema, label: z.string().trim().min(1).max(200) }).strict(),
  z.object({ ...base, action: z.literal('restoreVersion'), versionId: idSchema }).strict(),
]);
export type LibraryDependencies = {
  getUser(): Promise<{ userId: string } | null>;
  database<T>(owner: string, write: boolean, work: (db: SqlClient) => Promise<T>): Promise<T>;
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Origin' } });

async function readCommand(request: Request): Promise<LibraryCommand> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
    throw new LibraryError(415, 'JSON_REQUIRED', 'Send JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new LibraryError(400, 'INVALID_INPUT', 'A command is required.');
  let size = 0; const chunks: Uint8Array[] = [];
  try { for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new LibraryError(413, 'DOCUMENT_TOO_LARGE', 'Cloud documents must be smaller than 8 MiB. Keep an exported backup.'); }
    chunks.push(value);
  } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = commandSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    if (value.action === 'put') {
      if (value.kind === 'folder') {
        if (value.content !== null || value.formatVersion !== null) throw new Error();
      } else {
        const document = parseDocument(JSON.stringify({ version: value.formatVersion, title: value.title, content: value.content }));
        return { ...value, content: document.content, formatVersion: document.version };
      }
    }
    return value as LibraryCommand;
  } catch { throw new LibraryError(400, 'INVALID_INPUT', 'Invalid document or library command.'); }
}

/** Every operation derives owner from verified login. The account header is a
 * stale-tab guard, never an alternative authentication mechanism. */
export async function handleLibraryRequest(request: Request, deps: LibraryDependencies, id?: string, versions = false) {
  try {
    if (!['GET', 'POST'].includes(request.method) || (id && request.method !== 'GET'))
      return reply({ error: { code: 'METHOD_NOT_ALLOWED' } }, 405);
    if (request.method === 'POST' && (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site'))
      throw new LibraryError(403, 'ORIGIN_DENIED', 'Use the same-origin document API.');
    const user = await deps.getUser();
    if (!user) throw new LibraryError(401, 'SIGN_IN_REQUIRED', 'Sign in to access cloud documents.');
    if (request.headers.get('x-vdoc-account') !== user.userId)
      throw new LibraryError(409, 'ACCOUNT_CHANGED', 'Your account changed. Reopen the workspace before syncing.');
    if (id && !idSchema.safeParse(id).success) throw new LibraryError(400, 'INVALID_ID', 'Invalid item ID.');
    if (request.method === 'POST') {
      const command = await readCommand(request);
      return reply({ item: await deps.database(user.userId, true, db => executeCommand(db, user.userId, command)) });
    }
    return await deps.database(user.userId, false, async db => {
      if (id) return versions ? reply({ versions: await listVersions(db, user.userId, id) }) : reply({ item: await readItem(db, user.userId, id) });
      const after = new URL(request.url).searchParams.get('after') || '';
      if (after && !idSchema.safeParse(after).success) throw new LibraryError(400, 'INVALID_CURSOR', 'Invalid cursor.');
      return reply(await listItems(db, user.userId, after));
    });
  } catch (error) {
    if (error instanceof LibraryError) return reply({ error: { code: error.code, message: error.message } }, error.status);
    return reply({ error: { code: 'STORAGE_UNAVAILABLE', message: 'Cloud storage is temporarily unavailable. Your local copy should be kept.' } }, 503);
  }
}
