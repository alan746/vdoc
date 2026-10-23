import JSZip from 'jszip';
import { W, child } from './ooxml';


/** Convert our Word content-control boundaries into temporary Mammoth markers.
 * The downloaded file contains no marker paragraphs. Formatting is restored
 * from the original XML after these temporary HTML markers have been removed. */
export async function prepareWordBlockquotes(buffer: ArrayBuffer) {
  const zip = await JSZip.loadAsync(buffer);
  const raw = await zip.file('word/document.xml')?.async('string');
  const unchanged = { buffer, styleMap: [] as string[], restore: (_html: Document, _warnings: string[]) => {} };
  if (!raw || !raw.includes('vdoc:blockquote:v1:')) return unchanged;
  if (raw.length > 20_000_000) throw new Error('The Word document is too large to import.');
  const xml = new DOMParser().parseFromString(raw, 'application/xml');
  const controls = Array.from(xml.getElementsByTagNameNS(W, 'sdt')).flatMap(node => {
    const properties = child(node, 'sdtPr'), tag = properties && child(properties, 'tag');
    const match = tag?.getAttributeNS(W, 'val')?.match(/^vdoc:blockquote:v1:list=(-1|[0-8])$/);
    const content = child(node, 'sdtContent');
    return match && content ? [{ node, content, level: Number(match[1]) }] : [];
  });
  if (!controls.length) return unchanged;
  const stylesRaw = await zip.file('word/styles.xml')?.async('string');
  if (!stylesRaw) return { ...unchanged, restore: (_html: Document, warnings: string[]) => { warnings.push('Some quote boundaries could not be restored because Word styles are missing. Quote text is preserved.'); } };
  if (stylesRaw.length > 20_000_000) throw new Error('The Word styles are too large to import.');
  const styles = new DOMParser().parseFromString(stylesRaw, 'application/xml');
  const prefix = `VDocQuote${crypto.randomUUID().replaceAll('-', '')}`;
  const styleMap: string[] = [];
  const markers = controls.map((control, i) => ({ ...control, start: `${prefix}Start${i}`, end: `${prefix}End${i}` }));
  const marker = (id: string, level: number) => {
    const style = styles.createElementNS(W, 'w:style'); style.setAttributeNS(W, 'w:type', 'paragraph'); style.setAttributeNS(W, 'w:styleId', id);
    const name = styles.createElementNS(W, 'w:name'); name.setAttributeNS(W, 'w:val', id); style.appendChild(name); styles.documentElement.appendChild(style);
    styleMap.push(`p[style-name='${id}'] => ${'ul|ol > li > '.repeat(level + 1)}div.${id}:fresh`);
    const p = xml.createElementNS(W, 'w:p'), properties = xml.createElementNS(W, 'w:pPr'), selected = xml.createElementNS(W, 'w:pStyle');
    selected.setAttributeNS(W, 'w:val', id); properties.appendChild(selected); p.appendChild(properties); return p;
  };
  for (const { node, content, level, start, end } of [...markers].reverse()) {
    node.replaceWith(marker(start, level), ...Array.from(content.childNodes), marker(end, level));
  }
  zip.file('word/document.xml', new XMLSerializer().serializeToString(xml));
  zip.file('word/styles.xml', new XMLSerializer().serializeToString(styles));
  return {
    buffer: await zip.generateAsync({ type: 'arraybuffer' }), styleMap,
    restore(html: Document, warnings: string[]) {
      for (const { start, end } of [...markers].reverse()) {
        const first = html.querySelector(`div.${start}`), last = html.querySelector(`div.${end}`);
        if (!first || !last || first.parentElement !== last.parentElement || !(first.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          first?.remove(); last?.remove();
          const message = 'Some quote boundaries could not be restored. Their content is preserved, but quote grouping needs review.';
          if (!warnings.includes(message)) warnings.push(message);
          continue;
        }
        const quote = html.createElement('blockquote'); quote.setAttribute('data-vdoc-word-quote','true'); first.replaceWith(quote);
        while (quote.nextSibling && quote.nextSibling !== last) quote.appendChild(quote.nextSibling);
        last.remove();
      }
    },
  };
}
