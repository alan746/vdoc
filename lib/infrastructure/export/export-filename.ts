import { UNTITLED_DOCUMENT } from '../../domain/entities/document';
type Extension = 'vdoc.json' | 'docx' | 'html' | 'txt';

/** A conservative filename budget, including the extension. The document's
 * title remains untouched; only the suggested local download name is changed.
 */
export function exportFilename(title: string, extension: Extension): string {
  const cleanEnd = (value: string) => value.trim().replace(/[. ]+$/u, '');
  let stem = cleanEnd(Array.from(title, character => {
    const code = character.codePointAt(0)!;
    return code < 32 || code === 127 ? '_' : character;
  }).join('').replace(/[\\/:*?"<>|]/g, '_')) || UNTITLED_DOCUMENT;
  // Windows device names are reserved even when followed by an extension.
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
  const suffix = `.${extension}`, encoder = new TextEncoder();
  const budget = 240 - encoder.encode(suffix).length;
  let prefix = '', bytes = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(stem)) {
    const size = encoder.encode(segment).length;
    if (bytes + size > budget) break;
    prefix += segment; bytes += size;
  }
  return `${cleanEnd(prefix) || UNTITLED_DOCUMENT}${suffix}`;
}
