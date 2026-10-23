import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fileURLToPath } from 'node:url';

/** A pg-compatible connection, used only by the explicit migration command. */
export async function applyMigrations(client) {
  const migrations = readMigrationFiles({ migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  await client.query('BEGIN');
  try {
    // Serializes migration operators, including the first creation of the journal.
    await client.query('SELECT pg_advisory_xact_lock(192837465)');
    await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
    await client.query('CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint not null unique)');
    const applied = await client.query('SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at');
    for (const row of applied.rows) {
      const local = migrations.find(m => m.folderMillis === Number(row.created_at));
      if (!local || local.hash !== row.hash) throw new Error('Applied migration differs from repository.');
    }
    for (const migration of migrations) {
      if (applied.rows.some(row => Number(row.created_at) === migration.folderMillis)) continue;
      for (const statement of migration.sql) await client.query(statement);
      await client.query('INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ($1,$2)', [migration.hash, migration.folderMillis]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
