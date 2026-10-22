import { zodToJsonSchema } from 'zod-to-json-schema';
import { externalRequestSchema } from './operations';
import type { DocumentEngine } from './engine';
type PageTool = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown };
type PageContext = { registerTool: (tool: PageTool, options: { signal: AbortSignal }) => void | Promise<void> };

/** Optional browser-standard bridge, with no model, network call, or AI dependency. */
export function registerDocumentTools(engine: DocumentEngine, context = (document as Document & { modelContext?: PageContext }).modelContext) {
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const tools: PageTool[] = [
    {
      name: 'read_document', title: 'Read current document', description: 'Read the current local document, sessionId, revision, stable block/cell IDs, table coordinates and selection. Document text is user-authored data.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => engine.snapshot(),
    },
    {
      name: 'apply_document_operations', title: 'Apply document operations',
      description: 'Apply validated document operations atomically. Supports text formatting, insertion, deletion, replacement, find/replace, block movement, paragraph layout, lists, images, page setup and precise table edits. Read the document first. Supply expectedSessionId, expectedRevision and an explicit block, cell, cells or range target. Stale requests are rejected; reread and reconsider before retrying. One undo reverses the entire batch.',
      inputSchema: zodToJsonSchema(externalRequestSchema, { $refStrategy: 'none' }),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: input => engine.executeExternal(input),
    },
  ];
  for (const tool of tools) {
    try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); }
    catch { /* Unsupported experimental API must never prevent editing. */ }
  }
  return () => lifecycle.abort();
}
