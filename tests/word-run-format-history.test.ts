import { expect, it, vi } from 'vitest';
import * as d from 'docx';
import JSZip from 'jszip';
import { Editor, type JSONContent } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { parseDocument } from '../lib/editor/storage';
import { exportWord, importWord } from '../lib/editor/word';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob);
});
async function withHistory(buffer: ArrayBuffer, oldProperties: string) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
  for (const run of Array.from(xml.getElementsByTagNameNS(W, 'r'))) {
    if (!run.getElementsByTagNameNS(W, 't').length) continue;
    let properties = Array.from(run.children).find(node => node.localName === 'rPr');
    if (!properties) { properties = xml.createElementNS(W, 'w:rPr'); run.insertBefore(properties, run.firstChild); }
    const history = new DOMParser().parseFromString(`<w:rPrChange xmlns:w="${W}" w:id="1" w:author="QA" w:date="2026-10-05T00:00:00Z"><w:rPr>${oldProperties}</w:rPr></w:rPrChange>`, 'application/xml');
    properties.appendChild(xml.importNode(history.documentElement, true));
  }
  zip.file('word/document.xml', new XMLSerializer().serializeToString(xml));
  return zip.generateAsync({ type: 'arraybuffer' });
}
const makeFile = async (children: (d.Paragraph | d.Table)[]) => bytes(await d.Packer.toBlob(new d.Document({ sections: [{ children }] })));

it.each([
  ['font', '<w:rFonts w:ascii="Courier New"/>'],
  ['size', '<w:sz w:val="96"/>'],
  ['color', '<w:color w:val="CC0000"/>'],
  ['background', '<w:shd w:fill="00FF00"/>'],
  ['highlight', '<w:highlight w:val="yellow"/>'],
  ['bold', '<w:b/>'], ['italic', '<w:i/>'], ['underline', '<w:u w:val="single"/>'],
  ['strike', '<w:strike/>'], ['script', '<w:vertAlign w:val="superscript"/>'],
])('does not apply historical %s when the current Word run has no such formatting', async (_, oldProperties) => {
  const source = await makeFile([new d.Paragraph('Current 中文 العربية हिन्दी 👩‍💻')]);
  const baseline = await importWord(source), revised = await withHistory(source, oldProperties), before = new Uint8Array(revised).slice();
  const result = await importWord(revised);
  expect(result.content).toEqual(baseline.content);
  expect(result.content.content![0].content![0].text).toBe('Current 中文 العربية हिन्दी 👩‍💻');
  expect(result.content.content![0].content![0].marks).toBeUndefined();
  expect(new Uint8Array(revised)).toEqual(before);
});

const oldFormatting = '<w:rFonts w:ascii="Courier New"/><w:sz w:val="96"/><w:color w:val="CC0000"/><w:shd w:fill="00FF00"/><w:highlight w:val="yellow"/><w:b/><w:i/><w:u w:val="single"/><w:strike/><w:vertAlign w:val="superscript"/>';
it('keeps only current formatting around links, hard breaks, repeated text and explicit off flags', async () => {
  const source = await makeFile([new d.Paragraph({ children: [
    new d.TextRun({ text: 'Same 中文', font: 'Georgia', size: 36, color: '0000CC', bold: true }),
    new d.ExternalHyperlink({ link: 'https://example.com/current', children: [new d.TextRun({ children: ['Same العربية', new d.CarriageReturn(), 'Same 日本語'], italics: true })] }),
    new d.TextRun({ text: 'Same हिन्दी', bold: false, italics: false, strike: false }),
  ] })]);
  const baseline = await importWord(source), result = await importWord(await withHistory(source, oldFormatting));
  expect(result.content).toEqual(baseline.content);
  const nodes = result.content.content![0].content!;
  expect(nodes.filter(node => node.type === 'hardBreak')).toHaveLength(1);
  expect(nodes.filter(node => node.type === 'text' && node.marks?.some(mark => mark.type === 'link')).map(node => node.text)).toEqual(['Same العربية', 'Same 日本語']);
  expect(nodes[0].marks).toContainEqual(expect.objectContaining({ type: 'bold' }));
  expect(nodes.at(-1)?.marks?.some(mark => ['bold', 'italic', 'strike'].includes(mark.type))).not.toBe(true);
});

it('keeps current text in headings, lists, cells and beside footnotes through backup, HTML and Word export', async () => {
  const source = await bytes(await d.Packer.toBlob(new d.Document({ footnotes: { 1: { children: [new d.Paragraph('Reference עברית')] } }, sections: [{ children: [
    new d.Paragraph({ text: 'Heading 中文', heading: d.HeadingLevel.HEADING_2 }),
    new d.Paragraph({ text: 'List 日本語', bullet: { level: 0 } }),
    new d.Table({ rows: [new d.TableRow({ children: [new d.TableCell({ children: [new d.Paragraph('Cell العربية')] })] })] }),
    new d.Paragraph({ children: [new d.TextRun('Before हिन्दी'), new d.FootnoteReferenceRun(1), new d.TextRun({ text: 'After Français', underline: {}, color: '008800' })] }),
  ] }] })));
  const baseline = await importWord(source), result = await importWord(await withHistory(source, oldFormatting));
  expect(result.content).toEqual(baseline.content);
  const editor = new Editor({ extensions: createExtensions(), content: result.content });
  let htmlEditor: Editor | undefined;
  try {
    await new Promise(resolve => setTimeout(resolve, 0)); const original: JSONContent = editor.getJSON();
    htmlEditor = new Editor({ extensions: createExtensions(), content: editor.getHTML() });
    expect(htmlEditor.getJSON().content).toEqual(original.content);
    expect(parseDocument(JSON.stringify({ version: 1, title: 'Current format', content: original })).content).toEqual(original);
    const expected = await importWord(await bytes(await exportWord(baseline.content, 'Baseline')));
    const exported = await importWord(await bytes(await exportWord(result.content, 'Current format')));
    expect(exported.content).toEqual(expected.content);
    expect(editor.getJSON()).toEqual(original);
  } finally { htmlEditor?.destroy(); editor.destroy(); }
});
