import { Pool, type PoolClient } from '@neondatabase/serverless';
import { createDatabase } from '../persistence/neon-database';
import { LibraryError, type SqlClient } from './store';

/** A WebSocket connection belongs to exactly one Worker request. */
export async function withLibraryDatabase<T>(connectionString: string | undefined, owner: string, write: boolean, work: (db: SqlClient) => Promise<T>): Promise<T> {
  createDatabase(connectionString); // Validate without opening a connection.
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000, query_timeout: 15000 });
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '10s'");
    if (write) {
      const result = await client.query('select id from app_user where id=$1 for update', [owner]);
      if (!result.rows.length) throw new LibraryError(401, 'SIGN_IN_REQUIRED', 'Sign in again.');
    }
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch { /* Preserve original error. */ } }
    throw error;
  } finally { client?.release(); await pool.end(); }
}
