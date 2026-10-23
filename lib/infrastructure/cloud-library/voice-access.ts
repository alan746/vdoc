import { LibraryError, readItem, type SqlClient } from './store';

export async function authorizeVoiceDocument(db: SqlClient, owner: string, id: string) {
  let item;
  try { item = await readItem(db, owner, id); }
  catch (error) { if (error instanceof LibraryError && error.status === 404) return null; throw error; }
  if (item.kind !== 'document' || item.trashedAt) return null;
  // The shared backend app credential must not put different users with the
  // same imported local document UUID into the same Durable Object room.
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([owner, id])));
  return `u_${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
