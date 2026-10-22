import { expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { exportWord, importWord } from '../lib/editor/word';
import { colorToHex } from '../lib/editor/color';
import { parseDocument } from '../lib/editor/storage';
import * as docx from 'docx';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
const text = (value: string, color = '#CC0000', extra: JSONContent['marks'] = []): JSONContent => ({ type: 'text', text: value, marks: [{ type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '24px', color } }, { type: 'highlight', attrs: { color: '#FFF0AD' } }, ...extra] });
const p = (content: JSONContent[]): JSONContent => ({ type: 'paragraph', attrs: { textAlign: 'right', spaceAfter: 12 }, content });
const findText = (paragraph: JSONContent, value: string) => paragraph.content!.find(n => n.type === 'text' && n.text === value)!;
function check(node: JSONContent, color = '#CC0000') {
  expect(node).toBeDefined();
  const style = node.marks?.find(m => m.type === 'textStyle')?.attrs;
  expect(style).toMatchObject({ fontFamily: 'Georgia', fontSize: '24px' });
  expect(colorToHex(style?.color)).toBe(color);
  expect(colorToHex(node.marks?.find(m => m.type === 'highlight')?.attrs?.color)).toBe('#FFF0AD');
}
const roundtrip = async (content: JSONContent) => parseDocument(JSON.stringify({ version: 1, title: 'Inline formatting', content: (await importWord(await bytes(await exportWord(content, 'Inline formatting')))).content })).content;

it('restores separate text styles inside and around a link while preserving its URL', async () => {
  const input = { type: 'doc', content: [p([text('Before 中文 '), text('Link العربية', '#0000CC', [{ type: 'link', attrs: { href: 'https://example.com/?a=1&b=2' } }, { type: 'underline' }]), text(' After 日本語', '#008800')])] };
  const result = (await roundtrip(input)).content![0];
  check(findText(result, 'Before 中文 ')); check(findText(result, 'Link العربية'), '#0000CC'); check(findText(result, ' After 日本語'), '#008800');
  expect(findText(result, 'Link العربية').marks).toContainEqual(expect.objectContaining({ type: 'link', attrs: expect.objectContaining({ href: 'https://example.com/?a=1&b=2' }) }));
  expect(findText(result, 'Before 中文 ').marks?.some(m => m.type === 'link')).toBe(false);
});

it('retains both sides of a hard break and does not flatten or move the break', async () => {
  const result = (await roundtrip({ type: 'doc', content: [p([text('First 😀'), { type: 'hardBreak' }, text('第二行 العربية', '#008800')])] })).content![0];
  expect(result.content!.map(n => n.type)).toEqual(['text', 'hardBreak', 'text']);
  check(result.content![0]); check(result.content![2], '#008800');
});

it('restores paragraph and text formatting around two footnote references without turning them into text', async () => {
  const note = (number: number): JSONContent => ({ type: 'footnote', attrs: { number, text: `Note ${number} 中文 العربية` } });
  const result = (await roundtrip({ type: 'doc', content: [p([text('Same'), note(1), text('Same', '#008800'), note(2), text('Same', '#0000CC')])] })).content![0];
  expect(result.attrs).toMatchObject({ textAlign: 'right', spaceAfter: 12 });
  expect(result.content!.map(n => n.type)).toEqual(['text', 'footnote', 'text', 'footnote', 'text']);
  check(result.content![0]); check(result.content![2], '#008800'); check(result.content![4], '#0000CC');
  expect(result.content![1].attrs).toMatchObject({ number: 1, text: 'Note 1 中文 العربية' });
  expect(result.content![3].attrs).toMatchObject({ number: 2, text: 'Note 2 中文 العربية' });
});

it('keeps a formatted link, break and footnote inside a merged table through two Word round trips', async () => {
  const paragraph = p([text('中文👩‍💻\t'), text('Same', '#0000CC', [{ type: 'link', attrs: { href: 'https://example.com' } }]), { type: 'hardBreak' }, text('العربية', '#008800'), { type: 'footnote', attrs: { number: 1, text: 'Reference 日本語' } }]);
  let result: JSONContent = { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 2, colwidth: [120, 180] }, content: [paragraph] }] }, { type: 'tableRow', content: [{ type: 'tableCell', content: [p([text('Same')])] }, { type: 'tableCell', content: [p([text('Same', '#008800')])] }] }] }] };
  for (let i = 0; i < 2; i++) result = await roundtrip(result);
  const table = result.content![0], merged = table.content![0].content![0];
  expect(merged.attrs).toMatchObject({ colspan: 2, colwidth: [120, 180] });
  const output = merged.content![0]; check(findText(output, '中文👩‍💻\t')); check(findText(output, 'Same'), '#0000CC'); check(findText(output, 'العربية'), '#008800');
  expect(output.content!.filter(n => n.type === 'hardBreak')).toHaveLength(1);
  expect(output.content!.find(n => n.type === 'footnote')?.attrs?.text).toBe('Reference 日本語');
  check(table.content![1].content![0].content![0].content![0]); check(table.content![1].content![1].content![0].content![0], '#008800');
});

it('splits identical adjacent link text at Word run boundaries without leaking styles into the next link', async () => {
  const link = (href: string): JSONContent['marks'] => [{ type: 'link', attrs: { href } }];
  const result = (await roundtrip({ type: 'doc', content: [p([
    text('Same', '#CC0000', [...link('https://example.com/one')!, { type: 'bold' }]),
    text('Same', '#008800', link('https://example.com/one')),
    text('Same', '#0000CC', link('https://example.com/two')),
  ])] })).content![0];
  expect(result.content!.map(n => n.text)).toEqual(['Same', 'Same', 'Same']);
  check(result.content![0]); check(result.content![1], '#008800'); check(result.content![2], '#0000CC');
  expect(result.content!.map(n => n.marks?.find(m => m.type === 'link')?.attrs?.href)).toEqual(['https://example.com/one', 'https://example.com/one', 'https://example.com/two']);
  expect(result.content![0].marks?.some(m => m.type === 'bold')).toBe(true);
  expect(result.content![1].marks?.some(m => m.type === 'bold')).toBe(false);
});

it('retains a non-default list start and paragraph formatting when the first item contains a footnote', async () => {
  const result = await roundtrip({ type: 'doc', content: [{ type: 'orderedList', attrs: { start: 7 }, content: [
    { type: 'listItem', content: [p([text('Item 中文'), { type: 'footnote', attrs: { number: 1, text: 'Numbered reference' } }])] },
    { type: 'listItem', content: [p([text('Item العربية', '#008800')])] },
  ] }] });
  const list = result.content![0]; expect(list.attrs?.start).toBe(7); expect(list.content).toHaveLength(2);
  const first = list.content![0].content![0]; expect(first.attrs?.textAlign).toBe('right'); check(first.content![0]);
  expect(first.content![1].attrs?.text).toBe('Numbered reference');
  check(list.content![1].content![0].content![0], '#008800');
});

it('preserves a Word carriage return inside one formatted run and does not format its unstyled neighbor', async () => {
  const file = new docx.Document({ sections: [{ children: [new docx.Paragraph({ children: [
    new docx.TextRun({ children: ['中文', new docx.CarriageReturn(), 'العربية'], font: 'Georgia', size: 36, color: 'CC0000', shading: { fill: 'FFF0AD' }, italics: true }),
    new docx.TextRun(' Plain'),
  ] })] }] });
  const result = (await importWord(await bytes(await docx.Packer.toBlob(file)))).content.content![0];
  expect(result.content!.map(n => n.type)).toEqual(['text', 'hardBreak', 'text', 'text']);
  check(result.content![0]); check(result.content![2]);
  expect(result.content![0].marks?.some(m => m.type === 'italic')).toBe(true);
  expect(result.content![3].text).toBe(' Plain'); expect(result.content![3].marks).toBeUndefined();
});

it('keeps leading, consecutive and trailing carriage returns in order without extending a hyperlink', async () => {
  const file = new docx.Document({ sections: [{ children: [new docx.Paragraph({ children: [
    new docx.TextRun({ children: [new docx.CarriageReturn(), 'Before'] }),
    new docx.ExternalHyperlink({ link: 'https://example.com/line', children: [new docx.TextRun({ children: ['中', new docx.CarriageReturn(), new docx.CarriageReturn(), '文'], font: 'Georgia', size: 36, color: 'CC0000', shading: { fill: 'FFF0AD' } })] }),
    new docx.TextRun({ children: ['After', new docx.CarriageReturn()] }),
  ] })] }] });
  const buffer = await bytes(await docx.Packer.toBlob(file)), before = new Uint8Array(buffer).slice();
  const result = await importWord(buffer), paragraph = result.content.content![0];
  expect(new Uint8Array(buffer)).toEqual(before);
  expect(result.warnings.some(message => message.includes('w:cr'))).toBe(false);
  expect(paragraph.content!.map(n => n.type)).toEqual(['hardBreak', 'text', 'text', 'hardBreak', 'hardBreak', 'text', 'text', 'hardBreak']);
  check(findText(paragraph, '中')); check(findText(paragraph, '文'));
  for (const value of ['中', '文']) expect(findText(paragraph, value).marks?.find(m => m.type === 'link')?.attrs?.href).toBe('https://example.com/line');
  for (const value of ['Before', 'After']) expect(findText(paragraph, value).marks?.some(m => m.type === 'link')).not.toBe(true);
});
