// Run `npx vite --config tests/browser/vite.config.ts`, then open
// http://localhost:5174/tests/browser/preview-page-breaks.html.
// This test needs real layout: jsdom cannot reproduce Paged.js fragmentation.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { generateHTML, type JSONContent } from '@tiptap/core';
import { PrintPreview } from '../../components/editor/print-preview';
import { createExtensions } from '../../lib/editor/extensions';
import { previewSource } from '../../lib/infrastructure/preview/paged-preview';
import { previewPageBreakMismatch } from '../../lib/infrastructure/preview/preview-page-breaks';
import '../../app/globals.css';

const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const content: JSONContent = {
  type: 'doc', attrs: { pageSize: 'a4', pageMargin: 20, pageNumbers: true },
  content: [paragraph('Page one'), { type: 'pageBreak' }, paragraph('Page two'), { type: 'pageBreak' }, paragraph('Page three')],
};
const snapshot = { title: 'Short paragraphs between page breaks', content, html: generateHTML(content, createExtensions()) };
const original = document.createElement('div');
original.innerHTML = previewSource(snapshot.title, snapshot.html, content).html;
const output = document.querySelector<HTMLElement>('#result')!;
const app = document.querySelector<HTMLElement>('#test-app')!;
createRoot(app).render(createElement(PrintPreview, { snapshot, close: () => {} }));

const deadline = performance.now() + 30000;
const timer = setInterval(() => {
  const dialog = document.querySelector('[role="dialog"]');
  const frame = dialog?.querySelector('iframe')?.contentDocument;
  const status = dialog?.querySelector('.print-preview-controls [role="status"]')?.textContent || '';
  const ready = dialog?.querySelector('select[aria-label="Go to page"]');
  if (!ready && performance.now() < deadline) return;
  clearInterval(timer);
  const pages = Array.from(frame?.querySelectorAll<HTMLElement>('.pagedjs_page_content') || []);
  const texts = pages.map(page => page.innerText.trim());
  const options = Array.from(ready?.querySelectorAll('option') || []).map(option => option.textContent);
  const mismatch = frame ? previewPageBreakMismatch(original, frame.body) : 'missing frame';
  const assertions = {
    threePages: pages.length === 3,
    noEmptyPages: pages.length > 0 && texts.every(Boolean),
    correctOrder: JSON.stringify(texts) === JSON.stringify(['Page one', 'Page two', 'Page three']),
    headerAgrees: status.startsWith('3 pages'),
    navigationAgrees: JSON.stringify(options) === JSON.stringify(['1', '2', '3']),
    breakAuditPasses: mismatch === null,
    printEnabled: dialog?.querySelector<HTMLButtonElement>('.print-preview-heading button')?.disabled === false,
  };
  const passed = Object.values(assertions).every(Boolean);
  output.dataset.result = passed ? 'passed' : 'failed';
  output.textContent = JSON.stringify({ passed, assertions, status, texts, options, mismatch }, null, 2);
  document.title = `${passed ? 'PASS' : 'FAIL'}: page break regression`;
}, 100);
