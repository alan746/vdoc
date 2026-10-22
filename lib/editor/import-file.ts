import { parseDocument, type SavedDocument } from './storage';
import { decodeTextFile } from './text-import';
import { truncateGraphemePrefix } from './unicode';
export type DocumentImport = { document: SavedDocument; format: 'word' | 'text' | 'backup'; warnings: string[] };

// Keep conversion notices separate from the document schema and persisted content.
export async function readDocumentImport(file: File): Promise<DocumentImport> {
  // Backups must be restorable at the same sizes supported by local storage.
  // Word/text conversion still has its own bounded import path.
  if (!/\.json$/i.test(file.name) && file.size > 20_000_000) throw new Error('The file exceeds the 20 MB import limit for Word and text files.');
  const title = truncateGraphemePrefix(file.name.replace(/\.(docx|txt)$/i, ''), 120) || 'Untitled document';
  if (/\.docx$/i.test(file.name)) {
    const { importWord } = await import('./word');
    const result = await importWord(await file.arrayBuffer());
    return { document: parseDocument(JSON.stringify({ version: 1, title, content: result.content, savedAt: new Date().toISOString() }), 20_000_000), format: 'word', warnings: [...new Set(result.warnings.map(message => message.trim()).filter(Boolean))] };
  }
  if (/\.txt$/i.test(file.name)) return { document: { version: 1, title, savedAt: new Date().toISOString(), content: { type: 'doc', content: decodeTextFile(await file.arrayBuffer()).split(/\r\n|\r|\n/).map(text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })) } }, format: 'text', warnings: [] };
  // JSON syntax/schema validation cannot detect characters already replaced by
  // Blob.text(). Native backups are UTF-8; reject malformed bytes before parsing.
  const bytes = await file.arrayBuffer();
  let raw: string;
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('This backup contains invalid UTF-8 text. Choose an intact VDoc backup file.'); }
  return { document: parseDocument(raw), format: 'backup', warnings: [] };
}

export async function importDocumentFile(file: File): Promise<SavedDocument> {
  return (await readDocumentImport(file)).document;
}
