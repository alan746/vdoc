import { Pool } from '@neondatabase/serverless';
import { applyMigrations } from './neon-migrations.mjs';

// Explicit operator action; never run against production during a preview build.
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL to the target Neon branch connection string.');
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
let client;
try {
  client = await pool.connect();
  await applyMigrations(client);
  console.log('Neon migrations applied.');
} catch {
  // Driver errors can contain connection details or SQL values.
  console.error('Migration failed. Check the target branch, credentials, and migration SQL.');
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
