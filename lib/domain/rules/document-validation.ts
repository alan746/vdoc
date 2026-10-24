import type { JSONContent } from '@tiptap/core';
import type { SavedDocument } from '../entities/document';
import { migrateDocument } from './document-migrations';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Attrs = Record<string, any>;
/** A pure validation concern; throws a user-facing error on the first violation. */
export type NodeRule = (node: JSONContent, attrs: Attrs) => void;

/** Recursively validates a document tree against the rule chain. */
export function validateDocumentTree(root: JSONContent, rules: readonly NodeRule[]) {
  const inspect = (node: JSONContent, depth = 0) => {
    if (depth > 100) throw new Error('The document is nested too deeply.');
    if (!node || typeof node !== 'object' || Array.isArray(node) || typeof node.type !== 'string' || (node.content !== undefined && !Array.isArray(node.content)) || (node.marks !== undefined && !Array.isArray(node.marks))) throw new Error('The backup contains an invalid document structure.');
    const attrs = node.attrs || {};
    for (const rule of rules) rule(node, attrs);
    for (const child of node.content || []) inspect(child, depth + 1);
  };
  inspect(root);
}

/** Parses the backup envelope (BOM, JSON, version, title, root type) and upgrades it to the current format, without validating node content. */
export function parseDocumentEnvelope(raw: string, maxLength = Infinity): Omit<SavedDocument, 'content'> & { content: JSONContent; id?: unknown; savedAt?: unknown } {
  if (raw.length > maxLength) throw new Error('The document exceeds the permitted length.');
  let value: any;
  try { value = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw); }
  catch { throw new Error('This backup is not valid JSON. Choose a complete VDoc backup file.'); }
  return validateDocumentEnvelope(value);
}

/** Object entry point shared by parsed backups and in-memory document values. */
export function validateDocumentEnvelope(input: unknown): ReturnType<typeof parseDocumentEnvelope> {
  const value = input as Record<string, any> | null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('This is not a supported VDoc backup.');
  const migrated = migrateDocument(value);
  if (typeof migrated.title !== 'string' || migrated.title.length > 500 || migrated.content?.type !== 'doc') throw new Error('This is not a supported VDoc backup.');
  return migrated as ReturnType<typeof parseDocumentEnvelope>;
}
