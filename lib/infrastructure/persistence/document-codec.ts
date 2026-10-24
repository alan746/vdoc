import { getSchema } from '@tiptap/core';
import { createExtensions } from '../../editor/extensions';
import { editorBundle } from '../../editor/feature-list';
import { parseDocumentEnvelope, validateDocumentEnvelope, validateDocumentTree } from '../../domain/rules/document-validation';
import { CURRENT_DOCUMENT_VERSION } from '../../domain/rules/document-migrations';
import type { DocumentDraft } from '../../domain/entities/document';

let schema: ReturnType<typeof getSchema> | undefined;
// Native backups follow the same size policy as saved documents. Conversion
// callers can supply their own bound; structural validation always runs.
export function parseDocument(raw: string, maxLength = Infinity): DocumentDraft {
  return documentFromEnvelope(parseDocumentEnvelope(raw, maxLength));
}

/** Validate and normalize an in-memory document without a JSON string round trip.
 * Callers supply ordinary document data, not class instances or custom toJSON values.
 * Validation and migrations are shared with the portable backup entry point. */
export function normalizeDocument(input: unknown): DocumentDraft {
  return documentFromEnvelope(validateDocumentEnvelope(input));
}

function documentFromEnvelope(value: ReturnType<typeof parseDocumentEnvelope>): DocumentDraft {
  validateDocumentTree(value.content, editorBundle.validation);
  schema ??= getSchema(createExtensions());
  const node = schema.nodeFromJSON(value.content); node.check();
  editorBundle.validateDocument(node);
  return { version: CURRENT_DOCUMENT_VERSION, ...(typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.id) ? { id: value.id } : {}), title: value.title, content: node.toJSON(), savedAt: typeof value.savedAt === 'string' ? value.savedAt : new Date().toISOString() };
}
