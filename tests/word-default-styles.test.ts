import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { exportWord } from '../lib/editor/word';

it('exports the editor default font and heading styles instead of Office blue theme headings', async () => {
  const blob = await exportWord({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body 中文' }] },
    ...[1,2,3,4,5,6].map(level => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text: `Heading ${level}` }] }))] }, 'Default styles');
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob);
  });
  const zip = await JSZip.loadAsync(bytes), xml = new DOMParser().parseFromString(await zip.file('word/styles.xml')!.async('string'), 'application/xml');
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const defaults = xml.getElementsByTagNameNS(ns, 'docDefaults')[0];
  expect(defaults.getElementsByTagNameNS(ns, 'rFonts')[0].getAttributeNS(ns, 'ascii')).toBe('Arial');
  expect(defaults.getElementsByTagNameNS(ns, 'sz')[0].getAttributeNS(ns, 'val')).toBe('24');
  for (let i = 1; i <= 6; i++) {
    const style = [...xml.getElementsByTagNameNS(ns, 'style')].find(n => n.getAttributeNS(ns, 'styleId') === `Heading${i}`)!;
    const run = style.getElementsByTagNameNS(ns, 'rPr')[0];
    expect(run.getElementsByTagNameNS(ns, 'rFonts')[0].getAttributeNS(ns, 'ascii')).toBe('Arial');
    expect(run.getElementsByTagNameNS(ns, 'sz')[0].getAttributeNS(ns, 'val')).toBe(String([48,29,26,24,23,21][i-1]));
    expect(run.getElementsByTagNameNS(ns, 'color')[0].getAttributeNS(ns, 'val')).toBe(i === 1 ? '24334C' : i === 2 ? '283952' : '364152');
  }
});
