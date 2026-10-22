import { expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { parseDocument, saveDocument } from '../lib/infrastructure/persistence/storage';
it('edits, formats, undoes and round-trips a 2500-paragraph document without loss', async () => {
  const content = { type: 'doc', content: Array.from({ length: 2500 }, (_, i) => ({ type: 'paragraph', attrs: { blockId: `load_${i}` }, content: [{ type: 'text', text: `Paragraph ${i}: ${'A realistic long document with editable text. '.repeat(5)}` }] })) };
  const start = performance.now();
  const editor = new Editor({ extensions: createExtensions(), content });
  await new Promise(r => setTimeout(r, 0));
  const loadMs = performance.now() - start;
  const engine = new DocumentEngine(editor);
  try {
    const before = editor.getJSON(), times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      expect(engine.execute({ target: { kind: 'block', id: `load_${1200 + i}` }, operations: [{ type: 'text.style', style: { bold: true } }] }).ok).toBe(true);
      times.push(performance.now() - start);
    }
    for (let i = 0; i < 20; i++) engine.history('undo', 'api');
    expect(editor.getJSON()).toEqual(before);
    const saveStart = performance.now(); const saved = saveDocument('Load test', editor.getJSON());
    const restored = parseDocument(JSON.stringify(saved));
    expect(restored.content).toEqual(before);
    console.info(JSON.stringify({ paragraphs: 2500, characters: editor.state.doc.textContent.length, loadMs: Math.round(loadMs), editMaxMs: Math.round(Math.max(...times)), editMeanMs: Math.round(times.reduce((a,b)=>a+b,0)/times.length), saveAndParseMs: Math.round(performance.now()-saveStart) }));
    expect(Math.max(...times)).toBeLessThan(1000);
  } finally { engine.destroy(); editor.destroy(); localStorage.clear(); }
}, 20000);
