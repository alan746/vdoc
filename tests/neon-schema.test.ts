// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../scripts/neon-migrations.mjs';
import { createDatabase } from '../lib/infrastructure/persistence/neon-database';

const db = new PGlite();
beforeAll(async () => {
  await applyMigrations(db);
  await db.exec("insert into app_user(id,name,email) values ('alice','Alice','alice@example.test'),('bob','Bob','bob@example.test')");
});
afterAll(() => db.close());
const folder = (owner: string, id: string, parent: string | null = null) => db.query(
  "insert into library_item(owner_id,id,kind,title,parent_id) values ($1,$2,'folder','Folder',$3)", [owner, id, parent]);

describe('Neon SQL schema (real PostgreSQL engine)', () => {
  it('reruns migrations without recreating tables or losing data', async () => {
    await applyMigrations(db);
    expect((await db.query('select id from app_user')).rows).toHaveLength(2);
    expect((await db.query('select id from drizzle.__drizzle_migrations')).rows).toHaveLength(1);
  });
  it('rolls back the entire migration if a statement fails', async () => {
    const empty = new PGlite();
    try {
      const client = { query: async (sql: string, values?: unknown[]) => {
        if (sql.includes('CREATE TABLE "library_item"')) throw new Error('Injected migration failure');
        return empty.query(sql, values);
      } };
      await expect(applyMigrations(client)).rejects.toThrow('Injected migration failure');
      expect((await empty.query("select tablename from pg_tables where schemaname='public'")).rows).toEqual([]);
      await applyMigrations(empty);
      expect((await empty.query('select id from drizzle.__drizzle_migrations')).rows).toHaveLength(1);
    } finally { await empty.close(); }
  });
  it('scopes local UUIDs and parent references to the authenticated owner', async () => {
    await folder('alice', 'shared-id');
    await folder('bob', 'shared-id');
    await folder('alice', 'alice-only');
    await expect(folder('bob', 'child', 'alice-only')).rejects.toThrow();
    await folder('alice', 'child', 'alice-only');
  });
  it('rejects invalid document shapes, self-parenting and nonpositive revisions', async () => {
    await expect(db.exec("insert into library_item(owner_id,id,kind,title) values ('alice','invalid','document','Missing body')")).rejects.toThrow();
    await expect(folder('alice', 'self', 'self')).rejects.toThrow();
    await expect(db.exec("update library_item set revision=0 where owner_id='alice'")).rejects.toThrow();
  });
  it('isolates history and cascades deletion only within the owner account', async () => {
    await db.exec(`insert into library_item(owner_id,id,kind,title,content,format_version)
      values ('alice','doc','document','A','{"type":"doc"}',1),('bob','doc','document','B','{"type":"doc"}',1)`);
    await db.exec(`insert into document_version(owner_id,document_id,id,label,title,content,document_revision)
      values ('alice','doc','v1','Checkpoint','A','{"type":"doc"}',1),('bob','doc','v1','Checkpoint','B','{"type":"doc"}',1)`);
    await expect(db.exec(`insert into document_version(owner_id,document_id,id,label,title,content,document_revision)
      values ('bob','alice-only-missing','v2','Checkpoint','B','{}',1)`)).rejects.toThrow();
    await db.exec("delete from library_item where owner_id='alice' and id='doc'");
    const result = await db.query<{ owner_id: string }>('select owner_id from document_version');
    expect(result.rows).toEqual([{ owner_id: 'bob' }]);
  });
  it('supports compare-and-swap writes so stale devices cannot overwrite edits', async () => {
    const save = (title: string) => db.query("update library_item set title=$1, revision=revision+1 where owner_id='bob' and id='doc' and revision=1 returning revision", [title]);
    const results = await Promise.all([save('First device'), save('Second device')]);
    expect(results.map(r => r.rows.length).sort()).toEqual([0, 1]);
  });
});

describe('Neon configuration', () => {
  it('fails closed without exposing secrets in configuration errors', () => {
    expect(() => createDatabase(undefined)).toThrow('DATABASE_URL is required');
    for (const input of ['secret-value', 'https://user:secret@example.com/db', 'postgres://example.com/db']) {
      try { createDatabase(input); throw new Error('accepted bad URL'); }
      catch (error) { expect(String(error)).not.toContain('secret'); }
    }
  });
});
