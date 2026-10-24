import { Editor } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import { afterEach, expect, it, vi } from 'vitest';
import { createExtensions } from '../lib/editor/extensions';
import { createExportSnapshot } from '../lib/editor/export-snapshot';

afterEach(() => vi.restoreAllMocks());

it('lazily serializes the captured revision after later edits and editor destruction', () => {
  const editor = new Editor({ extensions: createExtensions(), content: '<p><strong>Original 中文</strong></p>' });
  const doc = editor.state.doc, expectedJSON = editor.getJSON(), expectedHTML = editor.getHTML();
  const json = vi.spyOn(doc, 'toJSON');
  const html = vi.spyOn(DOMSerializer.prototype, 'serializeFragment');
  try {
    const snapshot = createExportSnapshot(doc, 'Original title');
    expect(json).not.toHaveBeenCalled(); expect(html).not.toHaveBeenCalled();
    editor.commands.setContent('<p>Later edits</p>');
    editor.destroy();
    json.mockClear(); html.mockClear();
    expect(snapshot.json).toEqual(expectedJSON);
    expect(snapshot.json).toBe(snapshot.json);
    expect(json).toHaveBeenCalledOnce();
    expect(snapshot.html).toBe(expectedHTML);
    const serializationCalls = html.mock.calls.length;
    expect(serializationCalls).toBeGreaterThan(0);
    expect(snapshot.html).toBe(expectedHTML);
    expect(html).toHaveBeenCalledTimes(serializationCalls);
    expect(snapshot.title).toBe('Original title');
  } finally { if (!editor.isDestroyed) editor.destroy(); }
});
