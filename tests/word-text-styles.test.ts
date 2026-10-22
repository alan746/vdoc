import { writeFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import * as d from 'docx';
import JSZip from 'jszip';
import { importWord, exportWord } from '../lib/infrastructure/word/word';
import { createExtensions } from '../lib/editor/extensions';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
import { colorToHex } from '../lib/domain/text/color';
import { DocumentEngine } from '../lib/usecases/engine';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as ArrayBuffer); r.onerror = reject; r.readAsArrayBuffer(blob); });
const style = (id: string, type: 'paragraph' | 'character', props: string, base = '', extra = '') => `<w:style w:type="${type}" w:styleId="${id}" ${extra}><w:name w:val="${id}"/>${base ? `<w:basedOn w:val="${base}"/>` : ''}<w:rPr>${props}</w:rPr></w:style>`;
const theme = `<a:theme xmlns:a="${A}" name="QA"><a:themeElements><a:clrScheme name="QA"><a:dk1><a:srgbClr val="102030"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="808080"/></a:accent1><a:accent2><a:srgbClr val="336699"/></a:accent2></a:clrScheme><a:fontScheme name="QA"><a:majorFont><a:latin typeface="Georgia"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Hans" typeface="Noto Serif SC"/><a:font script="Arab" typeface="Amiri"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface="Noto Sans CJK"/><a:cs typeface="Noto Naskh Arabic"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
async function fixture(options: { defaults?: string; styles?: string; runs?: string[]; children?: (d.Paragraph | d.Table)[]; theme?: string; settings?: string; footnotes?: d.IPropertiesOptions['footnotes'] }) {
  const children = options.children || [new d.Paragraph({ children: (options.runs || ['']).map((_, i) => new d.TextRun(`Text${i}`)) })];
  const zip = await JSZip.loadAsync(await bytes(await d.Packer.toBlob(new d.Document({ footnotes: options.footnotes, sections: [{ children }] }))));
  zip.file('word/styles.xml', `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>${options.defaults || ''}</w:rPr></w:rPrDefault></w:docDefaults>${options.styles || ''}</w:styles>`);
  if (options.runs) {
    const xml = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
    Array.from(xml.getElementsByTagNameNS(W, 'r')).filter(run => run.getElementsByTagNameNS(W, 't').length).forEach((run, i) => {
      if (options.runs![i] === undefined) return;
      Array.from(run.children).filter(n => n.localName === 'rPr').forEach(n => n.remove());
      const rp = new DOMParser().parseFromString(`<w:rPr xmlns:w="${W}">${options.runs![i]}</w:rPr>`, 'application/xml');
      run.insertBefore(xml.importNode(rp.documentElement, true), run.firstChild);
    });
    zip.file('word/document.xml', new XMLSerializer().serializeToString(xml));
  }
  if (options.theme !== undefined) {
    zip.file('word/theme/custom.xml', options.theme);
    const rels = new DOMParser().parseFromString(await zip.file('word/_rels/document.xml.rels')!.async('string'), 'application/xml');
    const rel = rels.createElementNS(rels.documentElement.namespaceURI, 'Relationship'); rel.setAttribute('Id', 'rIdQATheme'); rel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme'); rel.setAttribute('Target', 'theme/custom.xml');
    Array.from(rels.documentElement.children).filter(n => n.getAttribute('Type')?.endsWith('/theme')).forEach(n => n.remove());
    rels.documentElement.appendChild(rel); zip.file('word/_rels/document.xml.rels', new XMLSerializer().serializeToString(rels));
  }
  if (options.settings) zip.file('word/settings.xml', `<w:settings xmlns:w="${W}">${options.settings}</w:settings>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}
function texts(node: JSONContent): JSONContent[] { return node.type === 'text' ? [node] : (node.content || []).flatMap(texts); }
const typography = (node: JSONContent) => {
  const a = node.marks?.find(m => m.type === 'textStyle')?.attrs || {};
  return { font: a.fontFamily || null, size: a.fontSize || null, color: colorToHex(a.color), bold: !!node.marks?.some(m => m.type === 'bold'), italic: !!node.marks?.some(m => m.type === 'italic'), underline: !!node.marks?.some(m => m.type === 'underline'), strike: !!node.marks?.some(m => m.type === 'strike') };
};

it('materializes document default typography and preserves direct overrides without leaking between runs', async () => {
  const buffer = await fixture({ defaults: '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="Georgia"/><w:sz w:val="36"/><w:color w:val="884422"/>', runs: ['', '<w:sz w:val="48"/><w:color w:val="0000CC"/>', ''] });
  const result = await importWord(buffer), nodes = texts(result.content);
  expect(nodes.map(typography)).toEqual([
    expect.objectContaining({ font: 'Georgia', size: '24px', color: '#884422' }),
    expect.objectContaining({ font: 'Georgia', size: '32px', color: '#0000CC' }),
    expect.objectContaining({ font: 'Georgia', size: '24px', color: '#884422' }),
  ]);
});

it('combines paragraph and character basedOn chains, with style toggle semantics and absolute direct off', async () => {
  const styles = style('Base', 'paragraph', '<w:rFonts w:ascii="Georgia"/><w:sz w:val="36"/><w:b/>') + style('Child', 'paragraph', '<w:color w:val="884422"/><w:b/>', 'Base') + style('Emphasis', 'character', '<w:i/><w:u w:val="single"/>') + style('Accent', 'character', '<w:color w:val="0000CC"/><w:i/>', 'Emphasis');
  const result = await importWord(await fixture({ styles, children: [new d.Paragraph({ style: 'Child', children: [new d.TextRun('Base'), new d.TextRun('Accent'), new d.TextRun('Override')] })], runs: ['', '<w:rStyle w:val="Accent"/>', '<w:rStyle w:val="Accent"/><w:b/><w:i/><w:u w:val="none"/><w:rFonts w:ascii="Verdana"/>'] }));
  expect(texts(result.content).map(typography)).toEqual([
    expect.objectContaining({ font: 'Georgia', size: '24px', color: '#884422', bold: false, italic: false }),
    expect.objectContaining({ font: 'Georgia', size: '24px', color: '#0000CC', bold: false, italic: false, underline: true }),
    expect.objectContaining({ font: 'Verdana', size: '24px', color: '#0000CC', bold: true, italic: true, underline: false }),
  ]);
});

it.each([['', '#808080'], ['w:themeTint="80"', '#BFBFBF'], ['w:themeShade="80"', '#404040'], ['w:themeShade="80" w:themeTint="80"', '#BFBFBF']])('resolves theme fonts and colors with %s from the relationship-selected theme', async (modifier, color) => {
  const result = await importWord(await fixture({ theme, runs: [`<w:rFonts w:ascii="Wrong" w:asciiTheme="majorAscii"/><w:color w:val="FF0000" w:themeColor="accent1" ${modifier}/>`] }));
  expect(typography(texts(result.content)[0])).toMatchObject({ font: 'Georgia', color });
});

it('lets explicit child fonts and colors replace inherited theme references and honors color remapping', async () => {
  const result = await importWord(await fixture({ theme, defaults: '<w:rFonts w:asciiTheme="majorAscii"/><w:color w:themeColor="accent1"/>', settings: '<w:clrSchemeMapping w:accent1="accent2"/>', runs: ['', '<w:rFonts w:ascii="Verdana"/><w:color w:val="008800"/>'] }));
  expect(texts(result.content).map(typography)).toEqual([expect.objectContaining({ font: 'Georgia', color: '#336699' }), expect.objectContaining({ font: 'Verdana', color: '#008800' })]);
});

it('selects ASCII, extended Latin and CJK fonts without splitting emoji or combining graphemes', async () => {
  const value = 'Aé中か한👩‍💻e\u0301';
  const result = await importWord(await fixture({ children: [new d.Paragraph(value)], runs: ['<w:rFonts w:ascii="Arial" w:hAnsi="Georgia" w:eastAsia="Noto Sans CJK"/>'] }));
  const nodes = texts(result.content);
  expect(nodes.map(n => n.text).join('')).toBe(value);
  expect(nodes.map(n => [n.text, typography(n).font])).toEqual([['A', 'Arial'], ['é', 'Georgia'], ['中か한', 'Noto Sans CJK'], ['👩‍💻', 'Georgia'], ['e\u0301', 'Arial']]);
});

it.each([['zh-CN', '中文', 'Hans', 'Noto Serif SC'], ['ar-SA', 'العربية', 'Arab', 'Amiri']] as const)('resolves supplemental theme font for %s', async (language, value, _, font) => {
  const complex = language === 'ar-SA';
  const result = await importWord(await fixture({ theme, children: [new d.Paragraph(value)], runs: [`<w:rFonts ${complex ? 'w:cstheme="majorBidi"' : 'w:eastAsiaTheme="majorEastAsia"'}/><w:lang w:val="${language}" w:eastAsia="${language}" w:bidi="${language}"/>${complex ? '<w:rtl/><w:szCs w:val="42"/><w:bCs/>' : ''}`] }));
  const nodes = texts(result.content); expect(nodes.map(n => n.text).join('')).toBe(value);
  for (const node of nodes) expect(typography(node)).toMatchObject({ font, ...(complex ? { size: '28px', bold: true } : {}) });
});

it('preserves direct off overrides inside links, footnote neighbors and breaks, with backup/HTML/Word and undo', async () => {
  const styles = style('Body', 'paragraph', '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="Georgia"/><w:sz w:val="36"/><w:color w:val="884422"/><w:b/><w:i/><w:u w:val="single"/><w:strike/>');
  const children = [new d.Paragraph({ style: 'Body', children: [new d.TextRun('Before 中文'), new d.ExternalHyperlink({ link: 'https://example.com/current', children: [new d.TextRun({ children: ['Link العربية', new d.CarriageReturn(), 'After 日本語'] })] }), new d.FootnoteReferenceRun(1), new d.TextRun(' Plain हिन्दी')] })];
  const buffer = await fixture({ styles, children, footnotes: { 1: { children: [new d.Paragraph('Reference עברית')] } }, runs: ['', '<w:b w:val="0"/><w:i w:val="false"/><w:u w:val="none"/><w:strike w:val="off"/>', '<w:color w:val="008800"/>'] });
  const originalBytes = new Uint8Array(buffer).slice(), result = await importWord(buffer), nodes = texts(result.content);
  for (const node of nodes.filter(n => n.marks?.some(m => m.type === 'link'))) expect(typography(node)).toMatchObject({ font: 'Georgia', size: '24px', color: '#884422', bold: false, italic: false, underline: false, strike: false });
  expect(result.content.content![0].content!.filter(n => n.type === 'hardBreak')).toHaveLength(1);
  expect(result.content.content![0].content!.find(n => n.type === 'footnote')?.attrs?.text).toBe('Reference עברית');
  const editor = new Editor({ extensions: createExtensions(), content: result.content }); editors.push(editor);
  await new Promise(resolve => setTimeout(resolve, 0)); const original = editor.getJSON();
  const other = new Editor({ extensions: createExtensions(), content: editor.getHTML() }); editors.push(other);
  expect(other.getJSON().content).toEqual(original.content);
  expect(parseDocument(JSON.stringify({ version: 1, title: 'Typography', content: original })).content).toEqual(original);
  let content: JSONContent = original;
  for (let i = 0; i < 2; i++) { content = (await importWord(await bytes(await exportWord(content, 'Typography')))).content; expect(texts(content).map(typography)).toEqual(texts(original).map(typography)); expect(texts(content).map(n => n.text)).toEqual(texts(original).map(n => n.text)); }
  editor.commands.selectAll(); const engine = new DocumentEngine(editor);
  try { expect(engine.execute({ operations: [{ type: 'text.toggle', mark: 'bold' }] }).ok).toBe(true); engine.history('undo'); expect(editor.getJSON()).toEqual(original); } finally { engine.destroy(); }
  expect(new Uint8Array(buffer)).toEqual(originalBytes);
});

it('ignores historical style properties and bounds cyclic character style inheritance', async () => {
  const styles = style('A', 'character', '<w:rFonts w:ascii="Georgia"/><w:rPrChange><w:rPr><w:sz w:val="96"/></w:rPr></w:rPrChange>', 'B') + style('B', 'character', '<w:color w:val="008800"/>', 'A');
  const result = await importWord(await fixture({ styles, runs: ['<w:rStyle w:val="A"/>'] }));
  expect(typography(texts(result.content)[0])).toMatchObject({ font: 'Georgia', color: '#008800', size: null });
  expect(result.warnings.some(m => m.includes('text style inheritance'))).toBe(true);
});

it('reports unresolved theme references once, preserves text and uses explicit fallback values', async () => {
  const result = await importWord(await fixture({ theme: '', runs: ['<w:rFonts w:ascii="Verdana" w:asciiTheme="majorAscii"/><w:color w:val="008800" w:themeColor="accent1"/>', '<w:rFonts w:asciiTheme="majorAscii"/>'] }));
  expect(typography(texts(result.content)[0])).toMatchObject({ font: 'Verdana', color: '#008800' });
  expect(texts(result.content).map(n => n.text).join('')).toBe('Text0Text1');
  expect(result.warnings.filter(m => m.includes('theme'))).toHaveLength(1);
});


it('inherits typography in headings, lists and table cells without sharing sibling overrides', async () => {
  const base = '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="Georgia"/><w:sz w:val="36"/><w:color w:val="884422"/>';
  const styles = style('Normal', 'paragraph', base, '', 'w:default="1"') + style('Heading2', 'paragraph', '<w:b/>', 'Normal') + style('ListParagraph', 'paragraph', '<w:i/>', 'Normal') + style('Cell', 'paragraph', '<w:u w:val="single"/>', 'Normal');
  const result = await importWord(await fixture({ styles, children: [
    new d.Paragraph({ heading: d.HeadingLevel.HEADING_2, text: 'Heading 中文' }),
    new d.Paragraph({ bullet: { level: 0 }, text: 'List 日本語' }),
    new d.Table({ rows: [new d.TableRow({ children: [new d.TableCell({ children: [new d.Paragraph({ style: 'Cell', text: 'Cell العربية' })] })] })] }),
    new d.Paragraph('Sibling Français'),
  ] }));
  const nodes = texts(result.content);
  expect(nodes.map(n => n.text)).toEqual(['Heading 中文', 'List 日本語', 'Cell العربية', 'Sibling Français']);
  for (const node of nodes) expect(typography(node)).toMatchObject({ font: 'Georgia', size: '24px', color: '#884422' });
  expect(nodes.map(typography)).toEqual([
    expect.objectContaining({ bold: true, italic: false, underline: false }),
    expect.objectContaining({ bold: false, italic: true, underline: false }),
    expect.objectContaining({ bold: false, italic: false, underline: true }),
    expect.objectContaining({ bold: false, italic: false, underline: false }),
  ]);
});

it('restores text beside an image while keeping its dimensions and alternative text', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6x8AAAAASUVORK5CYII=', 'base64');
  const result = await importWord(await fixture({ defaults: '<w:rFonts w:ascii="Georgia"/><w:sz w:val="36"/>', children: [new d.Paragraph({ children: [
    new d.TextRun('Before'), new d.ImageRun({ type: 'png', data: png, transformation: { width: 180, height: 90 }, altText: { name: 'QA', title: 'QA', description: 'QA image' } }), new d.TextRun('After'),
  ] })], runs: ['<w:color w:val="008800"/>', '<w:color w:val="0000CC"/>'] }));
  expect(texts(result.content).map(typography)).toEqual([
    expect.objectContaining({ font: 'Georgia', size: '24px', color: '#008800' }),
    expect.objectContaining({ font: 'Georgia', size: '24px', color: '#0000CC' }),
  ]);
  const findImages = (node: JSONContent): JSONContent[] => node.type === 'image' ? [node] : (node.content || []).flatMap(findImages);
  expect(findImages(result.content)).toHaveLength(1);
  expect(findImages(result.content)[0].attrs).toMatchObject({ width: 180, height: 90, alt: 'QA image' });
});

it('resolves long typography chains iteratively and isolates paragraph/character IDs and sibling caches', async () => {
  let styles = style('S0', 'paragraph', '<w:rFonts w:ascii="Georgia"/><w:sz w:val="36"/><w:b/>');
  for (let i = 1; i < 600; i++) styles += style(`S${i}`, 'paragraph', '<w:b/>', `S${i - 1}`);
  styles += style('S599', 'character', '<w:i/><w:color w:val="008800"/>');
  const result = await importWord(await fixture({ styles, children: [
    new d.Paragraph({ style: 'S599', text: 'Deep' }), new d.Paragraph({ style: 'S0', text: 'Root' }), new d.Paragraph({ style: 'S599', text: 'Again' }),
  ], runs: ['<w:rStyle w:val="S599"/>', '', ''] }));
  expect(texts(result.content).map(typography)).toEqual([
    expect.objectContaining({ font: 'Georgia', size: '24px', bold: false, italic: true, color: '#008800' }),
    expect.objectContaining({ font: 'Georgia', size: '24px', bold: true, italic: false }),
    expect.objectContaining({ font: 'Georgia', size: '24px', bold: false, italic: false }),
  ]);
  expect(result.warnings.filter(m => m.includes('inheritance'))).toHaveLength(0);
});

it('applies theme shading and direct clearing of inherited highlight and baseline', async () => {
  const result = await importWord(await fixture({ theme, defaults: '<w:highlight w:val="yellow"/><w:vertAlign w:val="superscript"/>', runs: [
    '', '<w:highlight w:val="none"/><w:vertAlign w:val="baseline"/><w:shd w:themeFill="accent1" w:themeFillTint="80" w:themeFillShade="80"/>', '<w:highlight w:val="none"/><w:vertAlign w:val="baseline"/>',
  ] }));
  const nodes = texts(result.content);
  expect(nodes[0].marks).toContainEqual(expect.objectContaining({ type: 'superscript' }));
  expect(colorToHex(nodes[0].marks?.find(m => m.type === 'highlight')?.attrs?.color)).toBe('#FFFF00');
  expect(colorToHex(nodes[1].marks?.find(m => m.type === 'highlight')?.attrs?.color)).toBe('#BFBFBF');
  expect(nodes[1].marks?.some(m => m.type === 'superscript')).not.toBe(true);
  expect(nodes[2].marks?.some(m => ['highlight', 'superscript'].includes(m.type))).not.toBe(true);
});

it('retains a combined default/style/theme/multilingual/link/table fixture across two Word imports', async () => {
  const styles = style('Normal', 'paragraph', '<w:rFonts w:asciiTheme="majorAscii" w:hAnsiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia"/><w:lang w:eastAsia="zh-CN"/><w:sz w:val="30"/><w:color w:val="364152"/>', '', 'w:default="1"')
    + style('Accent', 'paragraph', '<w:color w:themeColor="accent2"/><w:b/>', 'Normal')
    + style('Note', 'character', '<w:i/><w:highlight w:val="yellow"/>');
  const children = [
    new d.Paragraph('Default text / Français / 中文'),
    new d.Paragraph({ style: 'Accent', text: 'Inherited theme color and bold' }),
    new d.Paragraph({ children: [new d.TextRun({ style: 'Note', text: 'Character style / 日本語' }), new d.TextRun(' — plain sibling')] }),
    new d.Paragraph({ children: [new d.TextRun({ text: 'العربية עברית हिन्दी', rightToLeft: true, font: { cs: 'Arial' }, sizeComplexScript: 36, boldComplexScript: true })] }),
    new d.Paragraph({ style: 'Accent', children: [new d.TextRun('Link: '), new d.ExternalHyperlink({ link: 'https://example.com/qa', children: [new d.TextRun({ text: 'Open reference', bold: false })] }), new d.FootnoteReferenceRun(1)] }),
    new d.Table({ rows: [new d.TableRow({ children: ['Cell 中文', 'Cell 日本語'].map(text => new d.TableCell({ children: [new d.Paragraph({ style: 'Accent', text })] })) })] }),
  ];
  const buffer = await fixture({ styles, children, theme, footnotes: { 1: { children: [new d.Paragraph('Local QA footnote')] } } });
  const result = await importWord(buffer), original = texts(result.content);
  expect(original.map(n => n.text).join('')).toContain('العربية עברית हिन्दी');
  const complex = original.find(n => n.text === 'العربية עברית हिन्दी')!;
  expect(typography(complex)).toMatchObject({ font: 'Arial', size: '24px', bold: true });
  expect(original.find(n => n.text === 'Open reference')?.marks?.some(m => m.type === 'bold')).not.toBe(true);
  let current = result.content;
  for (let i = 0; i < 2; i++) {
    current = (await importWord(await bytes(await exportWord(current, 'Typography batch QA')))).content;
    expect(texts(current).map(n => [n.text, typography(n)])).toEqual(original.map(n => [n.text, typography(n)]));
  }
  if (process.env.VDOC_WRITE_QA_FIXTURE) {
    writeFileSync('/private/tmp/vdoc-text-batch-acceptance.docx', Buffer.from(buffer));
    writeFileSync('/private/tmp/vdoc-text-batch-expected.json', JSON.stringify(result));
  }
});


it.each([
  ['"Noto Serif SC"', 'Noto Serif SC'],
  ["'Times New Roman', serif", 'Times New Roman'],
  ['"QA, Local", serif', 'QA, Local'],
  ['"Noto\\20 Serif SC"', 'Noto Serif SC'],
])('exports the CSS font family %s as a Word typeface without CSS syntax', async (fontFamily, expected) => {
  const source: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Font 中文', marks: [{ type: 'textStyle', attrs: { fontFamily } }] }] }] };
  const zip = await JSZip.loadAsync(await bytes(await exportWord(source, 'Font serialization')));
  const xml = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
  const fonts = xml.getElementsByTagNameNS(W, 'rFonts')[0];
  for (const channel of ['ascii', 'hAnsi', 'eastAsia', 'cs']) expect(fonts.getAttributeNS(W, channel)).toBe(expected);
  expect(texts(source)[0].marks![0].attrs!.fontFamily).toBe(fontFamily);
});

it.each([
  ['4F81BD', 'w:themeTint="99"', '#95B3D7'],
  ['0000FF', 'w:themeShade="80"', '#000080'],
])('transforms saturated theme color %s in HSL luminance', async (base, modifier, expected) => {
  const result = await importWord(await fixture({ theme: theme.replace('val="808080"', `val="${base}"`), runs: [`<w:color w:themeColor="accent1" ${modifier}/>`] }));
  expect(typography(texts(result.content)[0]).color).toBe(expected);
});
