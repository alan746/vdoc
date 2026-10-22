import { beforeAll, expect, it, vi } from 'vitest';
import { readDocumentImport } from '../lib/editor/import-file';
import { exportWord } from '../lib/editor/word';

vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const text = 'Keep 中文 العربية 日本語';
let wordBytes: ArrayBuffer;
beforeAll(async () => {
  const blob = await exportWord({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, 'Source');
  wordBytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob);
  });
});

it.each(['txt', 'docx'])('imports %s filenames without cutting a visible character at the title limit', async format => {
  const bytes = format === 'txt' ? new TextEncoder().encode(text).buffer : wordBytes;
  for (const cluster of ['😀', 'e\u0301', '👩‍💻', 'कि']) {
    const stem = 'a'.repeat(119) + cluster + ' Z';
    const file = { name: `${stem}.${format}`, size: bytes.byteLength, arrayBuffer: async () => bytes } as File;
    const result = await readDocumentImport(file);
    expect(result.document.title, cluster).toBe('a'.repeat(119));
    expect(result.document.content.content?.[0].content?.[0].text).toBe(text);
    const exact = await readDocumentImport({ ...file, name: `${'a'.repeat(120 - cluster.length)}${cluster}.${format}` } as File);
    expect(exact.document.title).toBe('a'.repeat(120 - cluster.length) + cluster);
  }
});
