import { documentToolCatalog, externalDocumentSchema } from './document-tools';
import { realtimeReadBlocksSchema } from './realtime-executor';
import type { DocumentEngine } from './engine';
type PageTool = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown };
type PageContext = { registerTool: (tool: PageTool, options: { signal: AbortSignal }) => void | Promise<void> };

const titles: Record<string, string> = { read_document: 'Read current document', read_blocks: 'Read specific blocks', apply_document_operations: 'Apply document operations' };

/** Optional browser-standard bridge, with no model, network call, or AI
 *  dependency. Registers the vdoc#30 catalog entries that need no agent
 *  turn — get_context and undo_turn stay realtime-only. apply_document_operations
 *  still writes through the existing external/api path (engine.executeExternal),
 *  not an agent turn, so it keeps its own input schema. */
export function registerDocumentTools(engine: DocumentEngine, context = (document as Document & { modelContext?: PageContext }).modelContext) {
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const execute: Record<string, (input: unknown) => unknown> = {
    read_document: () => engine.snapshot(),
    read_blocks: input => {
      const parsed = realtimeReadBlocksSchema.safeParse(input);
      return parsed.success ? engine.readBlocks(parsed.data.ids) : { ok: false, code: 'INVALID', error: parsed.error.issues[0]?.message ?? 'Invalid arguments.' };
    },
    apply_document_operations: input => engine.executeExternal(input),
  };
  const tools: PageTool[] = Object.keys(execute).map(name => {
    const entry = documentToolCatalog.find(item => item.name === name)!;
    return {
      name, title: titles[name], description: entry.description,
      inputSchema: name === 'apply_document_operations' ? externalDocumentSchema : entry.parameters,
      annotations: { readOnlyHint: entry.readOnly, untrustedContentHint: true },
      execute: execute[name],
    };
  });
  for (const tool of tools) {
    try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {}); }
    catch { /* Unsupported experimental API must never prevent editing. */ }
  }
  return () => lifecycle.abort();
}
