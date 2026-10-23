import type { JSONContent } from '@tiptap/core';

export interface SqlClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export type CloudItem = {
  id: string; kind: 'document' | 'folder'; title: string; parentId: string | null;
  starred: boolean; revision: number; content: JSONContent | null; formatVersion: number | null;
  trashedAt: string | null; trashGroup: string | null; deletedAt: string | null; updatedAt: string;
};
export type LibraryCommand =
  | { action: 'put'; id: string; expectedRevision: number; kind: 'document' | 'folder'; title: string; parentId: string | null; starred: boolean; content: JSONContent | null; formatVersion: number | null }
  | { action: 'trash'; id: string; expectedRevision: number }
  | { action: 'restore'; id: string; expectedRevision: number }
  | { action: 'delete'; id: string; expectedRevision: number }
  | { action: 'checkpoint'; id: string; expectedRevision: number; versionId: string; label: string }
  | { action: 'restoreVersion'; id: string; expectedRevision: number; versionId: string };

export class LibraryError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const fields = `id,kind,title,parent_id as "parentId",starred,revision,content,
  format_version as "formatVersion",trashed_at as "trashedAt",trash_group as "trashGroup",
  deleted_at as "deletedAt",updated_at as "updatedAt"`;
const missing = () => new LibraryError(404, 'NOT_FOUND', 'This item is not available.');
const conflict = () => new LibraryError(409, 'REVISION_CONFLICT', 'This item changed on another device. Reload it before saving.');

export async function readItem(db: SqlClient, owner: string, id: string, includeDeleted = false): Promise<CloudItem> {
  const item = (await db.query<CloudItem>(`select ${fields} from library_item where owner_id=$1 and id=$2`, [owner, id])).rows[0];
  if (!item || (!includeDeleted && item.deletedAt)) throw missing();
  return item;
}
export async function listItems(db: SqlClient, owner: string, after = '') {
  // Include tombstones so another device can remove its cached copy. Never send
  // document bodies in a listing; each body has a separately bounded endpoint.
  const items = (await db.query<Omit<CloudItem, 'content'>>(`select ${fields.replace('revision,content,', 'revision,')}
    from library_item where owner_id=$1 and id > $2 order by id limit 101`, [owner, after])).rows;
  const more = items.length > 100;
  return { items: items.slice(0, 100), nextCursor: more ? items[99].id : null };
}
export async function listVersions(db: SqlClient, owner: string, id: string) {
  const item = await readItem(db, owner, id);
  if (item.kind !== 'document') throw missing();
  return (await db.query(`select id,label,title,document_revision as "documentRevision",created_at as "createdAt"
    from document_version where owner_id=$1 and document_id=$2 order by created_at desc,id desc limit 200`, [owner, id])).rows;
}
async function checkParent(db: SqlClient, owner: string, id: string, parentId: string | null) {
  if (!parentId) return;
  if (parentId === id) throw new LibraryError(400, 'INVALID_PARENT', 'An item cannot contain itself.');
  const parent = await readItem(db, owner, parentId);
  if (parent.kind !== 'folder' || parent.trashedAt) throw new LibraryError(400, 'INVALID_PARENT', 'Choose an active folder.');
  const ancestors = await db.query(`with recursive parents as (
    select id,parent_id from library_item where owner_id=$1 and id=$2
    union select l.id,l.parent_id from library_item l join parents p on l.id=p.parent_id where l.owner_id=$1
  ) select id from parents where id=$3`, [owner, parentId, id]);
  if (ancestors.rows.length) throw new LibraryError(400, 'FOLDER_CYCLE', 'A folder cannot be moved into its descendants.');
}

/** Called inside one transaction holding the authenticated user's row lock.
 * That lock serializes all hierarchy changes for this owner, across Workers.
 * Revision checks still reject stale writes; the lock does not imply last-write-wins.
 */
export async function executeCommand(db: SqlClient, owner: string, command: LibraryCommand): Promise<CloudItem> {
  const { id, expectedRevision } = command;
  let existing: CloudItem | undefined;
  try { existing = await readItem(db, owner, id, true); }
  catch (error) { if (!(error instanceof LibraryError && error.status === 404)) throw error; }
  if (command.action === 'put' && expectedRevision === 0) {
    if (existing) throw conflict(); // A tombstone is never a new document.
    await checkParent(db, owner, id, command.parentId);
    await db.query(`insert into library_item(owner_id,id,kind,title,parent_id,starred,content,format_version)
      values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`, [owner, id, command.kind, command.title, command.parentId, command.starred,
      command.content ? JSON.stringify(command.content) : null, command.formatVersion]);
    return readItem(db, owner, id);
  }
  if (!existing || existing.deletedAt) throw missing();
  if (existing.revision !== expectedRevision) throw conflict();
  if (command.action === 'put') {
    if (existing.trashedAt) throw new LibraryError(409, 'ITEM_TRASHED', 'Restore this item before editing.');
    if (command.kind !== existing.kind) throw new LibraryError(400, 'KIND_IMMUTABLE', 'An item cannot change its type.');
    await checkParent(db, owner, id, command.parentId);
    await db.query(`update library_item set title=$3,parent_id=$4,starred=$5,content=$6::jsonb,format_version=$7,
      revision=revision+1,updated_at=clock_timestamp() where owner_id=$1 and id=$2`,
      [owner, id, command.title, command.parentId, command.starred, command.content ? JSON.stringify(command.content) : null, command.formatVersion]);
  } else if (command.action === 'trash') {
    if (existing.trashedAt) return existing;
    await db.query(`with recursive children as (
      select id from library_item where owner_id=$1 and id=$2
      union select l.id from library_item l join children c on l.parent_id=c.id where l.owner_id=$1
    ) update library_item set trashed_at=clock_timestamp(),trash_group=$3,revision=revision+1,updated_at=clock_timestamp()
      where owner_id=$1 and id in (select id from children) and trashed_at is null and deleted_at is null`, [owner, id, crypto.randomUUID()]);
  } else if (command.action === 'restore') {
    if (!existing.trashedAt) return existing;
    // An unavailable old parent means restoration goes to the root.
    let parentId = existing.parentId;
    if (parentId) {
      try { const parent = await readItem(db, owner, parentId); if (parent.trashedAt) parentId = null; }
      catch (error) { if (error instanceof LibraryError && error.status === 404) parentId = null; else throw error; }
    }
    await db.query(`update library_item set parent_id=$3 where owner_id=$1 and id=$2`, [owner, id, parentId]);
    await db.query(`with recursive children as (
      select id from library_item where owner_id=$1 and id=$2
      union select l.id from library_item l join children c on l.parent_id=c.id where l.owner_id=$1
    ) update library_item set trashed_at=null,trash_group=null,revision=revision+1,updated_at=clock_timestamp()
      where owner_id=$1 and id in (select id from children) and deleted_at is null
      and (id=$2 or (trash_group=$3 and $3 is not null))`, [owner, id, existing.trashGroup]);
  } else if (command.action === 'delete') {
    if (!existing.trashedAt || existing.kind !== 'document') throw new LibraryError(409, 'DELETE_REQUIRES_TRASH', 'Only a document in Trash can be permanently deleted.');
    await db.query('delete from document_version where owner_id=$1 and document_id=$2', [owner, id]);
    // Retain only the tombstone identity/revision. Remove body, name and history.
    await db.query(`update library_item set deleted_at=clock_timestamp(),title='Deleted document',
      content='{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,starred=false,parent_id=null,trash_group=null,
      revision=revision+1,updated_at=clock_timestamp() where owner_id=$1 and id=$2`, [owner, id]);
    return readItem(db, owner, id, true);
  } else {
    if (existing.kind !== 'document' || existing.trashedAt) throw new LibraryError(409, 'ACTIVE_DOCUMENT_REQUIRED', 'Restore the document before using its history.');
    if (command.action === 'checkpoint') {
      const count = (await db.query<{ count: string }>('select count(*) from document_version where owner_id=$1 and document_id=$2', [owner, id])).rows[0];
      if (Number(count.count) >= 200) throw new LibraryError(409, 'HISTORY_LIMIT', 'This document has reached its 200-checkpoint limit.');
      const duplicate = await db.query('select id from document_version where owner_id=$1 and id=$2', [owner, command.versionId]);
      if (duplicate.rows.length) throw new LibraryError(409, 'VERSION_EXISTS', 'This checkpoint already exists.');
      await db.query(`insert into document_version(owner_id,document_id,id,label,title,content,document_revision)
        values ($1,$2,$3,$4,$5,$6::jsonb,$7)`, [owner, id, command.versionId, command.label, existing.title, JSON.stringify(existing.content), existing.revision]);
    } else {
      const version = (await db.query<{ title: string; content: JSONContent }>('select title,content from document_version where owner_id=$1 and document_id=$2 and id=$3', [owner, id, command.versionId])).rows[0];
      if (!version) throw missing();
      const count = (await db.query<{ count: string }>('select count(*) from document_version where owner_id=$1 and document_id=$2', [owner, id])).rows[0];
      if (Number(count.count) >= 200) throw new LibraryError(409, 'HISTORY_LIMIT', 'A backup checkpoint is required before restoring. This document has reached its 200-checkpoint limit.');
      await db.query(`insert into document_version(owner_id,document_id,id,label,title,content,document_revision)
        values ($1,$2,$3,'Before restore',$4,$5::jsonb,$6)`, [owner, id, crypto.randomUUID(), existing.title, JSON.stringify(existing.content), existing.revision]);
      await db.query('update library_item set title=$3,content=$4::jsonb where owner_id=$1 and id=$2', [owner, id, version.title, JSON.stringify(version.content)]);
    }
    await db.query('update library_item set revision=revision+1,updated_at=clock_timestamp() where owner_id=$1 and id=$2', [owner, id]);
  }
  return readItem(db, owner, id);
}
