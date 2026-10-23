import { writeFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import * as d from 'docx';
import JSZip from 'jszip';
import { importWord, exportWord } from '../lib/infrastructure/word/word';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { parseDocument } from '../lib/infrastructure/persistence/document-codec';
import { previewSource } from '../lib/infrastructure/preview/paged-preview';
import { colorToHex } from '../lib/domain/text/color';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(e => e.destroy()));
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as ArrayBuffer); r.onerror = reject; r.readAsArrayBuffer(blob); });
const style = (id: string, props: string, base = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id === 'Heading2' ? 'heading 2' : id}"/>${base ? `<w:basedOn w:val="${base}"/>` : ''}<w:pPr>${props}</w:pPr></w:style>`;
async function fixture(o: { styles?: string; defaults?: string; paragraphs?: string[]; cell?: string; runs?: string[]; children?: (d.Paragraph | d.Table)[] }) {
  const children = o.children || (o.paragraphs || ['']).map((_, i) => new d.Paragraph({ style: 'Child', text: `Paragraph ${i} 中文 العربية` }));
  const zip = await JSZip.loadAsync(await bytes(await d.Packer.toBlob(new d.Document({ sections: [{ children }] }))));
  zip.file('word/styles.xml', `<w:styles xmlns:w="${W}"><w:docDefaults><w:pPrDefault><w:pPr>${o.defaults || ''}</w:pPr></w:pPrDefault></w:docDefaults>${o.styles || ''}</w:styles>`);
  const xml = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
  const add = (target: Element, name: string, props: string) => {
    let pr = Array.from(target.children).find(e => e.namespaceURI === W && e.localName === name);
    if (!pr) { pr = xml.createElementNS(W, `w:${name}`); target.insertBefore(pr, target.firstChild); }
    const parsed = new DOMParser().parseFromString(`<w:root xmlns:w="${W}">${props}</w:root>`, 'application/xml');
    for (const el of Array.from(parsed.documentElement.children)) pr.appendChild(xml.importNode(el, true));
  };
  Array.from(xml.getElementsByTagNameNS(W, 'p')).forEach((p, i) => { if (o.paragraphs?.[i]) add(p, 'pPr', o.paragraphs[i]); });
  Array.from(xml.getElementsByTagNameNS(W, 'r')).forEach((r, i) => { if (o.runs?.[i]) add(r, 'rPr', o.runs[i]); });
  if (o.cell) Array.from(xml.getElementsByTagNameNS(W, 'tc')).forEach(c => add(c, 'tcPr', o.cell!));
  zip.file('word/document.xml', new XMLSerializer().serializeToString(xml));
  zip.file('word/theme/decoration.xml', '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="QA"><a:themeElements><a:clrScheme name="QA"><a:accent1><a:srgbClr val="808080"/></a:accent1><a:accent2><a:srgbClr val="336699"/></a:accent2></a:clrScheme></a:themeElements></a:theme>');
  const rels = (await zip.file('word/_rels/document.xml.rels')!.async('string')).replace(/<Relationship\b[^>]*Type="[^"]*\/theme"[^>]*\/>/g, '');
  zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>', '<Relationship Id="rIdDecorationTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/decoration.xml"/></Relationships>'));
  return zip.generateAsync({ type: 'arraybuffer' });
}
const nodes = (doc: JSONContent, type: string): JSONContent[] => [...(doc.type === type ? [doc] : []), ...(doc.content || []).flatMap(n => nodes(n, type))];
const paragraphs = (doc: JSONContent): JSONContent[] => [...(['paragraph', 'heading'].includes(doc.type || '') ? [doc] : []), ...(doc.content || []).flatMap(paragraphs)];
const decorations = (doc: JSONContent) => paragraphs(doc).filter(n => n.content?.length).map(n => ({ background: n.attrs?.paragraphBackground, borders: n.attrs?.paragraphBorders, join: n.attrs?.paragraphBorderJoin }));
const edge = (color = '#336699', width = 2, padding = 3) => ({ color, width, padding, style: 'solid' });

it('inherits paragraph shading in defaults, heading, list and cell with isolated direct override', async () => {
  const styles = style('Base', '<w:shd w:val="clear" w:fill="DDEEFF"/>') + style('Child', '', 'Base') + style('Heading2', '', 'Child') + style('ListParagraph', '', 'Child');
  const result = await importWord(await fixture({ styles, defaults: '<w:shd w:val="clear" w:fill="FFF2CC"/>', children: [
    new d.Paragraph('Default'), new d.Paragraph({ text: 'Body', style: 'Child' }), new d.Paragraph({ text: 'Heading', heading: d.HeadingLevel.HEADING_2 }), new d.Paragraph({ text: 'List', bullet: { level: 0 } }),
    new d.Table({ rows: [new d.TableRow({ children: [new d.TableCell({ children: [new d.Paragraph({ text: 'Cell', style: 'Child' })] })] })] }),
    new d.Paragraph({ text: 'Override', style: 'Child' }), new d.Paragraph({ text: 'Sibling', style: 'Child' }),
  ], paragraphs: ['', '', '', '', '', '<w:shd w:val="clear" w:fill="AABBCC"/>', ''] }));
  expect(decorations(result.content).map(n => n.background)).toEqual(['#FFF2CC', '#DDEEFF', '#DDEEFF', '#DDEEFF', '#DDEEFF', '#AABBCC', '#DDEEFF']);
});

it('inherits borders by edge and replaces a child edge as a unit without contaminating siblings', async () => {
  const base = '<w:pBdr><w:top w:val="single" w:sz="12" w:space="3" w:color="336699"/><w:left w:val="dashed" w:sz="6" w:space="6" w:color="884422"/><w:between w:val="single" w:sz="6" w:space="0" w:color="336699"/></w:pBdr>';
  const result = await importWord(await fixture({ styles: style('Base', base) + style('Child', '<w:pBdr><w:top w:val="dotted" w:sz="6" w:color="008800"/></w:pBdr>', 'Base'), children: [new d.Paragraph({ text: 'Child', style: 'Child' }), new d.Paragraph({ text: 'Base', style: 'Base' })] }));
  const [a, b] = decorations(result.content);
  expect(a.borders).toEqual({ top: { ...edge('#008800', 1, 0), style: 'dotted' }, left: { ...edge('#884422', 1, 6), style: 'dashed' }, between: edge('#336699', 1, 0) });
  expect(b.borders.top).toEqual(edge()); expect(a.join).toBe(true); expect(b.join).toBe(true);
});

it.each(['nil', 'none'])('clears inherited borders with %s while retaining other edges', async val => {
  const result = await importWord(await fixture({ styles: style('Child', '<w:pBdr><w:top w:val="single" w:sz="12" w:color="336699"/><w:left w:val="single" w:sz="6" w:color="336699"/><w:between w:val="single" w:sz="6" w:color="336699"/></w:pBdr>'), paragraphs: [`<w:pBdr><w:top w:val="${val}"/><w:between w:val="${val}"/></w:pBdr>`] }));
  expect(decorations(result.content)[0]).toEqual({ background: null, borders: { left: edge('#336699', 1, 0) }, join: true });
});

it.each(['<w:shd w:val="nil" w:fill="FF0000"/>', '<w:shd w:val="clear" w:fill="auto"/>', '<w:shd w:val="clear"/>'])('clears inherited shading with %s', async direct => {
  const result = await importWord(await fixture({ styles: style('Child', '<w:shd w:val="clear" w:fill="DDEEFF"/>'), paragraphs: [direct, ''] }));
  expect(decorations(result.content).map(n => n.background)).toEqual([null, '#DDEEFF']);
});

it('resolves paragraph and cell theme shading, border tint and solid foreground color', async () => {
  const result = await importWord(await fixture({ children: [new d.Paragraph('Theme'), new d.Table({ rows: [new d.TableRow({ children: [new d.TableCell({ children: [new d.Paragraph('Cell')] })] })] })], paragraphs: [
    '<w:shd w:val="clear" w:fill="FF0000" w:themeFill="accent1" w:themeFillTint="80"/><w:pBdr><w:top w:val="single" w:sz="12" w:space="3" w:color="FF0000" w:themeColor="accent2"/></w:pBdr>',
    '<w:shd w:val="solid" w:fill="FF0000" w:themeColor="accent1" w:themeShade="80"/>',
  ], cell: '<w:shd w:val="clear" w:fill="FF0000" w:themeFill="accent2"/>' }));
  expect(decorations(result.content).map(n => n.background)).toEqual(['#BFBFBF', '#404040']);
  expect(decorations(result.content)[0].borders.top).toEqual(edge());
  expect(colorToHex(nodes(result.content, 'tableCell')[0].attrs!.backgroundColor)).toBe('#336699');
});

it('does not borrow decoration from historical paragraph properties', async () => {
  const result = await importWord(await fixture({ styles: style('Child', '<w:pPrChange><w:pPr><w:shd w:fill="FF0000"/><w:pBdr><w:top w:val="single" w:sz="12"/></w:pBdr></w:pPr></w:pPrChange>'), paragraphs: ['<w:pPrChange><w:pPr><w:shd w:fill="00FF00"/></w:pPr></w:pPrChange>'] }));
  expect(decorations(result.content)[0]).toEqual({ background: null, borders: null, join: false });
});

it('warns once for patterned shading and unsupported border effects, preserving representable background', async () => {
  const result = await importWord(await fixture({ paragraphs: Array(2).fill('<w:shd w:val="pct20" w:fill="DDEEFF"/><w:pBdr><w:top w:val="double" w:sz="12"/><w:left w:val="single" w:sz="12" w:space="bad"/></w:pBdr>') }));
  expect(decorations(result.content).map(n => n.background)).toEqual(['#DDEEFF', '#DDEEFF']);
  expect(decorations(result.content).map(n => n.borders)).toEqual([null, null]);
  expect(result.warnings.filter(m => m.includes('shading pattern'))).toHaveLength(1);
  expect(result.warnings.filter(m => m.includes('paragraph border'))).toHaveLength(1);
});

it('keeps combined decoration across edit/undo, HTML, backup, preview and two Word roundtrips', async () => {
  const properties = '<w:shd w:val="clear" w:themeFill="accent1" w:themeFillTint="80"/><w:pBdr><w:top w:val="single" w:sz="12" w:space="3" w:themeColor="accent2"/><w:bottom w:val="dotted" w:sz="6" w:space="3" w:color="336699"/><w:left w:val="single" w:sz="12" w:space="3" w:color="336699"/><w:right w:val="single" w:sz="12" w:space="3" w:color="336699"/><w:between w:val="single" w:sz="6" w:space="3" w:color="336699"/></w:pBdr>';
  const children = [new d.Paragraph({ style: 'Child', text: 'Inherited frame 中文 العربية' }), new d.Paragraph({ style: 'Child', text: 'Second paragraph 日本語 हिन्दी' }), new d.Paragraph({ style: 'Child', text: 'Cleared background Français עברית' }), new d.Table({ rows: [new d.TableRow({ children: [new d.TableCell({ children: [new d.Paragraph({ style: 'Child', text: 'Cell paragraph — independent background' })] })] })] })];
  const buffer = await fixture({ styles: style('Child', properties), children, paragraphs: ['', '', '<w:shd w:val="nil"/>', ''], cell: '<w:shd w:val="clear" w:themeFill="accent2"/>' });
  const originalBytes = new Uint8Array(buffer).slice(), result = await importWord(buffer);
  expect(decorations(result.content).map(n => n.background)).toEqual(['#BFBFBF', '#BFBFBF', null, '#BFBFBF']);
  const editor = new Editor({ extensions: createExtensions(), content: result.content }); editors.push(editor);
  await new Promise(resolve => setTimeout(resolve, 0)); const original = editor.getJSON();
  const other = new Editor({ extensions: createExtensions(), content: editor.getHTML() }); editors.push(other);
  expect(other.getJSON().content).toEqual(original.content);
  expect(parseDocument(JSON.stringify({ version: 1, title: 'Decoration QA', content: original })).content).toEqual(original);
  expect(previewSource('Decoration QA', editor.getHTML(), original).html).toContain('data-paragraph-border-join="true"');
  let current: JSONContent = original;
  for (let i = 0; i < 2; i++) { current = (await importWord(await bytes(await exportWord(current, 'Decoration QA')))).content; expect(decorations(current)).toEqual(decorations(original)); expect(nodes(current, 'tableCell').map(n => colorToHex(n.attrs!.backgroundColor))).toEqual(nodes(original, 'tableCell').map(n => colorToHex(n.attrs!.backgroundColor))); expect(nodes(current, 'text').map(n => n.text)).toEqual(nodes(original, 'text').map(n => n.text)); }
  editor.commands.selectAll(); const engine = new DocumentEngine(editor);
  try { expect(engine.execute({ operations: [{ type: 'paragraph.style', paragraphBackground: '#FFF2CC' }, { type: 'paragraph.border', top: false, between: false }] }).ok).toBe(true); engine.history('undo'); expect(editor.getJSON()).toEqual(original); } finally { engine.destroy(); }
  expect(new Uint8Array(buffer)).toEqual(originalBytes);
  if (process.env.VDOC_WRITE_QA_FIXTURE) writeFileSync('/private/tmp/vdoc-decoration-batch.docx', Buffer.from(buffer));
});


it.each([['w:themeTint="80"', '#BFBFBF'], ['w:themeShade="80"', '#404040']])('resolves inherited border color modifier %s', async (modifier, color) => {
  const result = await importWord(await fixture({ defaults: `<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="3" w:color="FF0000" w:themeColor="accent1" ${modifier}/></w:pBdr>`, styles: style('Child', '<w:pBdr/>') }));
  expect(decorations(result.content)[0].borders).toEqual({ bottom: edge(color) });
});

it.each(['nil', 'clear'])('clears cell shading with %s even if converted HTML already carried a fill', async value => {
  const result = await importWord(await fixture({ children: [new d.Table({ rows: [new d.TableRow({ children: [new d.TableCell({ children: [new d.Paragraph('Cell')] })] })] })], cell: `<w:shd w:val="${value}" w:fill="${value === 'nil' ? 'FF0000' : 'auto'}"/>` }));
  expect(nodes(result.content, 'tableCell')[0].attrs!.backgroundColor).toBeNull();
});

it.each(['w:sz="49"', 'w:sz="12" w:space="32"', 'w:sz="12" w:space="1.5"'])('reports unsupported border dimensions %s without silently clamping', async dimensions => {
  const result = await importWord(await fixture({ paragraphs: [`<w:pBdr><w:top w:val="single" ${dimensions}/></w:pBdr>`] }));
  expect(decorations(result.content)[0].borders).toBeNull();
  expect(result.warnings.filter(m => m.includes('paragraph border'))).toHaveLength(1);
});

it('shares shading semantics for text, leaving separate highlighting intact', async () => {
  const result = await importWord(await fixture({ children: [new d.Paragraph({ children: ['Nil', 'Solid', 'Highlighted'].map(text => new d.TextRun(text)) })], runs: [
    '<w:shd w:val="nil" w:fill="FF0000"/>', '<w:shd w:val="solid" w:color="008800" w:fill="FF0000"/>', '<w:shd w:val="nil" w:fill="FF0000"/><w:highlight w:val="yellow"/>',
  ] }));
  expect(nodes(result.content, 'text').map(n => colorToHex(n.marks?.find(m => m.type === 'highlight')?.attrs?.color))).toEqual([null, '#008800', '#FFFF00']);
});

it('applies table and row shading defaults with cell overrides and nested-table isolation', async () => {
  const inner = new d.Table({ rows: [new d.TableRow({ children: [new d.TableCell({ children: [new d.Paragraph('Nested')] })] })] });
  const children = [new d.Table({ rows: [
    new d.TableRow({ children: [new d.TableCell({ children: [new d.Paragraph('Table default')] }), new d.TableCell({ children: [new d.Paragraph('Local clear')] })] }),
    new d.TableRow({ children: [new d.TableCell({ children: [new d.Paragraph('Row default')] }), new d.TableCell({ children: [new d.Paragraph('Override'), inner] })] }),
  ] })];
  const zip = await JSZip.loadAsync(await fixture({ children }));
  const xml = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
  const append = (target: Element, content: string) => { const parsed = new DOMParser().parseFromString(`<w:root xmlns:w="${W}">${content}</w:root>`, 'application/xml'); for (const c of Array.from(parsed.documentElement.children)) target.appendChild(xml.importNode(c, true)); };
  const table = xml.getElementsByTagNameNS(W, 'tbl')[0];
  append(Array.from(table.children).find(n => n.localName === 'tblPr')!, '<w:shd w:val="clear" w:themeFill="accent2"/>');
  const rows = Array.from(table.children).filter(n => n.localName === 'tr');
  append(rows[1], '<w:tblPrEx><w:shd w:val="clear" w:themeFill="accent1" w:themeFillTint="80"/></w:tblPrEx>');
  rows[1].insertBefore(rows[1].lastElementChild!, rows[1].firstChild);
  const cells = Array.from(xml.getElementsByTagNameNS(W, 'tc'));
  const cellProps = (cell: Element) => { let p = Array.from(cell.children).find(n => n.localName === 'tcPr'); if (!p) { p = xml.createElementNS(W, 'w:tcPr'); cell.insertBefore(p, cell.firstChild); } return p; };
  append(cellProps(cells[1]), '<w:shd w:val="nil"/>');
  append(cellProps(cells[3]), '<w:shd w:val="clear" w:fill="FFF2CC"/>');
  zip.file('word/document.xml', new XMLSerializer().serializeToString(xml));
  const result = await importWord(await zip.generateAsync({ type: 'arraybuffer' }));
  expect(nodes(result.content, 'tableCell').map(n => colorToHex(n.attrs!.backgroundColor))).toEqual(['#336699', null, '#BFBFBF', '#FFF2CC', null]);
});
