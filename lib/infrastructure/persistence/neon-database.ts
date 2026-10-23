import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@/db/schema';

/** Server-only factory. No environment read or connection during build/import. */
export function createDatabase(connectionString: string | undefined) {
  if (!connectionString) throw new Error('DATABASE_URL is required for cloud storage.');
  let url: URL;
  try { url = new URL(connectionString); } catch { throw new Error('DATABASE_URL must be a PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL with credentials.');
  }
  // HTTP does not leave a socket/pool alive across Worker invocations.
  return drizzle(neon(connectionString), { schema });
}
export type CloudDatabase = ReturnType<typeof createDatabase>;
