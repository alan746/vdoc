import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { createExtensions } from '../lib/editor/extensions';
import { StableIds } from '../lib/editor/document/stable-ids';

let editor: Editor;
afterEach(() => { editor?.destroy(); vi.restoreAllMocks(); });
async function open(content: string) {
  editor = new Editor({ extensions: createExtensions(), content });
  await new Promise(resolve => setTimeout(resolve, 0));
}
const ids = () => {
  const result: string[] = [];
  editor.state.doc.descendants(node => { if (node.attrs.blockId) result.push(node.attrs.blockId); });
  return result;
};

it('preserves nested originals when a table copy is inserted before them', async () => {
  await open('<table><tr><td><p>Cell</p></td></tr></table><p>After</p>');
  const original = editor.state.doc.firstChild!, originalIds = ids();
  editor.view.dispatch(editor.state.tr.insert(0, original));
  expect(editor.state.doc.child(1).toJSON()).toEqual(original.toJSON());
  const result = ids();
  expect(new Set(result).size).toBe(result.length);
  expect(result.slice(-originalIds.length)).toEqual(originalIds);
});

it('keeps surviving IDs across split, join, undo and redo', async () => {
  await open('<p>First paragraph</p><p>Next paragraph</p>');
  const before = editor.getJSON(), originalIds = ids();
  editor.view.dispatch(editor.state.tr.split(6));
  const split = editor.getJSON(), splitIds = ids();
  expect(splitIds[0]).toBe(originalIds[0]);
  expect(splitIds[2]).toBe(originalIds[1]);
  expect(new Set(splitIds).size).toBe(3);
  editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
  editor.commands.redo(); expect(editor.getJSON()).toEqual(split);
  editor.view.dispatch(editor.state.tr.join(editor.state.doc.child(0).nodeSize));
  expect(editor.getJSON()).toEqual(before);
});

it('normalizes a wide document without resolving each old node position separately', async () => {
  editor = new Editor({ extensions: createExtensions(), content: { type: 'doc', content: Array.from({ length: 2500 }, (_, i) => ({
    type: 'paragraph', attrs: { blockId: `wide_${i}` }, content: [{ type: 'text', text: 'Paragraph' }],
  })) } });
  await new Promise(resolve => setTimeout(resolve, 0));
  const oldState = editor.state, tr = oldState.tr.split(11005);
  const state = EditorState.create({ schema: editor.schema, doc: tr.doc, selection: tr.selection });
  // Isolate the ID plugin: random nodeAt lookup is linear in sibling count,
  // so doing it for every block regresses this path to quadratic work.
  const extension = editor.extensionManager.extensions.find(extension => extension.name === 'stableIds')!;
  const plugin = StableIds.config.addProseMirrorPlugins!.call({
    name: extension.name, options: extension.options, storage: extension.storage, editor, type: null, parent: undefined,
  })[0];
  const lookups = vi.spyOn(state.doc, 'nodeAt');
  const normalized = plugin.spec.appendTransaction!.call(plugin, [tr], oldState, state);
  expect(normalized?.docChanged).toBe(true);
  // setNodeMarkup resolves the one newly split paragraph to assign its ID.
  expect(lookups).toHaveBeenCalledTimes(1);
  const result = state.apply(normalized!);
  const resultIds: string[] = [];
  result.doc.forEach(node => resultIds.push(node.attrs.blockId));
  expect(resultIds).toHaveLength(2501);
  expect(new Set(resultIds).size).toBe(2501);
  expect(resultIds).toEqual(expect.arrayContaining(Array.from({ length: 2500 }, (_, i) => `wide_${i}`)));
});
