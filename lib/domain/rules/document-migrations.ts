// Stored documents, versions and backups carry a format `version`. Reads
// upgrade older formats step by step; writes always use the current version.

/** The format version every write uses. */
export const CURRENT_DOCUMENT_VERSION = 1;

/* eslint-disable @typescript-eslint/no-explicit-any */
type DocumentValue = Record<string, any>;
/** A pure upgrade from format `vN` to `vN+1`. It must not mutate its input. */
export type DocumentMigration = (value: DocumentValue) => DocumentValue;

/** Ordered upgrades: `documentMigrations[i]` turns version `i + 1` into `i + 2`. */
export const documentMigrations: readonly DocumentMigration[] = [];

/** Upgrades a parsed document envelope to `current`; versions newer than `current` are rejected. */
export function migrateDocument(value: DocumentValue, migrations: readonly DocumentMigration[] = documentMigrations, current = migrations.length + 1): DocumentValue {
  if (migrations.length !== current - 1) throw new Error('The document migrations do not match the current format version.');
  const { version } = value;
  if (!Number.isInteger(version) || version < 1) throw new Error('This is not a supported VDoc backup.');
  if (version > current) throw new Error('This document was created by a newer version of VDoc. Update VDoc to open it.');
  let migrated = value;
  for (let from = version; from < current; from++) migrated = { ...migrations[from - 1](migrated), version: from + 1 };
  return migrated;
}
