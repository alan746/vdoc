import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { JSONContent } from '@tiptap/core';

// Better Auth's standard schema. Identity comes from a verified login.
export const user = pgTable('app_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const session = pgTable('auth_session', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('auth_session_user_idx').on(t.userId), index('auth_session_expiry_idx').on(t.expiresAt)]);
export const account = pgTable('auth_account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('auth_account_provider_idx').on(t.providerId, t.accountId), index('auth_account_user_idx').on(t.userId)]);
export const verification = pgTable('auth_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('auth_verification_identifier_idx').on(t.identifier)]);

// Owner-scoped IDs allow importing local UUIDs without overwriting another user.
export const libraryItems = pgTable('library_item', {
  ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  id: text('id').notNull(),
  kind: text('kind', { enum: ['document', 'folder'] }).notNull(),
  parentId: text('parent_id'),
  title: text('title').notNull(),
  content: jsonb('content').$type<JSONContent>(),
  formatVersion: integer('format_version'),
  revision: integer('revision').notNull().default(1),
  starred: boolean('starred').notNull().default(false),
  trashedAt: timestamp('trashed_at', { withTimezone: true }),
  trashGroup: text('trash_group'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.parentId], foreignColumns: [t.ownerId, t.id], name: 'library_parent_same_owner' }),
  index('library_owner_updated_idx').on(t.ownerId, t.updatedAt, t.id),
  index('library_parent_idx').on(t.ownerId, t.parentId),
  check('library_revision_positive', sql`${t.revision} > 0`),
  check('library_title_length', sql`length(${t.title}) between 1 and 500`),
  check('library_not_own_parent', sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  check('library_payload', sql`(${t.kind} = 'folder' and ${t.content} is null and ${t.formatVersion} is null) or (${t.kind} = 'document' and jsonb_typeof(${t.content}) = 'object' and ${t.content} is not null and ${t.formatVersion} > 0 and ${t.formatVersion} is not null)`),
]);
export const documentVersions = pgTable('document_version', {
  ownerId: text('owner_id').notNull(),
  documentId: text('document_id').notNull(),
  id: text('id').notNull(),
  label: text('label').notNull(),
  title: text('title').notNull(),
  content: jsonb('content').$type<JSONContent>().notNull(),
  documentRevision: integer('document_revision').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.documentId], foreignColumns: [libraryItems.ownerId, libraryItems.id], name: 'version_document_same_owner' }).onDelete('cascade'),
  index('version_document_idx').on(t.ownerId, t.documentId, t.createdAt, t.id),
  check('version_revision_positive', sql`${t.documentRevision} > 0`),
]);
