import JSZip from 'jszip';
import { wordParagraphProperties } from './word-paragraph-spacing';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const child = (parent: Element | undefined, name: string) => parent && Array.from(parent.children).find(n => n.namespaceURI === W && n.localName === name);
const attr = (node: Element | undefined, key: string) => node?.getAttributeNS(W, key) ?? undefined;

/** Mammoth reads direct numPr, but not paragraph-style numPr inheritance.
 * Materialize effective properties in the import copy so list construction and
 * our numbering restoration see the same id/level. Never alter the source file. */
export async function prepareWordNumbering(buffer: ArrayBuffer, warnings: string[]): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer);
  const stylesRaw = await zip.file('word/styles.xml')?.async('string');
  if (!stylesRaw || !/<(?:\w+:)?numPr\b/.test(stylesRaw)) return buffer;
  const raw = await zip.file('word/document.xml')?.async('string');
  if (!raw) return buffer;
  if (stylesRaw.length > 20_000_000 || raw.length > 20_000_000) throw new Error('The Word document is too large to import.');
  const parser = new DOMParser();
  const styles = parser.parseFromString(stylesRaw, 'application/xml');
  const xml = parser.parseFromString(raw, 'application/xml');
  const numberingRaw = await zip.file('word/numbering.xml')?.async('string');
  if (numberingRaw && numberingRaw.length > 20_000_000) throw new Error('The Word numbering is too large to import.');
  const definitions = numberingRaw ? parser.parseFromString(numberingRaw, 'application/xml') : null;
  const instances = new Map(Array.from(definitions?.getElementsByTagNameNS(W, 'num') || []).map(n => [attr(n, 'numId'), attr(child(n, 'abstractNumId'), 'val')]));
  const abstracts = new Map(Array.from(definitions?.getElementsByTagNameNS(W, 'abstractNum') || []).map(n => [attr(n, 'abstractNumId'), n]));
  const paragraphStyles = new Map(Array.from(styles.documentElement.children).filter(n => n.namespaceURI === W && n.localName === 'style' && attr(n, 'type') === 'paragraph').map(n => [attr(n, 'styleId'), n]));
  const defaultStyle = [...paragraphStyles.values()].find(n => ['1', 'true', 'on'].includes(attr(n, 'default') || ''));
  // A style's associated numbering level comes from numbering.xml/lvl/pStyle,
  // not the style's own ilvl (ISO 29500, numPr / pStyle). Search nearest style
  // first, then basedOn ancestors. A direct paragraph ilvl still overrides it.
  const styleLevel = (paragraph: Element, id: string) => {
    const definition = abstracts.get(instances.get(id));
    if (!definition) return undefined;
    const levels = Array.from(definition.children).filter(n => n.namespaceURI === W && n.localName === 'lvl');
    let selected = attr(child(child(paragraph, 'pPr'), 'pStyle'), 'val') || attr(defaultStyle, 'styleId');
    const seen = new Set<string>();
    while (selected && !seen.has(selected)) {
      seen.add(selected);
      const match = levels.find(n => attr(child(n, 'pStyle'), 'val') === selected);
      if (match) return attr(match, 'ilvl');
      selected = attr(child(paragraphStyles.get(selected), 'basedOn'), 'val');
    }
  };
  const resolve = wordParagraphProperties(styles, warnings);
  let changed = false;
  for (const paragraph of Array.from(xml.getElementsByTagNameNS(W, 'p'))) {
    const values = resolve(paragraph).numbering;
    if (values?.numId === undefined) continue;
    const id = values.numId;
    const level = id === '0' ? '0' : attr(child(child(child(paragraph, 'pPr'), 'numPr'), 'ilvl'), 'val') ?? styleLevel(paragraph, id) ?? '0';
    if (!/^\d+$/.test(id) || !/^[0-8]$/.test(level)) {
      const warning = 'Some Word paragraph styles use unsupported numbering values. Review imported lists.';
      if (!warnings.includes(warning)) warnings.push(warning);
      continue;
    }
    let properties = child(paragraph, 'pPr');
    if (!properties) { properties = xml.createElementNS(W, 'w:pPr'); paragraph.insertBefore(properties, paragraph.firstChild); }
    let numbering = child(properties, 'numPr');
    if (!numbering) { numbering = xml.createElementNS(W, 'w:numPr'); properties.appendChild(numbering); }
    for (const [key, value] of [['ilvl', level], ['numId', id]]) {
      let property = child(numbering, key);
      if (property?.getAttributeNS(W, 'val') === value) continue;
      if (!property) { property = xml.createElementNS(W, `w:${key}`); numbering.appendChild(property); }
      property.setAttributeNS(W, 'w:val', value); changed = true;
    }
  }
  if (!changed) return buffer;
  zip.file('word/document.xml', new XMLSerializer().serializeToString(xml));
  return zip.generateAsync({ type: 'arraybuffer' });
}
