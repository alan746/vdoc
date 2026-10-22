import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { createAutosave } from '../lib/usecases/autosave';
import { createInMemoryRepositories } from './support/in-memory-repositories';

// Autosave depends only on the DocumentWriter port: it runs unchanged against
// a non-IndexedDB implementation.
let editor: Editor, repositories: ReturnType<typeof createInMemoryRepositories>, dispose: () => void;
beforeEach(async () => {
  repositories = createInMemoryRepositories();
  editor = new Editor({ extensions: createExtensions(), content: '<p>Before</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  vi.useFakeTimers();
});
afterEach(() => { dispose?.(); editor.destroy(); vi.useRealTimers(); });

it('persists edits and the title through an in-memory document repository', async () => {
  const stored = await repositories.documents.activate({ version: 1, title: 'Draft', savedAt: '2026-10-14T00:00:00.000Z', content: editor.getJSON() });
  const report = vi.fn();
  const controller = createAutosave(repositories.documents)(editor, stored.id, { getTitle: () => '新标题 Title', blocked: { current: false }, report });
  dispose = () => controller.dispose();
  editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' after 中文');
  await vi.advanceTimersByTimeAsync(2000);
  const { data } = await repositories.documents.readActive();
  expect(data?.title).toBe('新标题 Title');
  expect(editor.state.doc.textContent).toBe('Before after 中文');
  expect(JSON.stringify(data?.content)).toContain('Before after 中文');
  expect(report).toHaveBeenLastCalledWith('Saved locally', '');
});

it('reports a failed write without throwing when the repository rejects', async () => {
  const report = vi.fn();
  const controller = createAutosave(repositories.documents)(editor, 'not-stored', { getTitle: () => 'Draft', blocked: { current: false }, report });
  dispose = () => controller.dispose();
  editor.commands.insertContent('x');
  await vi.advanceTimersByTimeAsync(2000);
  expect(report.mock.calls.some(([status]) => /fail/i.test(status))).toBe(true);
});
