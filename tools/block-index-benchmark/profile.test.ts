import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Editor, type EditorEvents } from '@tiptap/core';
import { createExtensions } from '../../lib/editor/extensions';
import { DocumentEngine } from '../../lib/usecases/engine';

const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1), samples: values };
};

it('profiles native typing without any index reader between keystrokes', async () => {
  const runs = [];
  for (let run = 0; run < 3; run++) {
    const editor = new Editor({ extensions: createExtensions(), content: {
      type: 'doc', content: [
        ...Array.from({ length: 4000 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Paragraph ${i}` }] })),
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell' }] }] }] }] },
      ],
    } });
    await new Promise(resolve => setTimeout(resolve, 0));
    const engine = new DocumentEngine(editor);
    // Benchmark-only instrumentation of the real registered handler. No shipping API changes.
    const handler = Reflect.get(engine, 'handleTransaction') as (event: EditorEvents['transaction']) => void;
    const handlerTimes: number[] = [], inputTimes: number[] = [];
    let recording = false;
    const measured = (event: EditorEvents['transaction']) => {
      const start = performance.now(); handler(event);
      if (recording) handlerTimes.push(performance.now() - start);
    };
    editor.off('transaction', handler); editor.on('transaction', measured);
    try {
      for (let i = 0; i < 20; i++) editor.commands.insertContent('x');
      recording = true;
      for (let i = 0; i < 100; i++) {
        const start = performance.now(); editor.commands.insertContent('x'); inputTimes.push(performance.now() - start);
      }
      expect(handlerTimes).toHaveLength(100);
      runs.push({ handlerMs: stats(handlerTimes), inputMs: stats(inputTimes) });
    } finally {
      editor.off('transaction', measured); engine.destroy(); editor.destroy();
    }
  }
  const result = { paragraphs: 4000, tables: 1, warmup: 20, inputsPerRun: 100, at: new Date().toISOString(), node: process.version, runs };
  if (process.env.VDOC_BENCH_RESULT) writeFileSync(process.env.VDOC_BENCH_RESULT, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(runs.map(({ handlerMs, inputMs }) => ({ handlerMedian: handlerMs.median, handlerP95: handlerMs.p95, inputMedian: inputMs.median })), null, 2));
});
